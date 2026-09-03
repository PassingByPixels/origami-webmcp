/* add_fold and add_ledger — the composer's two tools.
   ------------------------------------------------------------------------------------------
   They live beside the composer rather than in tools.ts for one reason: tools.ts owns the write
   paths (buildInsert, insertFold, writeFoldInner) and block-tools.ts owns the figure builders,
   so a file that needs BOTH has to sit downstream of them. mode-registry.ts registers these on
   /folio/ only, exactly as it does the typed block writers. */

import { activeContentFlags } from '../../vendor/format-dist/index.js';
import { COMPOSE_DATA_KINDS, COMPOSE_KINDS, COMPOSED_PLOT_HEIGHT, SIZE_RANGE, composeFold, labelFromTitle } from './compose.js';
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

/**
 * Put the ledger's currency PREFIX on every currency-kind column that does not name its own.
 *
 * MEASURED in vendor/format-dist/cell-format.js: `const sym = fmt?.currency ?? '$'`, and that
 * symbol is printed LITERALLY rather than resolved from an ISO code - "EUR" renders
 * "EUR1,234.50", "\u20ac" renders "\u20ac1,234.50". So this is one top-level argument instead of
 * the same key repeated on every money column, and the default that caught both trial agents
 * (they wrote \u20ac in the prose and the table printed $) is now one word away.
 *
 * Only currency-kind columns are touched, and a column that already names its own currency is
 * left alone. A non-array `columns` is passed straight through for validateTableData to refuse.
 */
export function withCurrency(columns: unknown, currency: unknown): unknown {
  if (typeof currency !== 'string' || currency === '' || !Array.isArray(columns)) return columns;
  return columns.map((c) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return c;
    const fmt = (c as { format?: unknown }).format as { kind?: unknown; currency?: unknown } | undefined;
    if (!fmt || typeof fmt !== 'object' || Array.isArray(fmt) || fmt.kind !== 'currency' || fmt.currency !== undefined) return c;
    return { ...(c as object), format: { ...fmt, currency } };
  });
}

export function buildComposeTools(deps: ToolDeps): ToolDef[] {
  const { deck } = deps;

  /* MEASURED at 1280x720 through the real render (tools/agent-bridge.mjs, 2026-09-02): the
     runtime's diagram layout now sizes its viewBox to content (a one-row flow measured well
     under half the old fixed 660), so a composed flow/graph card fits alongside everything
     else the composer builds. There is no longer a diagram-specific trap to hand back here —
     inspect_render is the arbiter for any fold, this kind included. */

  /** Both tools answer the same way: what landed, and how to address what is on it. */
  const added = (out: { id: string; index: number; inner: string; grants: string[] }, label: string, blocks: Array<{ kind: string; nth: number }>) =>
    ok({
      chunkId: out.id,
      index: out.index,
      label,
      blocks,
      capabilitiesGranted: out.grants,
      activeContent: activeContentFlags(out.inner).map((v) => v.rule),
      note: 'added to the open Fold as ONE fold and re-rendered — not yet on disk (the human saves). Edit any block above with set_block({chunkId, kind, nth, data}); check the layout with inspect_render.',
    });

  return [
    {
      name: 'add_fold',
      description: "BUILD A WHOLE FOLD IN ONE CALL — this CHANGES THE DECK the human is looking at and re-renders it. Give the card as DATA: an eyebrow, a heading, then `blocks` in order. Each entry names EXACTLY ONE of chart | venn | flow | graph | gantt | draw | table (that kind's own JSON plus an optional caption — get_kind_schema for the shape) or text (an HTML string: p, p.lede, h3, ul/li), bullets (strings), stats (up to 4 {value,label}), quote ({text,by}). Every data block is validated before anything is added and a bad one is refused naming the block index and the violation; tables are baked; flow/graph node `tone` and edge `label` get \"\" when absent (their legal blank, no meaning changes). columns:2 lays the blocks in two tracks. A chart or graph that names no size is SIZED TO FIT the card. One call is ONE fold and ONE undo step. Returns the chunkId and the (kind, nth) address of every data block, which is what set_block takes.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_PROPS,
          columns: { type: 'integer', minimum: 1, description: '1 (default) or 2 — lay the blocks out in two tracks' },
          blocks: {
            type: 'array',
            description: `The card's content, in order. Each entry names exactly ONE of: ${KIND_LIST} — e.g. { "chart": { "type": "bar", "labels": ["Q1","Q2"], "series": [{ "name": "Revenue", "color": "#4A8CC4", "values": [12,19] }], "yMax": null }, "caption": "Revenue by quarter" }, or { "stats": [{ "value": "48", "label": "Decks shipped" }] }, or { "text": "<p class=\\"lede\\">A line of copy.</p>" }. SIZE: a venn | flow | graph | gantt | table entry may add "width" and/or "height", whole CSS px (width ${SIZE_RANGE.width[0]}-${SIZE_RANGE.width[1]}, height ${SIZE_RANGE.height[0]}-${SIZE_RANGE.height[1]}) — leave them out and the card picks a height that fits 1280x720 (a default graph overflows it). A chart takes "width" only (its height is plotHeight in its own JSON, fitted for you); a draw block takes neither (wpct in its JSON). A size the runtime would ignore is REFUSED, not written`,
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
      description: "ADD A LEDGER FOLD IN ONE CALL — a titled card holding one live spreadsheet block. This CHANGES THE DECK the human is looking at and re-renders it. `formulas` maps an A1 cell to a formula and the calc engine RUNS them on the way in, so the file carries numbers, not an engine: {\"D1\":\"=B1-C1\",\"B5\":\"=SUM(B1:B4)\"}. `totals` is a footer row: {\"on\":true,\"fns\":{\"1\":\"SUM\",\"2\":\"SUM\"}} — the keys are COLUMN INDICES as strings, 0-based. `kpis` pins cards above the table: [{\"name\":\"planTotal\",\"ref\":\"B5\"}] — `name` is an identifier, `ref` an A1 cell. A column `format` is an OBJECT — {\"kind\":\"currency\"|\"number\"|\"percent\"|\"date\"|\"text\"|\"general\"} — never a string. `currency` sets the PREFIX every currency column prints; without it the format library prints \"$\". Validated before anything is applied; a bad shape is refused with the violation named. One undo step.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_PROPS,
          columns: { type: 'array', description: 'Column definitions: [{ label, align?: "left"|"right"|"center", format?: { kind: "general"|"number"|"currency"|"percent"|"date"|"text", decimals?: int } }]', items: { type: 'object' } },
          rows: { type: 'array', description: 'Cells, row by row, as strings: [["Rent","1200"], …]. Leave a formula cell "" — the calc engine fills it', items: { type: 'array' } },
          currency: { type: 'string', maxLength: 8, description: 'The PREFIX every currency-kind column prints, e.g. "€" or "EUR" or "£". It is printed LITERALLY, not resolved from an ISO code: "EUR" gives "EUR1,234.50" and "€" gives "€1,234.50". Default: the format library\'s own "$"' },
          formulas: { type: 'object', description: 'A1 cell -> formula, e.g. { "D1": "=B1-C1", "B5": "=SUM(B1:B4)" }' },
          named: { type: 'object', description: 'Named outputs other blocks can reference, e.g. { "grandTotal": "=B3" }' },
          totals: { type: 'object', description: 'A footer row: { "on": true, "fns": { "1": "SUM", "2": "SUM" } } — keys are COLUMN INDICES as strings, 0-based' },
          kpis: { type: 'array', description: 'Cards pinned above the table: [{ "name": "planTotal", "ref": "B5" }] — name is an identifier, ref an A1 cell or a cellName', items: { type: 'object' } },
          cellFormats: { type: 'object', description: 'Per-cell format overrides by A1 reference, e.g. { "B3": { "kind": "currency" } }' },
          caption: { type: 'string', maxLength: 200, description: 'The line under the table (default: none)' },
        },
        required: ['title', 'columns', 'rows'],
      },
      execute: async ({ title, eyebrow, label, position, caption, columns, rows, currency, formulas, named, totals, kpis, cellFormats }) => {
        const table: Record<string, unknown> = { columns: withCurrency(columns, currency), rows };
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
