import { validateTableData } from '../table-data.js';
export const tableBlock = {
    key: 'table',
    name: 'Ledger table',
    schemaComment: [
        '.o-table-shell wraps everything: .o-table-head (eyebrow + h2 title) then the data block then <div class="o-table" data-table-mount></div>',
        'ALL data lives in ONE inert <script type="application/json" data-odata="table"> block; the runtime renders the BAKED rows as a formatted, styled LEDGER — currency/percent/date/number formats, per-cell styles + theme fills, a Σ totals footer, and pinned KPI cards — static + INERT (rendering is in the runtime from baked rows, so the deck stays inactive — NO padlock; recompute happens only in the trusted app)',
        'JSON shape: { columns: [{label, align?: left|right|center, format?, width?, name?}], rows: [[cell, …]], formulas?: {"A1":"=…"}, named?: {"name":"=…"} }',
        '  optional display side-maps (all viewer-honoured, omitted when default): cellFormats {"A1":{kind:general|number|currency|percent|date|text, decimals?, currency?, dateFmt?, sep?, thou?}} (per-cell format; column.format is the column default); cellStyles {"A1":{b|i|u|s?:1, align?, fill?:"fill-<token>"}}; rowHeights {"rowIdx":px}; totals {on, fns:{"colIdx":"SUM|AVG|MIN|MAX|COUNT"}}; kpis:[{name(identifier), ref(A1 or a cellName)}]; cellNames {"A1":identifier}',
        '  rows are row-major arrays of BAKED display strings — a formula cell carries its computed VALUE here (never the formula text)',
        '  formulas is an inert authoring side-map of A1 -> "=…" (e.g. {"D2":"=B2*C2","B6":"=SUM(B2:B5)"}); the viewer NEVER reads it — the trusted app recomputes + re-bakes into rows on save',
        '  named is an inert side-map of name -> "=…" — engine-computed named outputs referenceable within this ledger\'s own formulas; the viewer NEVER reads it',
        'use the TABLE block for live calc / budgets / what-if (formulas); use GRID for a static searchable table with no formulas',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateTableData },
};
