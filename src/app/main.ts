import { DeckStore } from '../core/deck-store.js';
import { ProposalStore, restorableProposals } from '../core/proposal-store.js';
import { connectWebMcp } from '../core/registry.js';
import { createRegistry, type SaveOutcomeReport } from '../core/tools.js';
import { TestConsole } from './console.js';
import {
  canSaveInPlace,
  clearAutosave,
  pickFile,
  readAutosave,
  downloadBlob,
  saveAs,
  saveToHandle,
  writeAutosave,
  type FsaFileHandle,
} from './files.js';
import { getPointer, readLastOpfs, writeOpfs } from './opfs.js';
import { measureRender } from './measure.js';
import { Preview } from './preview.js';
import { ReviewPanel } from './review.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const deck = new DeckStore();
const proposals = new ProposalStore();
const previewFrame = $<HTMLIFrameElement>('preview');
const registry = createRegistry({
  deck,
  proposals,
  save: saveFromTool,
  // inspect_render measures in its OWN off-screen frame at a fixed, stated viewport, so the
  // verdict does not change with the human's window size and the visible deck is never disturbed.
  measure: measureRender,
});

const preview = new Preview(previewFrame, $('empty-state'));

const message = $('app-message');
let messageTimer: number | undefined;
function say(text: string, bad = false): void {
  message.textContent = text;
  message.className = bad ? 'pill dirty' : 'pill live';
  message.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.hidden = true;
  }, 6000) as unknown as number;
}

const review = new ReviewPanel($('proposal-list'), $('proposal-count'), deck, proposals, say);

new TestConsole(registry, {
  toggle: $<HTMLButtonElement>('console-toggle'),
  body: $('console-body'),
  list: $('tool-list'),
  count: $('tool-count'),
  name: $('tool-name'),
  desc: $('tool-desc'),
  schema: $('tool-schema'),
  args: $<HTMLTextAreaElement>('tool-args'),
  invoke: $<HTMLButtonElement>('btn-invoke'),
  state: $('run-state'),
  result: $('tool-result'),
});

/* ---------- WebMCP status ---------- */

void connectWebMcp(registry).then((mcp) => {
  const el = $('mcp-status');
  el.textContent =
    mcp.surface === 'none'
      ? `WebMCP: not available (console only) — ${registry.list().length} tools registered locally`
      : `WebMCP: connected via ${mcp.surface} — ${mcp.registered} tools${mcp.failed ? `, ${mcp.failed} refused` : ''}`;
  el.className = mcp.surface === 'none' ? 'pill' : mcp.failed ? 'pill dirty' : 'pill live';
});

/* ---------- deck lifecycle ---------- */

let handle: FsaFileHandle | null = null;
let autosaveTimer: number | undefined;

const deckNameEl = $('deck-name');
const saveStatus = $('save-status');
const btnSave = $<HTMLButtonElement>('btn-save');
const btnSaveAs = $<HTMLButtonElement>('btn-saveas');

function refreshChrome(): void {
  const state = deck.peek();
  if (!state) {
    deckNameEl.textContent = 'No Fold open';
    saveStatus.textContent = 'No Fold open';
    saveStatus.className = 'pill quiet';
    btnSave.disabled = true;
    btnSaveAs.disabled = true;
    return;
  }
  deckNameEl.textContent = `${state.model.title} — ${state.name}`;
  saveStatus.textContent = state.dirty ? 'Unsaved changes' : handle ? `Saved to ${handle.name}` : 'No changes since open';
  saveStatus.className = state.dirty ? 'pill dirty' : 'pill quiet';
  btnSave.disabled = false;
  btnSaveAs.disabled = false;
}

deck.subscribe((ev) => {
  if (ev === 'open' || ev === 'close') {
    proposals.clear();
    preview.render(deck);
  } else if (ev === 'change') {
    preview.schedule(deck);
  }
  refreshChrome();
  void review.refresh();
  if (ev !== 'close') scheduleAutosave();
});

proposals.subscribe(() => {
  void review.refresh();
  // Staging a proposal changes nothing in the deck, so the deck's own 'change' event never
  // fires and the queue would not reach storage until the next edit. Autosave on it directly.
  if (deck.isOpen()) scheduleAutosave();
});

function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (!deck.isOpen()) return;
    writeAutosave(deck.name(), deck.serialize(), proposals.all());
  }, 700) as unknown as number;
}

function openText(text: string, name: string, from: FsaFileHandle | null): void {
  try {
    deck.open(text, name);
    handle = from;
    say(`Opened ${name}`);
  } catch (e) {
    say(`Not a readable Origami Fold: ${(e as Error).message}`, true);
  }
}

/** The human is about to replace what is on screen. */
function confirmDiscard(): boolean {
  if (!deck.peek()?.dirty) return true;
  return confirm('This Fold has unsaved changes. Discard them?');
}

/* ---------- toolbar ---------- */

$('btn-open').addEventListener('click', async () => {
  if (!confirmDiscard()) return;
  const picked = await pickFile();
  if (picked) openText(picked.text, picked.name, picked.handle);
});

$('btn-sample').addEventListener('click', async () => {
  if (!confirmDiscard()) return;
  try {
    const res = await fetch('./sample/welcome.origami.html');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    openText(await res.text(), 'welcome.origami.html', null);
  } catch (e) {
    say(`Could not load the sample Fold: ${(e as Error).message}`, true);
  }
});

$('btn-new').addEventListener('click', async () => {
  if (!confirmDiscard()) return;
  deck.close(); // clears the dirty guard create_deck enforces for agents
  handle = null;
  const res = await registry.invoke('create_deck', { title: 'Untitled deck' });
  if (res.isError) say(JSON.parse(res.content[0]!.text).error, true);
  else say('New Fold created — it is not on disk until you save it.');
});

btnSave.addEventListener('click', async () => {
  if (!deck.isOpen()) return;
  const text = deck.serialize(new Date().toISOString());
  if (handle) {
    const out = await saveToHandle(handle, text);
    if (out.ok) {
      deck.markSaved();
      clearAutosave();
      say(`Saved to ${out.name}`);
    } else say(`Save failed: ${out.reason}`, true);
    refreshChrome();
    return;
  }
  await doSaveAs(text);
});

btnSaveAs.addEventListener('click', async () => {
  if (deck.isOpen()) await doSaveAs(deck.serialize(new Date().toISOString()));
});

/**
 * save_deck's disk route, re-shaped around what was actually MEASURED (see README, "What a page
 * can really save"). It must NEVER throw and never open a picker: an unattended agent has nobody
 * to click one. Three things happen, in this order, and the result says which of them did:
 *
 *   1. HANDLE. With a writable File System Access handle, write the real file and read the byte
 *      count back. This is the ONLY route that reports saved:true.
 *   2. OPFS. Always — handle or no handle. A real 10 GB-quota file system, private to this
 *      origin, needing no permission and no gesture. It replaces the ~5 MB localStorage slot
 *      that used to fail silently on a Fold with images.
 *   3. DOWNLOAD. Only when there is no handle. Chrome 151 was measured starting a programmatic
 *      download with navigator.userActivation.isActive === false, twice in a row, headless and
 *      headed. But the page cannot see where the bytes went, and a normal profile may still put
 *      the second one behind a prompt no agent can answer — so this reports downloadStarted, and
 *      never saved.
 */
async function saveFromTool(text: string): Promise<SaveOutcomeReport> {
  // The backstop runs first and unconditionally: if everything below fails, the bytes still exist.
  const opfs = await writeOpfs(deck.name(), text);
  if (opfs.written) refreshLastSave();

  if (handle) {
    const out = await saveToHandle(handle, text);
    if (out.ok) {
      deck.markSaved();
      clearAutosave();
      refreshChrome();
      say(`Saved to ${out.name} (by an agent)`);
      return { written: true, where: out.name, note: `written to the file on disk and read back: ${out.bytes} bytes.`, opfs };
    }
    writeAutosave(deck.name(), text);
    say(`An agent tried to save and could not: ${out.reason}`, true);
    return {
      written: false,
      where: opfs.written ? `${opfs.path} (browser storage)` : 'the browser autosave slot',
      note: `the file could NOT be written (${out.reason}). ${opfs.written ? 'The full Fold is in browser storage instead.' : ''} Ask the human to press Save.`,
      opfs,
    };
  }

  // No handle: try the download, and be exact about what that does and does not prove.
  let downloadStarted = false;
  try {
    downloadBlob(text, deck.name());
    downloadStarted = true;
  } catch {
    downloadStarted = false; // a browser that refuses outright — reported, not swallowed
  }
  writeAutosave(deck.name(), text);
  say(downloadStarted ? 'An agent saved — check your downloads, or press Save to choose a location.' : 'An agent finished — press Save to put the Fold on disk.');
  return {
    written: false,
    where: opfs.written ? `${opfs.path} (browser storage)` : 'the browser autosave slot',
    downloadStarted,
    opfs,
    note:
      `this page holds no writable handle for "${deck.name()}", so nothing was written to a file this page can verify. ` +
      (downloadStarted
        ? 'A download was STARTED without a user gesture — on Chrome that usually lands the file in the Downloads folder, but the page cannot see whether it did, and a browser may block a repeat download behind a prompt. Do not report the deck as saved on the strength of it. '
        : 'This browser refused to start a download from script. ') +
      (opfs.written
        ? `The complete Fold IS in this browser's private file system (${opfs.path}, ${opfs.bytes} bytes) and the human can retrieve it with the "Download last save" button in the page. Browser storage is not persistent, so tell them to save it properly. `
        : `Browser storage was unavailable (${opfs.why}). `) +
      'Ask the human to press Save (or Save as…) to put it on their disk.',
  };
}

async function doSaveAs(text: string): Promise<void> {
  const res = await saveAs(text, deck.name());
  if (res.outcome.ok) {
    handle = res.handle;
    if (res.handle) deck.setName(res.handle.name);
    deck.markSaved();
    clearAutosave();
    say(res.outcome.how === 'download' ? `Downloaded ${res.outcome.name}` : `Saved to ${res.outcome.name}`);
  } else if (res.outcome.reason !== 'cancelled') {
    say(`Save failed: ${res.outcome.reason}`, true);
  }
  refreshChrome();
}

if (!canSaveInPlace()) btnSaveAs.title = 'This browser has no file picker — Save as downloads the Fold instead.';

/* ---------- the way back out of browser storage ----------
   save_deck always writes the whole Fold into OPFS, which is real storage but INVISIBLE: nothing
   outside this origin can read it, so without this button an agent's "it is saved in the browser"
   would be true and useless. A click is a user gesture, so this download is never in doubt. */

const btnLastSave = $<HTMLButtonElement>('btn-lastsave');

function refreshLastSave(): void {
  const ptr = getPointer();
  btnLastSave.hidden = ptr === null;
  if (ptr) {
    const kb = Math.max(1, Math.round(ptr.bytes / 1024));
    btnLastSave.textContent = `Download last save (${kb} KB)`;
    btnLastSave.title = `${ptr.name} — kept in this browser at ${new Date(ptr.at).toLocaleString()}. Browser storage is not permanent; save it somewhere you own.`;
  }
}

btnLastSave.addEventListener('click', async () => {
  const last = await readLastOpfs();
  if (!last) {
    say('The last save is no longer in browser storage — the browser evicted it.', true);
    refreshLastSave();
    return;
  }
  downloadBlob(last.text, last.name);
  say(`Downloading ${last.name} from browser storage.`);
});

refreshLastSave();

/* ---------- drag and drop ---------- */

const stage = $('stage');
const veil = $('dropveil');
let dragDepth = 0;

stage.addEventListener('dragenter', (ev) => {
  ev.preventDefault();
  if (++dragDepth === 1) veil.hidden = false;
});
stage.addEventListener('dragover', (ev) => ev.preventDefault());
stage.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    veil.hidden = true;
  }
});
stage.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  const file = ev.dataTransfer?.files?.[0];
  if (!file) return;
  if (!confirmDiscard()) return;
  openText(await file.text(), file.name, null);
});

/* ---------- resume last session ---------- */

const resumeSlot = $('resume-slot');
const saved = readAutosave();
if (saved) {
  const when = new Date(saved.at).toLocaleString();
  resumeSlot.hidden = false;
  resumeSlot.append(document.createTextNode(`Unsaved work from ${when}`));
  const resume = document.createElement('button');
  resume.type = 'button';
  resume.textContent = 'Resume';
  resume.setAttribute('data-testid', 'btn-resume');
  resume.addEventListener('click', () => {
    openText(saved.text, saved.name, null);
    // AFTER openText: deck.open() emits 'open', and that handler clears the queue.
    proposals.restore(restorableProposals(saved.proposals));
    resumeSlot.hidden = true;
  });
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.textContent = 'Discard';
  discard.addEventListener('click', () => {
    clearAutosave();
    resumeSlot.hidden = true;
  });
  resumeSlot.append(resume, discard);
}

window.addEventListener('beforeunload', (ev) => {
  if (deck.peek()?.dirty) ev.preventDefault();
});

refreshChrome();
void review.refresh();
preview.render(deck);
