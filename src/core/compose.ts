/* ONE CALL, ONE FOLD — the composer.
   ------------------------------------------------------------------------------------------
   Every WebMCP tool call is a model turn, and turns are what a deck costs. Before this file, a
   titled fold holding a chart was: add_chunk (a starter, or hand-assembled figure markup with
   the JSON re-escaped), then read_chunk, then write_chunk to put a heading on it — three turns
   and two big payloads for one card. add_fold takes the card as DATA — a title, an optional
   eyebrow, and an ordered list of blocks — and builds the markup itself.

   What it does NOT do is invent a second way to build a fold. The data blocks are built by
   blockFigure (the Studio palette's own dataFigure), validated by the format library's own
   per-kind validators, and the whole card goes through insertFold — the same bake, the same
   content policy, the same data gate, one op on the undo stack. The prose blocks are the
   recipes' markup, copied from src/core/recipes.ts rather than re-authored, because that markup
   is what the Studio's palette and the runtime's CSS agree on.

   Two things here are OPINIONS, and both are stated in the tool description because an agent
   cannot see the result:

     1. A chart with no plotHeight of its own gets COMPOSED_PLOT_HEIGHT, so that the reference
        card — eyebrow + h2 + one chart — FITS a 1280x720 screen instead of overflowing it. The
        chart schema's own default (318) does not; the number below was measured, not guessed
        (tests/e2e/app.spec.ts asserts fits:true on the real render).
     2. A stat card's number is only wrapped in data-count-to when it is a plain integer. The
        runtime's count-up does parseInt(attr) and writes String(Math.round(...)) into the
        element every frame, so "2.1%" would animate as "2" and "€48k" as "0"; both land right
        only at finalize. A decorated value is written as literal text instead, which renders
        correctly at every frame AND stays inline-editable (the editor skips [data-count-to]). */

import { escText, blockFigure, validatorFor } from './block-tools.js';
import type { Violation } from '../../vendor/format-dist/index.js';

/** The data kinds a composed block may be, in the order add_fold documents them. */
export const COMPOSE_DATA_KINDS = ['chart', 'venn', 'flow', 'graph', 'gantt', 'draw', 'table'] as const;

/** The prose kinds, which carry markup rather than a data block. */
export const COMPOSE_PROSE_KINDS = ['text', 'bullets', 'stats', 'quote'] as const;

export const COMPOSE_KINDS = [...COMPOSE_DATA_KINDS, ...COMPOSE_PROSE_KINDS] as const;

/**
 * MEASURED, not chosen: the plot-box height (viewBox units) a composed chart gets when it names
 * none. The chart schema's default is 318, which puts the reference card (eyebrow + h2 + one
 * captioned chart) 22px past a 1280x720 screen. 250 leaves the card measurably inside it while
 * keeping the marks large enough to read — see the fit test in tests/e2e/app.spec.ts.
 */
export const COMPOSED_PLOT_HEIGHT = 250;

/** A plain integer is the only value the runtime's count-up animates correctly. */
const INTEGER = /^-?\d+$/;

export interface ComposedBlock {
  kind: string;
  /** Index among blocks of the same kind on this fold — the `nth` get_block/set_block take. */
  nth: number;
}

export interface ComposeArgs {
  title?: string;
  eyebrow?: string;
  columns?: number;
  blocks?: unknown;
}

export type ComposeResult = { error: string; extra?: Record<string, unknown> } | { html: string; blocks: ComposedBlock[] };

const statCard = (value: unknown, label: unknown): string => {
  const v = String(value ?? '').trim();
  const big = INTEGER.test(v)
    ? `<div class="big" data-count-to="${escText(v)}">0</div>`
    : `<div class="big">${escText(v)}</div>`;
  return `<div class="stat-card">${big}<div class="lbl">${escText(String(label ?? ''))}</div></div>`;
};

/** One block's markup, or the reason it cannot be built. `i` is only for the error message. */
function blockHtml(b: Record<string, unknown>, i: number): { html: string; kind: string } | { error: string; extra?: Record<string, unknown> } {
  const named = COMPOSE_KINDS.filter((k) => b[k] !== undefined);
  if (named.length === 0) {
    return { error: `blocks[${i}] names no block — each block is exactly one of ${COMPOSE_KINDS.join(', ')}`, extra: { availableBlocks: [...COMPOSE_KINDS] } };
  }
  if (named.length > 1) {
    return { error: `blocks[${i}] names ${named.length} blocks (${named.join(', ')}) — a block is exactly one of them; split it into ${named.length} entries` };
  }
  const kind = named[0]!;
  const value = b[kind];

  if ((COMPOSE_DATA_KINDS as readonly string[]).includes(kind)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `blocks[${i}].${kind} must be the block's JSON object — got ${JSON.stringify(value)}` };
    }
    // a chart with no plot height of its own is sized to FIT; one that names its own is obeyed
    const data =
      kind === 'chart' && (value as { plotHeight?: unknown }).plotHeight === undefined
        ? { ...(value as object), plotHeight: COMPOSED_PLOT_HEIGHT }
        : value;
    const violations: Violation[] = validatorFor(kind)!(data);
    if (violations.length > 0) {
      return { error: `blocks[${i}].${kind} breaks its own schema — NOTHING was added and the Fold is unchanged`, extra: { violations } };
    }
    const caption = b.caption === undefined ? '' : String(b.caption);
    return { kind, html: blockFigure(kind, data, caption) };
  }

  if (kind === 'text') {
    if (typeof value !== 'string' || value.trim() === '') return { error: `blocks[${i}].text must be a non-empty HTML string, e.g. "<p>…</p>"` };
    // passed through verbatim: this is the recipes' vocabulary (p, p.lede, h3, ul/li), and the
    // content policy + the data gate downstream are what decide whether it may land
    return { kind, html: `<div class="o-text anim">${value}</div>` };
  }

  if (kind === 'bullets') {
    if (!Array.isArray(value) || value.length === 0) return { error: `blocks[${i}].bullets must be a non-empty array of strings` };
    return { kind, html: `<ul class="anim">${value.map((li) => `<li>${escText(String(li))}</li>`).join('')}</ul>` };
  }

  if (kind === 'stats') {
    if (!Array.isArray(value) || value.length === 0) return { error: `blocks[${i}].stats must be a non-empty array of { value, label }` };
    if (value.length > 4) return { error: `blocks[${i}].stats holds ${value.length} cards — a stat row takes at most 4; split it across two blocks` };
    const cards = value.map((s) => statCard((s as Record<string, unknown>)?.value, (s as Record<string, unknown>)?.label)).join('');
    return { kind, html: `<div class="card-grid anim" data-ocols="${value.length}">${cards}</div>` };
  }

  // quote
  const q = value as { text?: unknown; by?: unknown } | null;
  if (!q || typeof q !== 'object' || typeof q.text !== 'string' || q.text.trim() === '') {
    return { error: `blocks[${i}].quote must be { text: "…", by?: "…" }` };
  }
  const footer = typeof q.by === 'string' && q.by.trim() !== '' ? `<footer>${escText(q.by)}</footer>` : '';
  return { kind, html: `<blockquote class="o-quote anim"><p>${escText(q.text)}</p>${footer}</blockquote>` };
}

/**
 * Build the whole card. Returns the slide inner and the (kind, nth) address of every data block
 * on it, so the caller can hand an agent the addresses set_block takes without a second read.
 */
export function composeFold(args: ComposeArgs): ComposeResult {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return { error: 'title is required — it is the fold\'s heading and the default sidebar label' };
  if (!Array.isArray(args.blocks) || args.blocks.length === 0) {
    return { error: 'blocks must hold at least one block — a fold with a heading and nothing under it is a section header, which is one { text } block away', extra: { availableBlocks: [...COMPOSE_KINDS] } };
  }
  const columns = args.columns ?? 1;
  if (columns !== 1 && columns !== 2) return { error: `columns must be 1 or 2 — got ${JSON.stringify(args.columns)}` };

  const parts: string[] = [];
  const blocks: ComposedBlock[] = [];
  const seen: Record<string, number> = {};
  for (let i = 0; i < args.blocks.length; i++) {
    const raw = args.blocks[i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: `blocks[${i}] must be an object naming one block kind` };
    const built = blockHtml(raw as Record<string, unknown>, i);
    if ('error' in built) return built;
    parts.push(built.html);
    if ((COMPOSE_DATA_KINDS as readonly string[]).includes(built.kind)) {
      seen[built.kind] = (seen[built.kind] ?? -1) + 1;
      blocks.push({ kind: built.kind, nth: seen[built.kind]! });
    }
  }

  /* .o-tcols > .o-text is the grid the runtime CSS targets (recipes.text-columns-2), so a
     column child that is not a .o-text is simply not laid out as a column. A text block already
     carries its own .o-text wrapper, so it is put in the track as it stands. */
  const body =
    columns === 2
      ? `<div class="o-tcols anim" data-ocols="2">${parts.map((p) => (p.startsWith('<div class="o-text') ? p : `<div class="o-text">${p}</div>`)).join('')}</div>`
      : parts.join('');

  const head =
    (args.eyebrow ? `<p class="eyebrow anim" style="--i:0">${escText(String(args.eyebrow))}</p>` : '') +
    `<h2 class="anim" style="--i:1">${escText(title)}</h2>`;

  return { html: `<div class="slide-inner">${head}${body}</div>`, blocks };
}

/** The sidebar/tab label a composed fold gets when none is given. Agents forget `label`, and a
    rail reading "FREEFORM FREEFORM FREEFORM" is what that costs; the title is always right and
    always there. Trimmed on a word boundary where one is close enough. */
export function labelFromTitle(title: string, max = 28): string {
  const t = title.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max - 10 ? cut.slice(0, space) : cut).trimEnd() + '…';
}
