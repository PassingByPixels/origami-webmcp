import type { ToolResult } from './result.js';

/* ---------------------------------------------------------------------------------------
   NOT in the stdio server: a process that exits between calls has no session to keep a
   feed for. A page does, and the feed is what lets a human see what an agent did to their
   Fold without reading the deck diff.

   ONE log per registry. ToolRegistry.invoke records every call — the WebMCP shim and the
   in-page console both go through it, so there is no second write path to keep in step.
   The page pushes its OWN events (open, save, accept) through `push`, into the same list.
   --------------------------------------------------------------------------------------- */

/** Who declared the call. `agent` is the default because a tool invocation with no stated
    source is an MCP-shaped call; a caller that knows better says so. */
export type ActivitySource = 'agent' | 'human' | 'console' | 'replay';

export interface ActivityEntry {
  /** 1-based, monotonic per log. Survives the cap, so a gap means entries were dropped. */
  seq: number;
  /** ISO 8601, when the entry was recorded. */
  at: string;
  source: ActivitySource;
  /** Tool name, or a page-event name for entries the page pushed itself. */
  tool: string;
  ok: boolean;
  /** Present only when ok is false. Clipped — a feed row is not a stack trace. */
  error?: string;
  /** The chunk / proposal the call acted on, when there was one. */
  targetId?: string;
  /** Wall-clock duration of the call in ms. */
  ms: number;
  /** One human line. NEVER carries slide html — see summarize(). */
  summary: string;
}

/** What a caller hands `push`; the log stamps seq, and `at` when it is not supplied. */
export type ActivityInput = Omit<ActivityEntry, 'seq' | 'at'> & { at?: string };

/** Oldest entries are dropped past this. A feed is a recent history, not an audit trail:
    an unbounded list in a long agent run is a memory leak with a UI attached. */
export const ACTIVITY_CAP = 500;

/** Result bodies bigger than this are not parsed for a target id. read_chunk and
    export_deck return whole documents, and parsing one per call to find an id that the
    ARGS already carry would make the log cost more than the tools it watches. */
const RESULT_PARSE_LIMIT = 8000;

const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1) + '…');

/** Free text an agent supplied (a label, a title) may be anything, including markup. A feed
    row is plain text, so angle brackets are dropped rather than escaped downstream. */
const plain = (v: unknown): string => String(v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/* Arg fields that are safe to name in a summary, in the order they read best. `html`,
   `inner`, `def`, `fields`, `tokens` and `chips` are deliberately absent: they are
   payloads, and a summary carrying one would put the deck in the log. */
const SUMMARY_FIELDS: ReadonlyArray<[string, (v: unknown) => string]> = [
  ['mode', (v) => plain(v)],
  ['starter', (v) => `${plain(v)} starter`],
  ['block', (v) => `block ${plain(v)}`],
  ['kind', (v) => `kind ${plain(v)}`],
  ['type', (v) => plain(v)],
  ['foldType', (v) => `foldType ${plain(v)}`],
  ['themeName', (v) => `theme ${plain(v)}`],
  ['title', (v) => `"${clip(plain(v), 60)}"`],
  ['label', (v) => `"${clip(plain(v), 60)}"`],
  ['hidden', (v) => (v === true ? 'hidden' : 'un-hidden')],
  ['position', (v) => `at index ${plain(v)}`],
  ['topic', (v) => `topic ${plain(v)}`],
  ['limit', (v) => `limit ${plain(v)}`],
  ['dryRun', (v) => (v === true ? 'dry run' : '')],
];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function parseBody(result: ToolResult): Record<string, unknown> | null {
  const text = result.content[0]?.text ?? '';
  if (text.length === 0 || text.length > RESULT_PARSE_LIMIT) return null;
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // a tool that answered with a raw string, which carries no id anyway
  }
}

/**
 * A one-line, payload-free description of a call. Built from the ARGS ALONE — never from
 * the result body — so its cost does not grow with the size of the answer, and a tool that
 * returns a whole document cannot leak that document into the feed.
 */
export function summarize(tool: string, args: unknown): string {
  const a = asRecord(args);
  // only a target the CALL named: an id the result minted is already its own entry field,
  // and repeating it here would just make the line longer.
  const named = str(a.chunkId) ?? str(a.proposalId);
  const parts: string[] = [];
  for (const [key, render] of SUMMARY_FIELDS) {
    if (a[key] === undefined) continue;
    const frag = render(a[key]);
    if (frag) parts.push(frag);
    // the id sits after `mode` so delete_chunk reads "hide s1a2b3c4d", the way a human says it
    if (key === 'mode' && named) parts.push(named);
  }
  if (named && !parts.includes(named)) parts.unshift(named);
  return parts.length > 0 ? `${tool} — ${parts.join(' ')}` : tool;
}

export interface RecordInput {
  tool: string;
  args: unknown;
  result: ToolResult;
  source: ActivitySource;
  ms: number;
}

export class ActivityLog {
  private readonly rows: ActivityEntry[] = [];
  private seq = 0;
  private readonly listeners = new Set<(entry: ActivityEntry) => void>();

  /** Append one entry. The log owns `seq` and (unless supplied) `at`. */
  push(input: ActivityInput): ActivityEntry {
    const entry: ActivityEntry = { ...input, seq: ++this.seq, at: input.at ?? new Date().toISOString() };
    this.rows.push(entry);
    if (this.rows.length > ACTIVITY_CAP) this.rows.splice(0, this.rows.length - ACTIVITY_CAP);
    for (const l of [...this.listeners]) l(entry);
    return entry;
  }

  /** Derive an entry from a finished tool call and append it. Called by ToolRegistry.invoke. */
  record({ tool, args, result, source, ms }: RecordInput): ActivityEntry {
    const body = parseBody(result);
    const a = asRecord(args);
    const targetId =
      str(a.chunkId) ??
      str(a.proposalId) ??
      str(body?.chunkId) ??
      str(body?.foldId) ??
      str(body?.applied) ??
      str(body?.newChunkId);
    const ok = result.isError !== true;
    return this.push({
      source,
      tool,
      ok,
      ...(ok ? {} : { error: clip(str(body?.error) ?? result.content[0]?.text ?? 'failed', 200) }),
      ...(targetId ? { targetId } : {}),
      ms,
      summary: summarize(tool, args),
    });
  }

  /** Newest first, capped at `limit`. */
  recent(limit = 50): ActivityEntry[] {
    return this.rows.slice(Math.max(0, this.rows.length - limit)).reverse();
  }

  /** Every held entry, oldest first. */
  all(): ActivityEntry[] {
    return [...this.rows];
  }

  /** How many entries are held (never more than ACTIVITY_CAP); the newest seq is the
      count of everything ever recorded. */
  count(): number {
    return this.rows.length;
  }

  /** Notified once per appended entry — the page rail redraws from this. */
  subscribe(fn: (entry: ActivityEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
