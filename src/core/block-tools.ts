/* The mini tools' TYPED block writers.
   ------------------------------------------------------------------------------------------
   /draw/, /charts/ and /gantt/ each scope the shell to ONE data block. write_chunk is still
   registered as the raw escape hatch, but an agent should not have to hand-assemble a figure
   and re-escape its JSON to move a rectangle — so each page also gets a handful of tools that
   speak the block's own vocabulary.

   THREE RULES HOLD FOR EVERY TOOL HERE, and they are what make them safe:

     1. ONE VALIDATOR. The data is checked by the FORMAT LIBRARY's own validator for that kind
        (validateDrawData / validateChartData / validateVennData / validateGanttData) — the
        same function save_deck runs at the end. Bad data is refused with the violations named
        and NOTHING is applied. There is no second opinion about what a chart is.
     2. ONE FIGURE BUILDER. The markup is built by dataFigure(), the Studio palette's own, so a
        figure this app writes and one the Studio writes are the same bytes.
     3. ONE WRITE GATE. The rebuilt fold inner goes through writeFoldInner — exactly what
        write_chunk calls. Same coercion, same content policy, same capability arithmetic, one
        undo step per call.

   They are as honest as the rest: a call changes the OPEN Fold and re-renders it; the human
   still saves. */

import {
  KINDS,
  extractDataBlocks,
  kindSchemaComment,
  validateChartData,
  validateDrawData,
  validateFlowData,
  validateGanttData,
  validateGraphData,
  validateTableData,
  validateVennData,
  CHART_TYPES,
  DRAW_FILL_STYLES,
  DRAW_FONTS,
  DRAW_MAX_ELEMENTS,
  DRAW_STROKE_STYLES,
  DRAW_TEXT_ALIGNS,
  DRAW_TYPES,
  type DeckModel,
  type Violation,
} from '../../vendor/format-dist/index.js';
import { fillDiagramDefaults } from './data-blocks.js';
import type { DeckStore } from './deck-store.js';
import { blockJson, dataFigure } from './fold-starters.js';
import { randomHex } from './ids.js';
import type { ToolMode } from './modes.js';
import type { JsonSchemaProp, ToolDef } from './registry.js';
import { fail, ok, refuse } from './result.js';
import { writeFoldInner, type ToolDeps } from './tools.js';

/** The format library's own shape check, per kind. Nothing here re-implements one. */
const VALIDATORS: Record<string, (data: unknown) => Violation[]> = {
  draw: validateDrawData as (data: unknown) => Violation[],
  chart: validateChartData as (data: unknown) => Violation[],
  venn: validateVennData as (data: unknown) => Violation[],
  gantt: validateGanttData as (data: unknown) => Violation[],
  flow: validateFlowData as (data: unknown) => Violation[],
  graph: validateGraphData as (data: unknown) => Violation[],
  table: validateTableData as (data: unknown) => Violation[],
};

/** The data kinds /folio/'s typed block tools address, in the order get_block reports them.
    Every one of them is a FIGURE this app knows how to rebuild (dataFigure), which is what
    makes set_block safe to point at a whole block rather than at markup. */
export const FOLIO_BLOCK_KINDS = ['chart', 'venn', 'flow', 'graph', 'gantt', 'draw', 'table'] as const;

/** The one validator for a data kind, for callers outside this file (the fold composer). There
    is no second opinion about what a chart is, so there is no second map either. */
export const validatorFor = (kind: string): ((data: unknown) => Violation[]) | undefined => VALIDATORS[kind];

const DATA_OPEN = (kind: string): string => `<script type="application/json" data-odata="${kind}">`;

/** A figcaption is TEXT. Escaping is not politeness: an unescaped "<" in a caption could open a
    tag inside the figure, and one of those tags is <template>, which the content policy rejects
    — so an un-escaped caption would turn a caption into a refusal, or worse into markup. */
export const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Where a block lives right now: which fold, which kind, its data, and the exact span of the
    <figure> that carries it, so a rewrite is one splice and everything around it survives. */
export interface BlockSite {
  chunkId: string;
  kind: string;
  data: unknown;
  caption: string;
  /** The whole <figure>…</figure>, verbatim. */
  figure: string;
  /** The fold's whole inner, and the figure's offsets inside it. */
  inner: string;
  start: number;
  end: number;
}

/** The data block itself — the exact span of `<script … data-odata="KIND">…</script>` and the
    JSON inside it. `nth` counts blocks of that kind in the fold from 0, which is how a fold
    holding two charts is addressed. This is the ONE scan; figureAround widens its answer to the
    enclosing figure, and the folio writers fall back to it when a block has no figure at all. */
function dataScript(inner: string, kind: string, nth: number): { data: unknown; start: number; bodyEnd: number; end: number } | null {
  const open = DATA_OPEN(kind);
  let at = -1;
  for (let i = 0; i <= nth; i++) {
    at = inner.indexOf(open, at + 1);
    if (at < 0) return null;
  }
  const bodyEnd = inner.indexOf('</script>', at);
  if (bodyEnd < 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(inner.slice(at + open.length, bodyEnd));
  } catch (e) {
    refuse(`the ${kind} block in this Fold is not valid JSON (${(e as Error).message}) — repair it with write_chunk, or press New for a fresh one`);
  }
  return { data, start: at, bodyEnd, end: bodyEnd + '</script>'.length };
}

/** The <figure> that encloses this kind's data block, found from the block OUTWARD — keyed on
    the carrier the format actually enforces, never on a class name a hand edit could restyle. */
function figureAround(inner: string, kind: string, nth = 0): Omit<BlockSite, 'chunkId' | 'inner'> | null {
  const s = dataScript(inner, kind, nth);
  if (!s) return null;
  const figStart = inner.lastIndexOf('<figure', s.start);
  const figEnd = inner.indexOf('</figure>', s.start);
  if (figStart < 0 || figEnd < 0) return null;
  /* A fold may hold SEVERAL figures (add_fold builds those). The nearest "<figure" before this
     block is only its carrier if no "</figure>" closed in between — otherwise it belongs to the
     figure before this one, and splicing that span would delete a sibling block. */
  if (inner.lastIndexOf('</figure>', s.start) > figStart) return null;
  const end = figEnd + '</figure>'.length;
  const figure = inner.slice(figStart, end);
  const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure);
  return { kind, data: s.data, caption: cap ? cap[1]! : '', figure, start: figStart, end };
}

/** The first fold carrying a block of one of this page's kinds. */
export function findBlock(m: DeckModel, kinds: readonly string[]): BlockSite | null {
  for (const chunkId of m.order) {
    const inner = m.slides.get(chunkId)!.inner;
    for (const kind of kinds) {
      const hit = figureAround(inner, kind);
      if (hit) return { ...hit, chunkId, inner };
    }
  }
  return null;
}

function requireSite(deck: DeckStore, mode: ToolMode): BlockSite {
  const kinds = mode.blockKinds ?? [];
  const site = findBlock(deck.model(), kinds);
  if (!site) {
    refuse(
      `the open Fold carries no ${kinds.join(' or ')} block, and this page edits exactly one. ` +
        `Press New for a fresh ${mode.doc?.deckTitle.replace(/^Untitled /, '') ?? 'document'}, or rebuild the figure with write_chunk ` +
        `(call origami_guide for the block's markup contract).`,
      { blockKinds: [...kinds] }
    );
  }
  return site!;
}

/** Build the figure this kind's schema specifies. o-<kind>fig / o-<kind> / data-<kind>-mount is
    the shape every one of the four schemaComments states; dataFigure emits exactly that. */
export const blockFigure = (kind: string, data: unknown, caption: string): string =>
  dataFigure(kind, `o-${kind}fig`, `o-${kind}`, data, escText(caption));

/**
 * Validate, rebuild, write. The ONE mutating path every tool in this file uses.
 *
 * `kind` may differ from `site.kind` — that is set_venn swapping a chart figure for a venn one,
 * and it is why the whole figure is replaced rather than just its JSON.
 */
function applyBlock(deck: DeckStore, site: BlockSite, kind: string, data: unknown, caption: string): void {
  const violations = VALIDATORS[kind]!(data);
  if (violations.length > 0) {
    refuse(`the ${kind} data breaks its own schema — NOTHING was applied and the Fold is unchanged`, { violations });
  }
  const next = site.inner.slice(0, site.start) + blockFigure(kind, data, caption) + site.inner.slice(site.end);
  writeFoldInner(deck, site.chunkId, next);
}

const APPLIED = 'applied to the open Fold and re-rendered — not yet on disk (the human saves).';

/* ---------------------------------------------------------------- draw ---------------------- */

type El = Record<string, unknown>;

/** Every field a draw element may carry, per kindSchemaComment('draw'). Anything else an agent
    sends is DROPPED rather than stored: the validator ignores unknown keys, so a typo would
    otherwise ride into the saved file for ever, silently doing nothing. */
const EL_KEYS = [
  'id', 'type', 'x', 'y', 'width', 'height', 'angle', 'stroke', 'fill', 'fillStyle', 'strokeWidth',
  'strokeStyle', 'roughness', 'opacity', 'seed', 'points', 'text', 'fontSize', 'font', 'textAlign',
  'name', 'attach',
] as const;

const pickEl = (args: Record<string, unknown>): El => {
  const out: El = {};
  for (const k of EL_KEYS) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

const num = (description: string): JsonSchemaProp => ({ type: 'number', description });

/** The element schema, shared by add_element (as the call) and update_element (as the patch). */
const ELEMENT_PROPS: Record<string, JsonSchemaProp> = {
  type: { type: 'string', enum: DRAW_TYPES, description: `Shape: ${DRAW_TYPES.join(' | ')}` },
  x: num('Scene x of the element origin'),
  y: num('Scene y of the element origin'),
  width: num('Width in scene units (>= 0)'),
  height: num('Height in scene units (>= 0)'),
  stroke: { type: 'string', description: 'Line colour, a #hex — required by the draw schema' },
  fill: { type: 'string', description: '"" for none, or a #hex' },
  fillStyle: { type: 'string', enum: DRAW_FILL_STYLES, description: `${DRAW_FILL_STYLES.join(' | ')}` },
  strokeWidth: num('1-8'),
  strokeStyle: { type: 'string', enum: DRAW_STROKE_STYLES, description: `${DRAW_STROKE_STYLES.join(' | ')}` },
  roughness: num('0, 1 or 2 — how hand-drawn the stroke looks'),
  opacity: num('0-100'),
  angle: num('Rotation in degrees'),
  seed: num('Integer 1..2147483647 — drives the deterministic jitter. Minted when absent'),
  points: { type: 'array', description: 'arrow/line/freedraw: [[dx,dy], …] relative to x,y, at least 2 pairs', items: { type: 'array' } },
  text: { type: 'string', description: 'text elements: the string to draw' },
  fontSize: num('text: 6-200'),
  font: { type: 'string', enum: DRAW_FONTS, description: `text: ${DRAW_FONTS.join(' | ')}` },
  textAlign: { type: 'string', enum: DRAW_TEXT_ALIGNS, description: `text: ${DRAW_TEXT_ALIGNS.join(' | ')}` },
  name: { type: 'string', maxLength: 40, description: 'A short unique name so a later prompt can address this element by meaning' },
  attach: { type: 'object', description: 'arrow/line only: { from?: elementId, to?: elementId } — glues the ends to other elements' },
};

const elements = (site: BlockSite): El[] => {
  const list = (site.data as { elements?: unknown }).elements;
  return Array.isArray(list) ? (list as El[]) : [];
};

const withElements = (site: BlockSite, list: El[]): unknown => ({ ...(site.data as object), elements: list });

function drawTools(deck: DeckStore, mode: ToolMode): ToolDef[] {
  const site = () => requireSite(deck, mode);
  const byId = (list: El[], id: string): number => list.findIndex((e) => e.id === id);

  return [
    {
      name: 'list_elements',
      annotations: { readOnlyHint: true },
      description:
        'READ THE SCENE FIRST. Every element in the drawing on this page, in draw order, with its id, type, geometry and style — the exact objects that live in the block\'s JSON. Element ids are how add/update/remove address the scene, so nothing else here is safe to call blind. Also reports the canvas box (w x h) new elements should be placed inside, and the caption under the figure.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const s = site();
        const d = s.data as { w?: number; h?: number };
        const list = elements(s);
        return ok({
          chunkId: s.chunkId,
          canvas: { w: d.w ?? null, h: d.h ?? null },
          count: list.length,
          maxElements: DRAW_MAX_ELEMENTS,
          caption: s.caption,
          elements: list,
        });
      },
    },

    {
      name: 'add_element',
      description:
        'Add ONE element to the drawing — this CHANGES THE DRAWING on this page and re-renders it immediately. Pass the element\'s own fields (type, x, y, width, height, stroke, …) as the arguments; `id` and `seed` are MINTED when you leave them out, so a simple shape needs neither. Geometry, enums and colours are checked by the draw schema itself and a bad value is refused with the violation named — nothing is applied. arrow/line/freedraw need `points`; text needs `text`. Call list_elements first: coordinates are scene units and new work belongs inside the canvas box that call reports.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...ELEMENT_PROPS,
          id: { type: 'string', maxLength: 40, description: 'Element id (minted when absent). Keep ids stable — they are how you address it later' },
        },
        required: ['type', 'x', 'y', 'width', 'height', 'stroke'],
      },
      execute: async (args) => {
        const s = site();
        const el = pickEl(args);
        if (typeof el.id !== 'string' || el.id.length === 0) el.id = 'e' + randomHex(4);
        if (el.seed === undefined) el.seed = 1 + Math.floor(Math.random() * 2147483646);
        const list = elements(s);
        if (byId(list, el.id as string) >= 0) return fail(`element "${el.id}" already exists — use update_element to change it, or leave id out to mint a new one`);
        const next = [...list, el];
        applyBlock(deck, s, 'draw', withElements(s, next), s.caption);
        return ok({ added: el.id, seed: el.seed, index: next.length - 1, count: next.length, note: APPLIED });
      },
    },

    {
      name: 'update_element',
      description:
        'Patch ONE element of the drawing by id — this CHANGES THE DRAWING on this page and re-renders it immediately. Only the fields you name in `patch` change; everything else on that element is left exactly as it was. An id that is not in the scene is REFUSED with the ids that are (never created, never guessed at). The patched element is re-checked against the draw schema before anything is applied, so a move that would put a shape outside the coordinate limits, or a value outside an enum, is refused with the violation named.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Element id from list_elements' },
          patch: { type: 'object', description: 'The fields to change, e.g. {"x": 120, "stroke": "#B3402A"}. An `id` here is ignored — ids are addresses, not properties', properties: ELEMENT_PROPS },
        },
        required: ['id', 'patch'],
      },
      execute: async ({ id, patch }) => {
        const s = site();
        const list = elements(s);
        const at = byId(list, id);
        if (at < 0) return fail(`unknown element "${id}" — call list_elements`, { availableIds: list.map((e) => e.id) });
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return fail('patch must be an object of element fields');
        const fields = pickEl(patch as Record<string, unknown>);
        // an id is an ADDRESS, not a property: renaming through a patch would answer "updated
        // <old id>" about an element that no longer has that id
        delete fields.id;
        const next = [...list];
        next[at] = { ...list[at], ...fields };
        applyBlock(deck, s, 'draw', withElements(s, next), s.caption);
        return ok({ updated: id, element: next[at], note: APPLIED });
      },
    },

    {
      name: 'remove_element',
      annotations: { destructiveHint: true },
      description:
        'Remove ONE element from the drawing by id — it is GONE from the scene (undo brings it back; nothing else does). An unknown id is refused with the ids that exist. An element another element is ATTACHED to cannot be removed on its own: the scene would name a party that is not there, so the draw schema refuses the whole change and the drawing is left alone — detach or remove the arrow first.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', description: 'Element id from list_elements' } },
        required: ['id'],
      },
      execute: async ({ id }) => {
        const s = site();
        const list = elements(s);
        const at = byId(list, id);
        if (at < 0) return fail(`unknown element "${id}" — call list_elements`, { availableIds: list.map((e) => e.id) });
        const next = list.filter((_, i) => i !== at);
        applyBlock(deck, s, 'draw', withElements(s, next), s.caption);
        return ok({
          removed: id,
          count: next.length,
          ...(next.length === 0 ? { warning: 'the scene is now EMPTY — the figure renders as nothing at all until you add an element' } : {}),
          note: APPLIED,
        });
      },
    },
  ];
}

/* ---------------------------------------------------------------- charts -------------------- */

function chartTools(deck: DeckStore, mode: ToolMode): ToolDef[] {
  const site = () => requireSite(deck, mode);
  return [
    {
      name: 'get_data',
      annotations: { readOnlyHint: true },
      description:
        'READ THE FIGURE FIRST. What this page is currently showing: whether it is a chart or a Venn diagram, the block\'s whole JSON exactly as it is stored, and the caption. set_chart and set_venn REPLACE that JSON wholesale rather than patching it, so read it here, edit what you have read, and send the whole thing back.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const s = site();
        return ok({ chunkId: s.chunkId, kind: s.kind, caption: s.caption, data: s.data, schema: kindSchemaComment(s.kind) });
      },
    },

    {
      name: 'set_chart',
      description:
        'Set the WHOLE chart on this page — this CHANGES THE FIGURE the human is looking at and re-renders it immediately. `chart` is the complete chart JSON (type, labels, series, yMax, plus any of the optional presentation fields); it REPLACES what is there, so read get_data first if you mean to keep part of it. Every rule of the chart schema is enforced before anything is applied: an unknown type, a series whose values do not have one number per label, a colour that is not a #hex, a flag on a type that cannot draw it — each is refused with the violation named, and the figure is left untouched. If the page is currently showing a Venn diagram, this swaps the figure back to a chart.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chart: {
            type: 'object',
            description: `The whole chart JSON: { type: ${CHART_TYPES.join('|')}, labels: [...], series: [{name, color:"#hex", values:[...]}], yMax: number|null, … }. Call origami_guide for the full contract.`,
          },
          caption: { type: 'string', maxLength: 200, description: 'Optional: the caption under the figure (left alone when absent)' },
        },
        required: ['chart'],
      },
      execute: async ({ chart, caption }) => {
        const s = site();
        applyBlock(deck, s, 'chart', chart, caption ?? s.caption);
        return ok({ chunkId: s.chunkId, kind: 'chart', was: s.kind, type: (chart as { type?: string })?.type, note: APPLIED });
      },
    },

    {
      name: 'set_venn',
      description:
        'Make this page show a VENN DIAGRAM of 2-6 overlapping sets, replacing whatever figure is there — this CHANGES THE FIGURE the human is looking at and re-renders it immediately. `venn` is the complete venn JSON: count, one labelled and #hex-coloured entry in `sets` per count, and optional named `overlaps` placed by percent. sets.length must equal count; a mismatch, a bad colour or an overlap naming a circle that does not exist is refused with the violation named and nothing is applied. get_data then reports kind "venn"; set_chart swaps back.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          venn: {
            type: 'object',
            description: 'The whole venn JSON: { count: 2|3|4|5|6, sets: [{label, color:"#hex"}], overlaps?: [{sets:[int], label, x, y}] }',
          },
          caption: { type: 'string', maxLength: 200, description: 'Optional: the caption under the figure (left alone when absent)' },
        },
        required: ['venn'],
      },
      execute: async ({ venn, caption }) => {
        const s = site();
        applyBlock(deck, s, 'venn', venn, caption ?? s.caption);
        return ok({ chunkId: s.chunkId, kind: 'venn', was: s.kind, note: APPLIED });
      },
    },
  ];
}

/* ---------------------------------------------------------------- gantt --------------------- */

function ganttTools(deck: DeckStore, mode: ToolMode): ToolDef[] {
  const site = () => requireSite(deck, mode);
  return [
    {
      name: 'get_roadmap',
      annotations: { readOnlyHint: true },
      description:
        'READ THE ROADMAP FIRST. The whole gantt JSON on this page exactly as it is stored — totalWeeks, startDate, lenses, swimlanes, cards and milestones — plus the caption. set_roadmap REPLACES that JSON wholesale rather than patching it, so read it here, edit what you have read, and send the whole thing back.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const s = site();
        return ok({ chunkId: s.chunkId, caption: s.caption, roadmap: s.data, schema: kindSchemaComment('gantt') });
      },
    },

    {
      name: 'set_roadmap',
      description:
        'Set the WHOLE roadmap on this page — this CHANGES THE ROADMAP the human is looking at and re-renders it immediately. `roadmap` is the complete gantt JSON; it REPLACES what is there, so read get_roadmap first if you mean to keep part of it. The gantt schema is enforced before anything is applied: a card naming a swimlane or a lens that is not declared, a duplicate card id, a start or a milestone week outside totalWeeks, an effort or type outside the enum — each is refused with the violation named and the roadmap is left untouched.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roadmap: {
            type: 'object',
            description:
              'The whole gantt JSON: { totalWeeks, startDate: "YYYY-MM-DD"|null, lenses: [{name, color}], swimlanes: [{name, owner}], cards: [{id, title, swimlane, start, durationWeeks, lens, type, effort, what, needs, caveat, deliverable, sources, completed}], milestones: [{label, week, color}] }',
          },
          caption: { type: 'string', maxLength: 200, description: 'Optional: the caption under the figure (left alone when absent)' },
        },
        required: ['roadmap'],
      },
      execute: async ({ roadmap, caption }) => {
        const s = site();
        applyBlock(deck, s, 'gantt', roadmap, caption ?? s.caption);
        const d = roadmap as { swimlanes?: unknown[]; cards?: unknown[] };
        return ok({
          chunkId: s.chunkId,
          swimlanes: Array.isArray(d?.swimlanes) ? d.swimlanes.length : 0,
          cards: Array.isArray(d?.cards) ? d.cards.length : 0,
          note: APPLIED,
        });
      },
    },
  ];
}

/* ---------------------------------------------------------------- shared -------------------- */

/** set_caption is the one tool all three pages share, and it does NOT rebuild the figure: it
    replaces the caption text in place, so a figure a human tuned with write_chunk keeps every
    attribute it was given. */
function captionTool(deck: DeckStore, mode: ToolMode): ToolDef {
  return {
    name: 'set_caption',
    description:
      'Set the caption printed under the figure on this page — this CHANGES THE FOLD the human is looking at and re-renders it. The caption is TEXT: "<" and "&" are escaped, so it can never smuggle markup into the fold. Pass "" to clear it. Nothing about the block\'s data is touched.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { caption: { type: 'string', maxLength: 200, description: 'The line under the figure ("" clears it)' } },
      required: ['caption'],
    },
    execute: async ({ caption }) => {
      if (typeof caption !== 'string') return fail(`caption must be a string — got ${JSON.stringify(caption)}`);
      const s = requireSite(deck, mode);
      const text = `<figcaption>${escText(caption)}</figcaption>`;
      const figure = /<figcaption[^>]*>[\s\S]*?<\/figcaption>/.test(s.figure)
        ? s.figure.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/, text)
        : s.figure.replace(/<\/figure>$/, `${text}</figure>`);
      writeFoldInner(deck, s.chunkId, s.inner.slice(0, s.start) + figure + s.inner.slice(s.end));
      return ok({ chunkId: s.chunkId, caption, note: APPLIED });
    },
  };
}

/* ---------------------------------------------------------------- folio --------------------
   The mini pages each scope the shell to ONE block, so their writers need no address: there is
   exactly one figure and requireSite finds it. /folio/ holds a whole deck, so the same two
   operations — read a block's JSON, replace a block's JSON — need one: a chunk id, the kind,
   and which of that kind (nth). Everything else is shared: the same VALIDATORS, the same
   dataFigure, the same writeFoldInner. */

/** Every data block in a fold inner, in document order, with its index among blocks of its own
    kind — the (kind, nth) pair get_block and set_block address. */
export function blockIndex(inner: string): Array<{ kind: string; nth: number }> {
  const seen: Record<string, number> = {};
  return extractDataBlocks(inner).map((b) => {
    seen[b.kind] = (seen[b.kind] ?? -1) + 1;
    return { kind: b.kind, nth: seen[b.kind]! };
  });
}

const inventory = (inner: string): string => {
  const list = blockIndex(inner);
  return list.length === 0 ? 'no data blocks at all' : list.map((b) => `${b.kind}[${b.nth}]`).join(', ');
};

function folioTools(deck: DeckStore): ToolDef[] {
  const KIND_LIST = FOLIO_BLOCK_KINDS.join(' | ');

  /** The fold, or a refusal naming the tool that lists them. */
  const innerOf = (chunkId: string): string => {
    const slide = deck.model().slides.get(chunkId);
    if (!slide) refuse(`unknown chunk "${chunkId}" — call list_chunks`);
    return slide!.inner;
  };

  return [
    {
      name: 'get_block',
      annotations: { readOnlyHint: true },
      description: "READ A DATA BLOCK BEFORE YOU REPLACE IT. Returns one data block's JSON exactly as stored, plus its caption and kind schema. Address it by chunkId + kind (chart | venn | flow | graph | gantt | draw | table) and nth when the fold holds more than one of that kind (0 = first, the default). Leave kind out to get EVERY data block on the fold — one call instead of one per block. set_block REPLACES a block rather than patching it, so read here, edit what you read, send the whole thing back. Changes nothing.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          kind: { type: 'string', enum: FOLIO_BLOCK_KINDS, description: `One block kind: ${KIND_LIST}. Omit for every block on the fold` },
          nth: { type: 'integer', minimum: 0, description: 'Which block of that kind, 0-based (default 0)' },
        },
        required: ['chunkId'],
      },
      execute: async ({ chunkId, kind, nth }) => {
        const inner = innerOf(chunkId);
        if (kind === undefined) {
          const blocks = blockIndex(inner).map((b) => {
            const site = figureAround(inner, b.kind, b.nth);
            const script = site ?? dataScript(inner, b.kind, b.nth);
            return { kind: b.kind, nth: b.nth, caption: site?.caption ?? '', data: script?.data ?? null };
          });
          return ok({
            chunkId,
            count: blocks.length,
            blocks,
            note: blocks.length === 0 ? 'this fold carries no data blocks — it is prose, or empty.' : `edit one with set_block({chunkId:"${chunkId}", kind, data}).`,
          });
        }
        const site = figureAround(inner, kind, nth ?? 0);
        const script = site ?? dataScript(inner, kind, nth ?? 0);
        if (!script) {
          return fail(`this fold carries no ${kind} block at nth ${nth ?? 0}. It holds: ${inventory(inner)}`, { blocks: blockIndex(inner) });
        }
        return ok({ chunkId, kind, nth: nth ?? 0, caption: site?.caption ?? '', data: script.data, schema: kindSchemaComment(kind) });
      },
    },

    {
      name: 'set_block',
      description: "Replace the WHOLE JSON of one data block on one fold — this CHANGES THE DECK the human is looking at and re-renders it. Address it by chunkId + kind (chart | venn | flow | graph | gantt | draw | table) + nth (0 = first, the default) and pass the COMPLETE data: it REPLACES what is there, so call get_block first to keep part of it. The kind's validator runs before anything is applied and a bad shape is refused with the violation named; a table's formulas are baked; a flow/graph node with no `tone` and an edge with no `label` get \"\" (their legal blank, no meaning changes). A fold with no block of that kind is refused with the kinds it has — this never CREATES one, use add_fold. One undo step.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          kind: { type: 'string', enum: FOLIO_BLOCK_KINDS, description: `The block kind to replace: ${KIND_LIST}` },
          data: { type: 'object', description: "The block's COMPLETE JSON — call get_kind_schema(kind) for the shape" },
          caption: { type: 'string', maxLength: 200, description: 'Optional: the caption under the figure ("" clears it; left alone when absent)' },
          nth: { type: 'integer', minimum: 0, description: 'Which block of that kind, 0-based (default 0)' },
        },
        required: ['chunkId', 'kind', 'data'],
      },
      execute: async ({ chunkId, kind, data: raw, caption, nth }) => {
        const inner = innerOf(chunkId);
        // flow/graph tone and edge label are required with "" as their blank — a pure default
        const data = fillDiagramDefaults(kind, raw);
        const n = nth ?? 0;
        const site = figureAround(inner, kind, n);
        const script = site ?? dataScript(inner, kind, n);
        if (!script) {
          return fail(`this fold carries no ${kind} block at nth ${n}. It holds: ${inventory(inner)}`, { blocks: blockIndex(inner) });
        }
        const violations = VALIDATORS[kind]!(data);
        if (violations.length > 0) {
          return fail(`the ${kind} data breaks its own schema — NOTHING was applied and the Fold is unchanged`, { violations });
        }
        /* Two carriers exist. Every figure this app builds is a <figure>, and that whole figure
           is rebuilt so the mount div and the caption stay in step with the data. A block in a
           hand-rolled wrapper (the table starter's .o-table-shell) has no figure to rebuild, so
           only the JSON is replaced — the wrapper the human is looking at is left exactly as it is. */
        const next = site
          ? inner.slice(0, site.start) + blockFigure(kind, data, caption ?? site.caption) + inner.slice(site.end)
          : inner.slice(0, script.start) + `${DATA_OPEN(kind)}\n${blockJson(data)}\n</script>` + inner.slice(script.end);
        writeFoldInner(deck, chunkId, next);
        return ok({
          chunkId,
          kind,
          nth: n,
          ...(site ? { caption: caption ?? site.caption } : { captionApplied: false, why: 'this block has no <figure>/<figcaption> carrier, so only its JSON was replaced' }),
          note: APPLIED,
        });
      },
    },
  ];
}

/** The two typed block tools /folio/ adds on top of buildTools. Mini pages do not get them:
    each of those edits exactly one block and has a writer that needs no address. */
export const buildFolioBlockTools = (deps: ToolDeps): ToolDef[] => folioTools(deps.deck);

const BUILDERS: Record<string, (deck: DeckStore, mode: ToolMode) => ToolDef[]> = {
  draw: drawTools,
  charts: chartTools,
  gantt: ganttTools,
};

/**
 * The block tools for one mini mode. Folio gets none: it has add_chunk and the whole kind
 * catalog, which is a superset of what these do for one kind.
 */
export function buildBlockTools(deps: ToolDeps, mode: ToolMode): ToolDef[] {
  const build = BUILDERS[mode.key];
  if (!build) return [];
  return [...build(deps.deck, mode), captionTool(deps.deck, mode)];
}

/** The block kinds a mode addresses, with the names the format library gives them — used by the
    page guide so the prose and the validator can never name different things. */
export const blockNames = (mode: ToolMode): Array<{ kind: string; name: string }> =>
  (mode.blockKinds ?? []).map((k) => ({ kind: k, name: KINDS[k]?.name ?? k }));
