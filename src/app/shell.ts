import type { ActivitySource } from '../core/activity.js';
import { DeckStore } from '../core/deck-store.js';
import { ProposalStore, restorableProposals } from '../core/proposal-store.js';
import { connectWebMcp, type McpConnection } from '../core/registry.js';
import type { SaveOutcomeReport } from '../core/tools.js';
import { createModeDoc, createModeRegistry } from '../core/mode-registry.js';
import type { ToolMode } from '../core/modes.js';
import { ActivityRail } from './activity.js';
import { TestConsole } from './console.js';
import { DEMO_CALLS, bindRefs, learnRefs } from './demo-script.js';
import { Popover } from './popover.js';
import { Toasts } from './toast.js';
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

/**
 * THE SHELL — one app, four pages.
 *
 * /folio/ is the whole editor: a landing, the recorded replay, every tool. /draw/, /charts/ and
 * /gantt/ are this same shell scoped to one block (docs/SITE.md, "Mini tools"): the canvas IS
 * the landing, a seeded document is minted on load, and the registry holds the eight common
 * tools plus that block's own. The difference between them is the `mode` argument and nothing
 * else — there is no second copy of the save path, the rail, the console or the status dot.
 *
 * Read src/core/modes.ts for what a mode declares.
 */
export function bootShell(mode: ToolMode): void {
  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing element #${id}`);
    return el as T;
  };

  /** Every localStorage / OPFS key this page touches. Four pages share one origin, so a page
      that used the bare key would autosave over its neighbours (and resume their documents). */
  const ns = mode.storageNs;

  const deck = new DeckStore();
  const proposals = new ProposalStore();
  const previewFrame = $<HTMLIFrameElement>('preview');
  const registry = createModeRegistry(
    {
      deck,
      proposals,
      save: saveFromTool,
      // inspect_render measures in its OWN off-screen frame at a fixed, stated viewport, so the
      // verdict does not change with the human's window size and the visible deck is never disturbed.
      measure: measureRender,
    },
    mode
  );

  const preview = new Preview(previewFrame, $('empty-state'));

  const toasts = new Toasts($('toasts'));
  const say = (text: string, bad = false): void => toasts.show(text, bad);

  /* ---------- agent access: the status dot ----------
     The old status bar said "WebMCP: connected via document.modelContext — 29 tools" to everyone,
     including the people this page is FOR, who have never heard of modelContext. The dot says the
     same thing in colour; the popover says it in a sentence; and the measured technical string is
     still the button's accessible name, so nothing that could be read before is unreadable now.

     The count is THIS PAGE's registry, never a constant: a mini tool registers a different set,
     and a status line that claimed 29 tools on a page holding thirteen would be the one number
     in the app nobody could check.

     It is built BEFORE the rail: the rail's empty feed asks whether an agent is connected, so the
     answer has to exist by the time the first render runs. */

  const statusDot = $<HTMLButtonElement>('mcp-status');
  const statusText = $('mcp-status-text');
  const statusPopoverEl = $('mcp-popover');
  const statusPopover = new Popover(statusDot, statusPopoverEl);
  let connection: McpConnection | null = null;

  function paintStatus(mcp: McpConnection | null): void {
    const tools = registry.list().length;
    statusDot.dataset.state = mcp === null ? 'checking' : mcp.surface === 'none' ? 'off' : mcp.failed ? 'partial' : 'on';
    statusText.textContent =
      mcp === null
        ? 'WebMCP: checking…'
        : mcp.surface === 'none'
          ? `WebMCP: not available (console only) — ${tools} tools registered locally`
          : `WebMCP: connected via ${mcp.surface} — ${mcp.registered} tools${mcp.failed ? `, ${mcp.failed} refused` : ''}`;

    statusPopoverEl.replaceChildren();
    const line = (cls: string, body: string): void => {
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = body;
      statusPopoverEl.append(p);
    };
    if (mcp === null) {
      line('pop-lede', 'Looking for an agent host in this browser…');
    } else if (mcp.surface === 'none') {
      line('pop-lede', 'Agent access is off. Nothing outside this page can drive the Fold — the tool console below still can.');
      line('pop-note', `${tools} tools are registered locally and ready the moment a host appears.`);
      line('pop-note', 'To let an agent in this browser author this Fold, turn WebMCP on:');
      const how = document.createElement('pre');
      how.className = 'pop-code';
      how.textContent = 'chrome://flags/#enable-webmcp-testing\n— or launch Chrome with —\n--enable-features=WebMCP';
      statusPopoverEl.append(how);
      line('pop-note', 'Then reload this page.');
    } else {
      line('pop-lede', `Agent access is on — ${mcp.registered} tools registered. An agent in this browser can author this Fold.`);
      if (mcp.failed) line('pop-warn', `${mcp.failed} tools were refused by the host and are console-only.`);
    }
    // The measured string, verbatim, at the bottom of the card: the human sentence above it is a
    // reading of this, and a reading must never be the only copy.
    const tech = document.createElement('p');
    tech.className = 'pop-tech';
    tech.textContent = statusText.textContent ?? '';
    statusPopoverEl.append(tech);
  }

  paintStatus(null);

  /* ---------- presence ----------
     ONE seam for "a tool is running". Every route into the tools — the WebMCP shim, the console,
     a card click, the New button — reaches ToolRegistry.invoke, so wrapping that one method is
     the only way to light the rail for all of them without a second bookkeeping path to keep in
     step. src/core is not ours to edit, and it should not have to know a rail exists. */
  const invokeThroughRegistry = registry.invoke.bind(registry);
  let inFlight = 0;
  registry.invoke = async (name: string, args: unknown, source: ActivitySource = 'agent') => {
    inFlight++;
    rail.setBusy(name);
    try {
      return await invokeThroughRegistry(name, args, source);
    } finally {
      // Only the LAST call in flight clears it: an agent running three tools at once must not
      // have the first to finish claim the deck is idle.
      if (--inFlight === 0) rail.setBusy(null);
    }
  };

  /** Run a tool as the human. One code path, so a click is recorded exactly like an agent call. */
  const asHuman = (name: string, args: unknown) => registry.invoke(name, args, 'human');

  const rail = new ActivityRail(
    registry.activity,
    { list: $('activity-list'), live: $('rail-live'), liveTool: $('rail-live-tool') },
    {
      onGoto: (targetId) => preview.goto(targetId),
      onUndo: () => void undoLastChange(),
      canUndo: () => deck.isOpen() && deck.undoDepth() > 0,
      agentConnected: () => connection !== null && connection.surface !== 'none',
      onExplainAgents: () => statusPopover.show(),
    }
  );

  /** The rail's Undo goes through the tool, so the undo is itself an entry in the feed. */
  async function undoLastChange(): Promise<void> {
    const res = await asHuman('undo', {});
    const out = JSON.parse(res.content[0]?.text ?? '{}');
    say(res.isError ? String(out.error) : `Undone: ${out.undone}`, res.isError);
  }

  const review = new ReviewPanel($('proposal-list'), $('proposal-count'), deck, proposals, say, asHuman);

  new TestConsole(
    registry,
    {
      toggle: $<HTMLButtonElement>('console-toggle'),
      body: $('console-body'),
      list: $('tool-list'),
      count: $('tool-count'),
      name: $('tool-name'),
      desc: $('tool-desc'),
      schema: $('tool-schema'),
      form: $('tool-form'),
      modeForm: $<HTMLButtonElement>('btn-mode-form'),
      modeJson: $<HTMLButtonElement>('btn-mode-json'),
      args: $<HTMLTextAreaElement>('tool-args'),
      invoke: $<HTMLButtonElement>('btn-invoke'),
      state: $('run-state'),
      result: $('tool-result'),
    },
    mode.consoleGroups
  );

  void connectWebMcp(registry).then((mcp) => {
    connection = mcp;
    paintStatus(mcp);
    rail.render(); // the empty feed's "no agent is connected" line depends on the answer
  });

  /* ---------- deck lifecycle ---------- */

  let handle: FsaFileHandle | null = null;
  let autosaveTimer: number | undefined;

  const deckNameEl = $('deck-name');
  const saveStatus = $('save-status');
  const saveFile = $('save-file');
  const btnSave = $<HTMLButtonElement>('btn-save');
  const btnSaveAs = $<HTMLButtonElement>('btn-saveas');
  const savePip = $('save-pip');
  const saveMenu = new Popover($<HTMLButtonElement>('btn-savemenu'), $('save-popover'));

  function refreshChrome(): void {
    const state = deck.peek();
    if (!state) {
      // The title line is the DECK's name now; the filename it would be written to lives one
      // level down, in the Save menu, next to the state that decides whether writing is needed.
      deckNameEl.textContent = 'No Fold open';
      saveFile.textContent = 'No Fold open';
      saveStatus.textContent = 'No Fold open';
      savePip.hidden = true;
      btnSave.disabled = true;
      btnSaveAs.disabled = true;
      return;
    }
    deckNameEl.textContent = state.model.title;
    saveFile.textContent = state.name;
    /* "Not saved to a file yet" covers BOTH no-handle cases without lying about either: a Fold
       from create_deck has no file at all, and a dropped or sampled one has a file this page
       cannot write to. Only a granted handle earns "Saved to …". */
    saveStatus.textContent = state.dirty ? 'Unsaved changes' : handle ? `Saved to ${handle.name}` : 'Not saved to a file yet';
    savePip.hidden = false;
    savePip.className = state.dirty ? 'statepip dirty' : 'statepip saved';
    btnSave.title = state.dirty ? 'Unsaved changes' : saveStatus.textContent;
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
    // Opening or closing resets the undo stack, and neither is a tool call, so the rail has to be
    // told: otherwise the Undo button outlives the history it promises to reverse.
    rail.schedule();
    if (ev !== 'close') scheduleAutosave();
  });

  /* ---------- the page's own events ----------
     Tools record themselves at ToolRegistry.invoke. Opening a file, pressing Save and answering
     the resume card have no tool behind them, so the page pushes them into the SAME log — a feed
     that showed only what agents did would read as if the human were not there.

     The summary must NOT restate the verb: the rail draws a chip (OPEN, SAVE, DELETE) from the
     tool name already, and "OPEN open — welcome.origami.html" says the same word twice before it
     says anything. Every summary here starts at the thing acted on. */
  function pushHuman(tool: string, summary: string, opts: { ok?: boolean; error?: string; ms?: number } = {}): void {
    registry.activity.push({
      source: 'human',
      tool,
      ok: opts.ok !== false,
      ...(opts.error ? { error: opts.error } : {}),
      ms: opts.ms ?? 0,
      summary,
    });
  }

  /* An agent that just changed a fold should not have to say "look at fold 3" — the preview
     follows the newest agent write, and the replay is an agent's recorded run, so it follows that
     too (a demo that builds fold 6 while the viewer stares at the cover shows nothing). Console
     and human calls do NOT move the view: the person who made them is already looking where they
     meant to. */
  registry.activity.subscribe((entry) => {
    if ((entry.source === 'agent' || entry.source === 'replay') && entry.ok && entry.targetId) preview.goto(entry.targetId);
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
      writeAutosave(ns, deck.name(), deck.serialize(), proposals.all());
    }, 700) as unknown as number;
  }

  function openText(text: string, name: string, from: FsaFileHandle | null, how = 'open'): void {
    const started = Date.now();
    const where = how === 'resume' ? ' — from browser storage' : '';
    try {
      deck.open(text, name);
      handle = from;
      say(`Opened ${name}`);
      pushHuman(how, `"${name}"${where}`, { ms: Date.now() - started });
    } catch (e) {
      const why = (e as Error).message;
      say(`Not a readable Origami Fold: ${why}`, true);
      pushHuman(how, `"${name}"${where}`, { ok: false, error: why, ms: Date.now() - started });
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

  /**
   * The New button. On /folio/ it is create_deck — routed through the registry so the click is
   * recorded once, by the same code that records an agent making the same call.
   *
   * On a mini page create_deck is not registered (the page HAS its document, and a blank free
   * card is not a drawing), so New mints that page's own seeded document instead — the same
   * bytes it opened with.
   */
  async function newFold(): Promise<void> {
    if (!confirmDiscard()) return;
    deck.close(); // clears the dirty guard create_deck enforces for agents
    handle = null;
    if (mode.landing) {
      const res = await asHuman('create_deck', { title: 'Untitled deck' });
      if (res.isError) say(JSON.parse(res.content[0]!.text).error, true);
      else say('New Fold created — it is not on disk until you save it.');
      return;
    }
    await mintModeDoc();
  }

  /** Mint this page's seeded document and open it. Mini pages only. */
  async function mintModeDoc(): Promise<void> {
    const started = Date.now();
    try {
      await createModeDoc(deck, mode);
      say(`A fresh ${mode.doc!.label.toLowerCase()} — it is not on disk until you save it.`);
      pushHuman('new', `"${deck.name()}" — a seeded ${mode.doc!.label.toLowerCase()}`, { ms: Date.now() - started });
    } catch (e) {
      const why = (e as Error).message;
      say(`Could not start a ${mode.doc!.label.toLowerCase()}: ${why}`, true);
      pushHuman('new', `"${mode.doc!.deckTitle}"`, { ok: false, error: why, ms: Date.now() - started });
    }
  }

  $('btn-new').addEventListener('click', () => void newFold());

  if (mode.landing) {
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

    // Two buttons, one Fold: the toolbar's New and the landing's "New blank Fold" are the same
    // act, so they are the same function rather than two paths that could drift apart.
    $('btn-blank').addEventListener('click', () => void newFold());

    /* The landing's quiet line opens the SAME agent-access card the status dot does — one
       explanation of WebMCP in the app, reachable from the screen a newcomer is actually on. */
    $('btn-connect').addEventListener('click', () => statusPopover.show());

    wireReplay();
  }

  /* ---------- the replay ----------
     "Watch an agent build a deck" plays the RECORDED run in src/app/demo-script.ts — the same
     ordered tool calls `npm run demo` drives through Chrome's own WebMCP surface — one call at a
     time, through registry.invoke with source 'replay'. Nothing is faked: every fold is built by
     the tools an agent would call, the rail narrates each one, and the preview follows.

     It ends at list_chunks. There is deliberately no save_deck: a page that started a download
     because someone pressed play would be the app taking a liberty.

     A mini page has neither the button nor the tools the recorded run calls, so it never wires
     this up — hence the whole block behind mode.landing. */
  function wireReplay(): void {
    const REPLAY_STEP_MS = 900;
    const btnReplay = $<HTMLButtonElement>('btn-replay');
    const replayBar = $('replaybar');
    const replayStep = $('replay-step');

    let replaying = false;
    let stopReplay = false;
    /** Cuts the current wait short so Stop lands on the click, not up to a step later. */
    let wake: (() => void) | null = null;

    /** How long to wait between calls. `?replayDelay=<ms>` is a TEST HOOK: an e2e must not sit
        through eleven seconds of pacing to prove the replay builds a deck. */
    function replayDelayMs(): number {
      const raw = new URLSearchParams(location.search).get('replayDelay');
      const ms = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(ms) && ms >= 0 ? ms : REPLAY_STEP_MS;
    }

    const beat = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        if (ms <= 0) return resolve();
        const timer = setTimeout(resolve, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });

    async function runReplay(): Promise<void> {
      if (replaying) return;
      // The landing only shows with no Fold open, so this normally passes — it is here so the
      // button can never be the one control in the app that throws work away without asking.
      if (!confirmDiscard()) return;

      replaying = true;
      stopReplay = false;
      btnReplay.disabled = true;
      replayBar.hidden = false;
      const delay = replayDelayMs();
      const refs: Record<string, string> = {};
      let done = 0;
      let failed = '';

      try {
        for (const [i, call] of DEMO_CALLS.entries()) {
          if (stopReplay) break;
          replayStep.textContent = `Replaying ${i + 1} of ${DEMO_CALLS.length} — ${call.tool}`;
          const res = await registry.invoke(call.tool, bindRefs(call.args, refs), 'replay');
          done++;
          // Every tool here answers with one JSON block, but a tool that ever answered with a raw
          // string must stop the run with a message — not with an exception nobody sees.
          let body: any = {};
          try {
            body = JSON.parse(res.content[0]?.text ?? '{}');
          } catch {
            body = { error: res.content[0]?.text ?? 'the tool answered with something unreadable' };
          }
          if (res.isError) {
            failed = `${call.tool}: ${body.error ?? 'the call failed'}`;
            break;
          }
          learnRefs(call.tool, body, refs);
          if (stopReplay) break;
          await beat(delay);
        }
      } finally {
        wake = null;
        replaying = false;
        replayBar.hidden = true;
        btnReplay.disabled = false;
      }

      if (failed) say(`The replay stopped at ${failed} — what it built is still here.`, true);
      else if (stopReplay) say(`Replay stopped after ${done} of ${DEMO_CALLS.length} calls — what it built is still here.`);
      else say(`Built by replaying ${done} recorded tool calls — every step is in the Activity feed.`);
    }

    btnReplay.addEventListener('click', () => void runReplay());
    $('btn-stop-replay').addEventListener('click', () => {
      stopReplay = true;
      wake?.();
    });
  }

  btnSave.addEventListener('click', async () => {
    if (!deck.isOpen()) return;
    saveMenu.close();
    const started = Date.now();
    const text = deck.serialize(new Date().toISOString());
    if (handle) {
      const out = await saveToHandle(handle, text);
      if (out.ok) {
        deck.markSaved();
        clearAutosave(ns);
        say(`Saved to ${out.name}`);
        pushHuman('save', `"${out.name}" — ${out.bytes ?? text.length} bytes`, { ms: Date.now() - started });
      } else {
        say(`Save failed: ${out.reason}`, true);
        pushHuman('save', `"${deck.name()}"`, { ok: false, error: out.reason, ms: Date.now() - started });
      }
      refreshChrome();
      return;
    }
    await doSaveAs(text);
  });

  btnSaveAs.addEventListener('click', async () => {
    saveMenu.close();
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
    const opfs = await writeOpfs(ns, deck.name(), text);
    if (opfs.written) refreshLastSave();

    if (handle) {
      const out = await saveToHandle(handle, text);
      if (out.ok) {
        deck.markSaved();
        clearAutosave(ns);
        refreshChrome();
        say(`Saved to ${out.name} (by an agent)`);
        return { written: true, where: out.name, note: `written to the file on disk and read back: ${out.bytes} bytes.`, opfs };
      }
      writeAutosave(ns, deck.name(), text);
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
    writeAutosave(ns, deck.name(), text);
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
          ? `The complete Fold IS in this browser's private file system (${opfs.path}, ${opfs.bytes} bytes) and the human can retrieve it with "Download last save" in this page's Save menu. Browser storage is not persistent, so tell them to save it properly. `
          : `Browser storage was unavailable (${opfs.why}). `) +
        'Ask the human to press Save (or Save as…) to put it on their disk.',
    };
  }

  async function doSaveAs(text: string): Promise<void> {
    const started = Date.now();
    const res = await saveAs(text, deck.name());
    const ms = Date.now() - started;
    if (res.outcome.ok) {
      handle = res.handle;
      if (res.handle) deck.setName(res.handle.name);
      deck.markSaved();
      clearAutosave(ns);
      say(res.outcome.how === 'download' ? `Downloaded ${res.outcome.name}` : `Saved to ${res.outcome.name}`);
      pushHuman('save_as', `"${res.outcome.name}" — ${res.outcome.how}`, { ms });
    } else if (res.outcome.reason !== 'cancelled') {
      say(`Save failed: ${res.outcome.reason}`, true);
      pushHuman('save_as', `"${deck.name()}"`, { ok: false, error: res.outcome.reason, ms });
    }
    refreshChrome();
  }

  if (!canSaveInPlace()) btnSaveAs.title = 'This browser has no file picker — Save as downloads the Fold instead.';

  /* ---------- the way back out of browser storage ----------
     save_deck always writes the whole Fold into OPFS, which is real storage but INVISIBLE: nothing
     outside this origin can read it, so without this button an agent's "it is saved in the browser"
     would be true and useless. A click is a user gesture, so this download is never in doubt.
     It lives in the Save menu, whose chevron is never disabled — the bytes must stay reachable
     even with no Fold open, which is exactly the state a human lands in after a reload. */

  const btnLastSave = $<HTMLButtonElement>('btn-lastsave');

  function refreshLastSave(): void {
    const ptr = getPointer(ns);
    btnLastSave.hidden = ptr === null;
    if (ptr) {
      const kb = Math.max(1, Math.round(ptr.bytes / 1024));
      btnLastSave.textContent = `Download last save (${kb} KB)`;
      btnLastSave.title = `${ptr.name} — kept in this browser at ${new Date(ptr.at).toLocaleString()}. Browser storage is not permanent; save it somewhere you own.`;
    }
  }

  btnLastSave.addEventListener('click', async () => {
    saveMenu.close();
    const last = await readLastOpfs(ns);
    if (!last) {
      say('The last save is no longer in browser storage — the browser evicted it.', true);
      pushHuman('download_last_save', 'the last save', { ok: false, error: 'the browser evicted it' });
      refreshLastSave();
      return;
    }
    downloadBlob(last.text, last.name);
    say(`Downloading ${last.name} from browser storage.`);
    pushHuman('download_last_save', `"${last.name}" — out of browser storage`);
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

  /* ---------- resume last session ----------
     Folio: a card on the landing, not a pill in a status bar. The offer is only meaningful while
     nothing is open, and the landing is exactly the screen a human is looking at then — a pill in
     a strip they had already learned to ignore was the wrong place for the one control that
     recovers work.

     A mini page has no landing to put a card on, so it makes the SAME offer by acting on it: the
     unsaved work IS the document it opens with. The escape hatch is New, which mints a fresh
     seeded one — so nothing is trapped behind a stale record. */

  const saved = readAutosave(ns);

  if (mode.landing) {
    const resumeSlot = $('resume-slot');
    if (saved) {
      const when = new Date(saved.at).toLocaleString();
      resumeSlot.hidden = false;
      const head = document.createElement('div');
      head.className = 'resume-head';
      head.textContent = 'Unsaved work from this browser';
      const meta = document.createElement('div');
      meta.className = 'resume-meta';
      meta.textContent = `${saved.name} — ${when}`;
      const row = document.createElement('div');
      row.className = 'resume-actions';

      const resume = document.createElement('button');
      resume.type = 'button';
      resume.className = 'primary';
      resume.textContent = 'Resume';
      resume.setAttribute('data-testid', 'btn-resume');
      resume.addEventListener('click', () => {
        openText(saved.text, saved.name, null, 'resume');
        // AFTER openText: deck.open() emits 'open', and that handler clears the queue.
        proposals.restore(restorableProposals(saved.proposals));
        resumeSlot.hidden = true;
      });

      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'danger';
      discard.textContent = 'Discard';
      discard.setAttribute('data-testid', 'btn-discard');
      discard.addEventListener('click', () => {
        clearAutosave(ns);
        resumeSlot.hidden = true;
        say(`Discarded the unsaved work from ${when}.`);
        pushHuman('discard', `"${saved.name}" — unsaved work from ${when}`);
      });

      row.append(resume, discard);
      resumeSlot.append(head, meta, row);
    }
  }

  window.addEventListener('beforeunload', (ev) => {
    if (deck.peek()?.dirty) ev.preventDefault();
  });

  refreshChrome();
  void review.refresh();
  preview.render(deck);

  /* ---------- the mini page's document ----------
     Last, so every surface above is already wired when the Fold lands: the rail records the open,
     the preview renders it, the chrome names it. */
  if (!mode.landing) {
    if (saved) {
      openText(saved.text, saved.name, null, 'resume');
      proposals.restore(restorableProposals(saved.proposals));
    } else {
      void mintModeDoc();
    }
  }
}
