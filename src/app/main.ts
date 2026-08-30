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
  saveAs,
  saveToHandle,
  writeAutosave,
  type FsaFileHandle,
} from './files.js';
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
 * save_deck's disk route. It must NEVER throw and never open a picker: an unattended agent has
 * nobody to click one. With a writable handle it writes the real file; without one it leaves the
 * working copy in the autosave slot and says so, so the agent can tell the human to press Save.
 */
async function saveFromTool(text: string): Promise<SaveOutcomeReport> {
  if (handle) {
    const out = await saveToHandle(handle, text);
    if (out.ok) {
      deck.markSaved();
      clearAutosave();
      refreshChrome();
      say(`Saved to ${out.name} (by an agent)`);
      return { written: true, where: out.name, note: 'written to the file on disk.' };
    }
    writeAutosave(deck.name(), text);
    say(`An agent tried to save and could not: ${out.reason}`, true);
    return {
      written: false,
      where: 'the browser autosave slot',
      note: `the file could not be written (${out.reason}) — the working copy is kept in the browser. Ask the human to press Save.`,
    };
  }
  const kept = writeAutosave(deck.name(), text);
  say('An agent finished — press Save to put the Fold on disk.');
  return {
    written: false,
    where: kept ? 'the browser autosave slot' : 'memory only (browser storage is unavailable)',
    note: `this page holds no writable handle for "${deck.name()}" — nothing was written to disk. Ask the human to press Save (or Save as…) in the page.`,
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
