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
     2. A stat card's number is wrapped in data-count-to whenever it holds at least one digit.
        The vendored runtime (vendor/runtime-dist/index.js) parses the value with a regex that
        finds the numeric core and keeps whatever sits before/after it as a literal prefix/suffix
        (decimals and thousands grouping read off the matched digits too), so "€48k" counts up
        as "€0k" .. "€48k" and "2.1%" as "0.0%" .. "2.1%" — MEASURED through the real render
        (tools/agent-bridge.mjs, 2026-09-02): a mid-animation frame read "€26k"/"667"/"1.1%" for
        target values "€48k"/"1,240"/"2.1%", and the settled frame was byte-exact to all three.
        A value with NO digit at all (a plain label used as a "value") is passed through as
        literal text unanimated, which the parse falls back to safely. The trade a decorated
        value now makes is the same one an integer stat always made: [data-count-to] elements
        are skipped by the inline editor, so the number is edited with set_block, not by clicking
        the rendered text. */

import { escText, blockFigure, validatorFor } from './block-tools.js';
import { GRAPH_FIT_HEIGHT, MIN_GRAPH_HEIGHT } from './fold-starters.js';
import { fillDiagramDefaults } from './data-blocks.js';
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

/** The chart schema's own floor. A plot box under this is not a chart, it is a sparkline. */
export const MIN_PLOT_HEIGHT = 180;

/** What ONE prose block costs a chart on the same card, in viewBox units. MEASURED at 1280x720
    through the real render: the same chart fold is 742px with no prose and 849px with one lede
    paragraph above it, and the slope of rendered height against plotHeight is exactly 1.0 px
    per unit (318 -> 849, 250 -> 781, 200 -> 731). So a paragraph costs 107. */
const PROSE_COST = 107;

/**
 * How tall a composed chart's plot box may be on THIS card.
 *
 * MEASURED, not chosen, at 1280x720 through the real render:
 *
 *     eyebrow + h2 + captioned chart          plotHeight 318 -> 849 with a lede, 742 without
 *     the same fold WITH one lede paragraph   318 -> 849 · 250 -> 781 · 220 -> 751 · 200 -> 731 · 180 -> FITS
 *
 * The schema's default of 318 overflows even with no prose (that is the 22px a cold agent hit);
 * 250 fits. Then Haiku's trial fold added a lede above the chart and overflowed again, because
 * the paragraph is height the chart no longer has — 107px of it.
 *
 * So every prose block on the card (text | bullets | stats | quote) takes PROSE_COST off the
 * plot box, floored at MIN_PLOT_HEIGHT. In practice that makes the rule binary: one paragraph
 * costs more than the distance from 250 to the floor, so a card with any prose on it gets 180.
 * The floor is real rather than cosmetic — below it the marks stop being readable, and the
 * honest answer for a card that still will not fit is that it is overfull, which is
 * inspect_render's to say (a THREE-line paragraph will still overflow at 180). A chart that
 * names its own plotHeight is obeyed and none of this applies.
 */
export function chartPlotHeight(blocks: unknown[]): number {
  return Math.max(MIN_PLOT_HEIGHT, COMPOSED_PLOT_HEIGHT - proseCount(blocks) * PROSE_COST);
}

/** How many blocks on this card are prose — the height a data block on it no longer has. */
const proseCount = (blocks: unknown[]): number =>
  blocks.filter(
    (b) => b !== null && typeof b === 'object' && !Array.isArray(b) && COMPOSE_PROSE_KINDS.some((k) => (b as Record<string, unknown>)[k] !== undefined)
  ).length;

/** The CSS px range `width` / `height` accept. The ceilings are the runtime's own: 2600px is the
    widest .slide-inner it lays out, 2160 the tallest viewport inspect_render will measure. The
    floors are the point below which the block stops being readable rather than merely small. */
export const SIZE_RANGE = { width: [160, 2600], height: [120, 2160] } as const;

/**
 * The kinds whose CSS actually READS --obw / --obh, and the kinds' own controls for the two that
 * do not. MEASURED, not read off a doc: every --obw/--obh rule in vendor/runtime-dist/index.js
 * was greped, then each kind was rendered twice on one card — once with --obw:600px;--obh:300px
 * on the figure, once bare — and the block's own box read in the real preview (2026-09-03):
 *
 *     venn 166 vs 318 · flow 166 vs 318 · graph 166 vs 318 · gantt 166 vs 319 · table 166 vs 318
 *     chart 182 vs 182 · draw 318 vs 318      (preview px — the ratio is the finding)
 *
 * So a size on a chart or a drawing would render EXACTLY the same markup and change nothing.
 * That is refused, not dropped: an agent that cannot see the deck has no other way to learn it.
 * Each of those two has its own control inside the block's JSON instead, and the refusal says so.
 */
const SIZED_KINDS = ['venn', 'flow', 'graph', 'gantt', 'table'] as const;

/** Kinds whose figure reads --obw but not --obh. `chart` joined on the Folio 610e732 runtime
    (figure.o-chartfig { width: min(var(--obw,100%),100%) } — before that a chart read neither, the
    182 vs 182 above); its height is still the plot box inside its own JSON. */
const WIDTH_ONLY_KINDS = ['chart'] as const;

const OWN_SIZE_CONTROL: Record<string, string> = {
  chart: 'a chart\'s HEIGHT is `plotHeight` inside its own JSON (the composer already fits that to the card) — `width` is accepted, `height` is not',
  draw: 'a drawing is sized by `wpct` (10-100, a percent of the measure) inside its own JSON, and its height follows the canvas aspect',
};

/**
 * The `style` attribute one block's figure gets — the block-size grips' own carrier.
 *
 * `width` -> --obw, `height` -> --obh, in CSS px, and ONLY the one that was named: a figure with
 * neither is byte-identical to the one this composer built before the grips existed.
 *
 * A size the runtime would not read is REFUSED rather than dropped — on a prose block, which has
 * no data figure to carry it, and on chart/draw, whose CSS ignores it (see SIZED_KINDS).
 */
function blockSize(b: Record<string, unknown>, i: number, kind: string, defaultHeight: number): { style: string } | { error: string } {
  const named = (['width', 'height'] as const).filter((k) => b[k] !== undefined);
  const widthOnly = (WIDTH_ONLY_KINDS as readonly string[]).includes(kind);
  const ignored = widthOnly ? named.filter((k) => k === 'height') : (SIZED_KINDS as readonly string[]).includes(kind) ? [] : named;
  if (ignored.length > 0) {
    const why = OWN_SIZE_CONTROL[kind] ?? `only a data block (${SIZED_KINDS.join(', ')}) carries a size`;
    return { error: `blocks[${i}] names ${ignored.join(' and ')} on a ${kind} block, which the runtime would ignore — ${why}. NOTHING was added and the Fold is unchanged` };
  }
  const px: string[] = [];
  for (const k of ['width', 'height'] as const) {
    const v = b[k];
    if (v === undefined) continue;
    const [lo, hi] = SIZE_RANGE[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      return { error: `blocks[${i}].${k} must be a whole number of CSS px between ${lo} and ${hi} — got ${JSON.stringify(v)}. NOTHING was added and the Fold is unchanged` };
    }
    px.push(`${k === 'width' ? '--obw' : '--obh'}:${v}px`);
  }
  if (b.height === undefined && defaultHeight > 0) px.push(`--obh:${defaultHeight}px`);
  return { style: px.join(';') };
}

/** The default height a kind gets on THIS card when the block names none, 0 for "leave it to the
    runtime". Only `graph` has one, and it pays PROSE_COST per prose block for the same reason a
    chart does — see GRAPH_FIT_HEIGHT and chartPlotHeight. */
export function graphFitHeight(blocks: unknown[]): number {
  return Math.max(MIN_GRAPH_HEIGHT, GRAPH_FIT_HEIGHT - proseCount(blocks) * PROSE_COST);
}

/** Any value the runtime's count-up can find a number inside of — see the header comment. */
const HAS_DIGIT = /\d/;

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
  const big = HAS_DIGIT.test(v)
    ? `<div class="big" data-count-to="${escText(v)}">0</div>`
    : `<div class="big">${escText(v)}</div>`;
  return `<div class="stat-card">${big}<div class="lbl">${escText(String(label ?? ''))}</div></div>`;
};

/** One block's markup, or the reason it cannot be built. `i` is only for the error message;
    `plotHeight` and `graphHeight` are the heights the CARD decided a chart and a graph on it can
    afford (see chartPlotHeight, graphFitHeight). */
function blockHtml(b: Record<string, unknown>, i: number, plotHeight: number, graphHeight: number): { html: string; kind: string } | { error: string; extra?: Record<string, unknown> } {
  const named = COMPOSE_KINDS.filter((k) => b[k] !== undefined);
  if (named.length === 0) {
    return { error: `blocks[${i}] names no block — each block is exactly one of ${COMPOSE_KINDS.join(', ')}`, extra: { availableBlocks: [...COMPOSE_KINDS] } };
  }
  if (named.length > 1) {
    return { error: `blocks[${i}] names ${named.length} blocks (${named.join(', ')}) — a block is exactly one of them; split it into ${named.length} entries` };
  }
  const kind = named[0]!;
  const value = b[kind];
  // the block's own size, checked for EVERY kind so a prose block naming one is refused here
  const box = blockSize(b, i, kind, kind === 'graph' ? graphHeight : 0);
  if ('error' in box) return box;

  if ((COMPOSE_DATA_KINDS as readonly string[]).includes(kind)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `blocks[${i}].${kind} must be the block's JSON object — got ${JSON.stringify(value)}` };
    }
    // a chart with no plot height of its own is sized to FIT; one that names its own is obeyed
    const sized =
      kind === 'chart' && (value as { plotHeight?: unknown }).plotHeight === undefined
        ? { ...(value as object), plotHeight }
        : value;
    // flow/graph tone and edge label are REQUIRED with "" as their blank; filling them changes
    // no meaning and saves the refusal both trial agents ate (see fillDiagramDefaults)
    const data = fillDiagramDefaults(kind, sized);
    const violations: Violation[] = validatorFor(kind)!(data);
    if (violations.length > 0) {
      return { error: `blocks[${i}].${kind} breaks its own schema — NOTHING was added and the Fold is unchanged`, extra: { violations } };
    }
    const caption = b.caption === undefined ? '' : String(b.caption);
    return { kind, html: blockFigure(kind, data, caption, box.style) };
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

  const plotHeight = chartPlotHeight(args.blocks);
  const graphHeight = graphFitHeight(args.blocks);
  const parts: string[] = [];
  const blocks: ComposedBlock[] = [];
  const seen: Record<string, number> = {};
  for (let i = 0; i < args.blocks.length; i++) {
    const raw = args.blocks[i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: `blocks[${i}] must be an object naming one block kind` };
    const built = blockHtml(raw as Record<string, unknown>, i, plotHeight, graphHeight);
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

/**
 * The COVER a fresh Fold opens on — the deck's own title, not a placeholder.
 *
 * create_deck used to mint FREE_STARTER_INNER: an h2 reading "New fold" and a lede reading
 * "Write here." Both cold-agent trials paid for that. One overwrote it (read_chunk +
 * write_chunk, two turns); the other added its own cover fold and then had to list_chunks and
 * delete_chunk to get rid of the placeholder, three. The deck already knows its title, so the
 * first fold can simply BE the cover.
 *
 * The markup is the `cover` kind's own schema, verbatim: ".slide-inner wraps everything /
 * .eyebrow = small uppercase label - h1 = deck title - .lede = supporting paragraph". An absent
 * eyebrow or subtitle emits NO element rather than a placeholder one, so a fresh Fold contains
 * no invented text anywhere.
 */
export function coverInner(title: string, subtitle?: string, eyebrow?: string): string {
  const line = (cls: string, tag: string, text: string, i: number): string =>
    `<${tag} class="${cls}anim" style="--i:${i}">${escText(text)}</${tag}>`;
  const parts: string[] = [];
  if (eyebrow && eyebrow.trim()) parts.push(line('eyebrow ', 'p', eyebrow.trim(), parts.length));
  parts.push(line('', 'h1', title.trim(), parts.length));
  if (subtitle && subtitle.trim()) parts.push(line('lede ', 'p', subtitle.trim(), parts.length));
  return `<div class="slide-inner">${parts.join('')}</div>`;
}
