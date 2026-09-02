/* add_fold and add_ledger — the composer's two tools.
   ------------------------------------------------------------------------------------------
   They live beside the composer rather than in tools.ts for one reason: tools.ts owns the write
   paths (buildInsert, insertFold, writeFoldInner) and block-tools.ts owns the figure builders,
   so a file that needs BOTH has to sit downstream of them. mode-registry.ts registers these on
   /folio/ only, exactly as it does the typed block writers. */

import { activeContentFlags } from '../../vendor/format-dist/index.js';
import { COMPOSE_DATA_KINDS, COMPOSE_KINDS, COMPOSED_PLOT_HEIGHT, composeFold, labelFromTitle } from './compose.js';
import type { JsonSchemaProp, ToolDef } from './registry.js';
import { fail, ok } from './result.js';
import { insertFold, type ToolDeps } from './tools.js';

const KIND_LIST = COMPOSE_KINDS.join(' | ');

/** The shared head of both tools' schemas: what the CARD is, as opposed to what is on it. */
const CARD_PROPS: Record<string, JsonSchemaProp> = {
  title: { type: 'string', maxLength: 200, description: "The fold's heading (rendered as the h2) and the default sidebar label" },
  eyebrow: { type: 'string', maxLength: 80, description: 'The small label line above the heading, e.g. "Q3 review" (omit for none)' },
  label: { type: 'string', maxLength: 200, description: 'Sidebar/tab label (default: the title, trimmed to ~28 characters)' },
  position: { type: 'integer', minimum: 0, description: '0-based insert index (default: the end)' },
};

export function buildComposeTools(deps: ToolDeps): ToolDef[] {
  const { deck } = deps;

  /* MEASURED at 1280x720 through the real render (tools/agent-bridge.mjs, 2026-09-02): a card
     holding an eyebrow, a heading and ONE flow figure comes out 875px tall against 720px of
     screen. The cause is the runtime's own diagram viewBox, which is a fixed 1200x660 — at a
     1160px content width that figure alone is ~640px, and no composer choice shrinks it. It is
     not this tool's to fix, and an agent cannot see it, so the fact is handed back instead of
     hidden. inspect_render still has the real number for the deck actually built. */
  const DIAGRAM_WARNING =
    'a flow/graph figure is drawn on a FIXED 1200x660 viewBox, so at 1280px wide it alone is about 640px tall — this card measured 875px against a 720px screen in testing. Keep the diagram alone on its fold, keep the heading short, and confirm with inspect_render.';

  /** Both tools answer the same way: what landed, and how to address what is on it. */
  const added = (out: { id: string; index: number; inner: string; grants: string[] }, label: string, blocks: Array<{ kind: string; nth: number }>) =>
    ok({
      chunkId: out.id,
      index: out.index,
      label,
      blocks,
      capabilitiesGranted: out.grants,
      activeContent: activeContentFlags(out.inner).map((v) => v.rule),
      ...(blocks.some((b) => b.kind === 'flow' || b.kind === 'graph') ? { layoutWarning: DIAGRAM_WARNING } : {}),
      note: 'added to the open Fold as ONE fold and re-rendered — not yet on disk (the human saves). Edit any block above with set_block({chunkId, kind, nth, data}); check the layout with inspect_render.',
    });

  return [
    {
      name: 'add_fold',
      description:
        `BUILD A WHOLE FOLD IN ONE CALL — this CHANGES THE DECK the human is looking at and re-renders it immediately. Give the card as DATA and the markup is built for you: an eyebrow line, a heading, then \`blocks\` in order. Each entry in blocks names EXACTLY ONE of: ${KIND_LIST}. The seven data blocks take that kind's own JSON (call get_kind_schema for the shape) plus an optional caption; text takes an HTML string in the free-card vocabulary (p, p.lede, h3, ul/li); bullets takes an array of strings; stats takes up to 4 { value, label } cards; quote takes { text, by? }. Every data block is checked against its own schema before anything is added and a bad one is refused naming the block index and the violation; a table's formulas are baked. columns:2 lays the blocks out in two tracks. A chart that names no plotHeight is given ${COMPOSED_PLOT_HEIGHT} so that a heading plus one chart FITS a 1280x720 screen — pass your own to override. One call is ONE fold and ONE undo step. Returns the chunkId and the (kind, nth) address of every data block, which is what set_block takes.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_PROPS,
          columns: { type: 'integer', minimum: 1, description: '1 (default) or 2 — lay the blocks out in two tracks' },
          blocks: {
            type: 'array',
            description: `The card's content, in order. Each entry names exactly ONE of: ${KIND_LIST} — e.g. { "chart": { "type": "bar", "labels": ["Q1","Q2"], "series": [{ "name": "Revenue", "color": "#4A8CC4", "values": [12,19] }], "yMax": null }, "caption": "Revenue by quarter" }, or { "stats": [{ "value": "48", "label": "Decks shipped" }] }, or { "text": "<p class=\\"lede\\">A line of copy.</p>" }`,
            items: { type: 'object' },
          },
        },
        required: ['title', 'blocks'],
      },
      execute: async (args) => {
        const built = composeFold(args);
        if ('error' in built) return fail(built.error, built.extra);
        const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : labelFromTitle(String(args.title));
        const out = insertFold(deck, { kind: 'free', html: built.html, position: args.position, label });
        return added(out, label, built.blocks);
      },
    },

    {
      name: 'add_ledger',
      description:
        'ADD A LEDGER FOLD IN ONE CALL — a titled card holding one live spreadsheet block — this CHANGES THE DECK the human is looking at and re-renders it immediately. `columns` are the table\'s column definitions ([{ label, align?, format? }] — format is an OBJECT, e.g. { "kind": "currency" }, never a string) and `rows` its cells as strings. `formulas` maps a cell (A1 notation) to a formula ("D3": "=SUM(D1:D2)"); the calc engine RUNS them on the way in and the values are what land in the file, so the saved Fold carries numbers, not an engine. named / totals / kpis / cellFormats are passed through to the table schema. The whole table is checked against that schema first and a bad shape is refused with the violation named, changing nothing. This is add_fold with one table block: use add_fold when the card needs anything else on it. One call is one undo step.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_PROPS,
          columns: { type: 'array', description: 'Column definitions: [{ label, align?: "left"|"right"|"center", format?: { kind: "general"|"number"|"currency"|"percent"|"date"|"text", … } }]', items: { type: 'object' } },
          rows: { type: 'array', description: 'Cells, row by row, as strings: [["Rent","1200"], …]. Leave a formula cell "" — it is filled by the calc engine', items: { type: 'array' } },
          formulas: { type: 'object', description: 'Cell -> formula in A1 notation, e.g. { "B3": "=SUM(B1:B2)" }' },
          named: { type: 'object', description: 'Named outputs other blocks can reference, e.g. { "grandTotal": "=B3" }' },
          totals: { type: 'object', description: 'The table schema\'s totals row — call get_kind_schema("table") for its shape' },
          kpis: { type: 'array', description: 'Pinned KPI cells — call get_kind_schema("table") for their shape', items: { type: 'object' } },
          cellFormats: { type: 'object', description: 'Per-cell format overrides keyed by A1 reference, e.g. { "B3": { "kind": "currency" } }' },
          caption: { type: 'string', maxLength: 200, description: 'The line under the table (default: none)' },
        },
        required: ['title', 'columns', 'rows'],
      },
      execute: async ({ title, eyebrow, label, position, caption, columns, rows, formulas, named, totals, kpis, cellFormats }) => {
        const table: Record<string, unknown> = { columns, rows };
        for (const [k, v] of Object.entries({ formulas, named, totals, kpis, cellFormats })) if (v !== undefined) table[k] = v;
        const built = composeFold({ title, eyebrow, blocks: [{ table, ...(caption === undefined ? {} : { caption }) }] });
        if ('error' in built) return fail(built.error, built.extra);
        const name = typeof label === 'string' && label.trim() ? label.trim() : labelFromTitle(String(title));
        const out = insertFold(deck, { kind: 'free', html: built.html, position, label: name });
        return added(out, name, built.blocks);
      },
    },
  ];
}

/** Re-exported so the guide and the tests name the same list the composer accepts. */
export { COMPOSE_DATA_KINDS, COMPOSE_KINDS };
