import type { ActivityEntry, ActivityLog } from '../core/activity.js';

/**
 * The Activity rail — what has been DONE to this Fold, newest first, whoever did it.
 *
 * It replaces the Review queue rather than sitting beside it: staged proposals were only ever
 * one KIND of thing an agent does, and a panel that showed nothing until a propose_* call made
 * the app look asleep while an agent was writing folds into it. One feed, one source of truth
 * (core's ActivityLog, which ToolRegistry.invoke writes on every call from every route), and
 * the proposal cards keep their place at the head of it.
 */

/* The chip vocabulary. The design spec names ten; the tool list does not fit in ten, so three more
   were added rather than leaving rows chipless: STAGE (a propose_* that changed nothing yet),
   REVIEW (resolving one) and READ (every read-only tool). Nothing is invented per row — the
   chip is a pure function of the tool name. */
const CHIPS: Record<string, string> = {
  add_chunk: 'ADD',
  add_fold: 'ADD',
  add_ledger: 'ADD',
  add_custom_fold: 'ADD',
  write_chunk: 'EDIT',
  move_chunk: 'MOVE',
  set_chunk_meta: 'META',
  set_deck_meta: 'META',
  apply_theme: 'META',
  set_header: 'META',
  set_fold_type: 'META',
  define_block: 'META',
  delete_block: 'META',
  delete_chunk: 'DELETE',
  save_deck: 'SAVE',
  export_deck: 'EXPORT',
  undo: 'UNDO',
  create_deck: 'NEW',
  propose_chunk: 'STAGE',
  propose_add: 'STAGE',
  propose_delete: 'STAGE',
  accept_proposal: 'REVIEW',
  reject_proposal: 'REVIEW',
  /* the mini tool pages' typed block writers (src/core/block-tools.ts). Their read-only
     siblings — list_elements, get_data, get_roadmap — fall through to READ. */
  add_element: 'ADD',
  update_element: 'EDIT',
  remove_element: 'DELETE',
  set_chart: 'EDIT',
  set_venn: 'EDIT',
  set_roadmap: 'EDIT',
  set_caption: 'META',
  /* /folio/'s typed block writer (src/core/block-tools.ts). get_block falls through to READ. */
  set_block: 'EDIT',
  /* the page's own events — pushed, not invoked */
  open: 'OPEN',
  /* a mini tool page minting its seeded document. It replaces the whole deck, exactly as
     create_deck does, so it wears the same chip AND resets the undo walk below. */
  new: 'NEW',
  resume: 'OPEN',
  discard: 'DELETE',
  save: 'SAVE',
  save_as: 'SAVE',
  download_last_save: 'SAVE',
};

/** Tools whose effect `undo` can reverse — the list in the undo tool's own description. */
const UNDOABLE = new Set([
  'write_chunk',
  'add_chunk',
  'add_custom_fold',
  'add_fold',
  'add_ledger',
  'move_chunk',
  'set_chunk_meta',
  'set_deck_meta',
  'apply_theme',
  'delete_chunk',
  'define_block',
  'delete_block',
  'set_header',
  'set_fold_type',
  'accept_proposal',
  // the mini pages' block writers: each applies exactly one op through writeFoldInner
  'add_element',
  'update_element',
  'remove_element',
  'set_chart',
  'set_venn',
  'set_roadmap',
  'set_caption',
  'set_block',
]);

/** Events that RESET the undo stack — nothing before one of these is reversible. */
const UNDO_RESETS = new Set(['create_deck', 'open', 'resume', 'new']);

/** How many rows are drawn. The log holds 500; a rail is a recent history, not an archive. */
const ROWS = 60;

function chipFor(entry: ActivityEntry): string {
  // delete_chunk's mode is not on the entry, but summarize() puts it first in the summary —
  // "delete_chunk — hide s1a2b3c4d" — and that is the only place the distinction survives.
  if (entry.tool === 'delete_chunk' && / — hide\b/.test(entry.summary)) return 'HIDE';
  return CHIPS[entry.tool] ?? 'READ';
}

/**
 * The seq of the newest entry `undo` would actually reverse, or null.
 *
 * Undo is a stack, so exactly one row may offer the button: offering it on three rows would
 * promise three independent reversals the deck cannot give. Each successful `undo` in the feed
 * has already consumed one undoable entry, so they cancel out as the walk goes back; a
 * create_deck or an open resets the stack and ends the walk.
 */
export function newestUndoable(entries: readonly ActivityEntry[]): number | null {
  let consumed = 0;
  for (const e of entries) {
    if (UNDO_RESETS.has(e.tool)) return null;
    if (!e.ok) continue;
    if (e.tool === 'undo') {
      consumed++;
      continue;
    }
    if (!UNDOABLE.has(e.tool)) continue;
    if (consumed > 0) {
      consumed--;
      continue;
    }
    return e.seq;
  }
  return null;
}

/** "now", "12s", "4m", "2h", then the date. */
export function relative(at: string, now = Date.now()): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  if (ms < 3000) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return new Date(at).toLocaleDateString();
}

/** Times are drawn, not bound, so an idle feed would freeze at "now". One slow tick fixes it. */
const TICK_MS = 30_000;

export interface RailHooks {
  /** A row that names a fold was clicked — take the preview there. */
  onGoto: (targetId: string) => void;
  /** The single Undo button was pressed. */
  onUndo: () => void;
  /** True while the deck has at least one recorded step left to reverse. */
  canUndo: () => boolean;
  /** True when a WebMCP host is connected — the empty feed says so either way. */
  agentConnected: () => boolean;
  /** Opens the agent-access popover from the empty feed's quiet line. */
  onExplainAgents: () => void;
}

export class ActivityRail {
  private frame: number | undefined;

  constructor(
    private readonly log: ActivityLog,
    private readonly els: { list: HTMLElement; live: HTMLElement; liveTool: HTMLElement },
    private readonly hooks: RailHooks
  ) {
    els.list.addEventListener('click', (ev) => this.onClick(ev));
    // A row that navigates is a control, so it answers the keyboard like one.
    els.list.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-target]');
      if (!row || row !== ev.target) return;
      ev.preventDefault();
      this.hooks.onGoto(row.dataset.target!);
    });
    // One redraw per animation frame: an agent batching twenty add_chunk calls emits twenty
    // entries, and twenty full redraws in one tick is twenty times the work for one result.
    log.subscribe(() => this.schedule());
    setInterval(() => {
      if (this.log.count() > 0) this.schedule();
    }, TICK_MS);
    this.render();
  }

  /** The live indicator: a tool name while a call is in flight, nothing when idle. */
  setBusy(tool: string | null): void {
    this.els.live.hidden = tool === null;
    this.els.liveTool.textContent = tool ?? '';
  }

  schedule(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.render();
    });
  }

  render(): void {
    const entries = this.log.recent(ROWS);
    if (entries.length === 0) {
      this.els.list.replaceChildren(this.emptyFeed());
      return;
    }
    const undoAt = this.hooks.canUndo() ? newestUndoable(entries) : null;
    this.els.list.replaceChildren(...entries.map((e) => this.row(e, e.seq === undoAt)));
  }

  private emptyFeed(): HTMLElement {
    const box = document.createElement('li');
    box.className = 'feed-empty';
    box.setAttribute('data-testid', 'feed-empty');
    box.append(text('p', '', 'Agent activity lands here. Every tool call — yours, the console’s or an agent’s — is one line.'));
    if (!this.hooks.agentConnected()) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'linky';
      link.dataset.act = 'explain';
      link.textContent = 'No agent is connected — what is this?';
      box.append(link);
    }
    return box;
  }

  private row(entry: ActivityEntry, withUndo: boolean): HTMLElement {
    const li = document.createElement('li');
    li.className = entry.ok ? 'arow' : 'arow bad';
    li.setAttribute('data-testid', 'activity-row');
    li.dataset.seq = String(entry.seq);
    li.dataset.source = entry.source;
    if (entry.targetId) {
      li.dataset.target = entry.targetId;
      li.classList.add('goto');
      li.title = `Show ${entry.targetId} in the preview`;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
    }

    const head = document.createElement('div');
    head.className = 'arow-head';
    head.append(text('span', 'chip', chipFor(entry)));
    head.append(text('span', 'arow-summary', entry.error ? `${entry.summary} — ${entry.error}` : entry.summary));
    // Who and when share the right column: one line per row is the rail's whole rhythm, and a
    // second line for a single word doubled the height of every entry in the feed.
    head.append(text('span', 'arow-time', `${entry.source} · ${relative(entry.at)}`));
    li.append(head);

    if (withUndo) {
      const foot = document.createElement('div');
      foot.className = 'arow-foot';
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'ghost undo';
      undo.dataset.act = 'undo';
      undo.setAttribute('data-testid', 'btn-undo');
      undo.textContent = 'Undo';
      foot.append(undo);
      li.append(foot);
    }
    return li;
  }

  private onClick(ev: Event): void {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (btn?.dataset.act === 'undo') {
      ev.stopPropagation(); // Undo must not also navigate the preview to the row's fold
      this.hooks.onUndo();
      return;
    }
    if (btn?.dataset.act === 'explain') {
      this.hooks.onExplainAgents();
      return;
    }
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-target]')?.dataset.target;
    if (target) this.hooks.onGoto(target);
  }
}

function text(tag: string, cls: string, body: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = body;
  return el;
}
