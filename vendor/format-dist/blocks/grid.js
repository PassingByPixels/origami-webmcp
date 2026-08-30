import { validateGridData } from '../grid-data.js';
export const gridBlock = {
    key: 'grid',
    name: 'Data grid',
    schemaComment: [
        '.o-grid-shell wraps everything: .o-grid-head (eyebrow + h2 title) then the data block then <div class="o-grid" data-grid-mount></div>',
        'ALL rows live in ONE inert <script type="application/json" data-odata="grid"> block; the runtime renders a searchable + sortable table from it (the interactivity is in the runtime, so the deck stays inactive — NO padlock)',
        'JSON shape: { columns: [{label, align?: left|right|center, tone?}], rows: [[cell, cell, …]] }',
        '  rows are row-major arrays of display strings, aligned to columns (a short row is padded)',
        'column.tone = per-column conditional formatting, one of:',
        '  {type:"status", map:{"<cell value>":"green|amber|red|accent"}} — tints a cell by exact value (status columns)',
        '  {type:"scale", min:<number>, max:<number>, reverse?:bool} — reads the cell as a number and heat-tints it min→max (reverse = high is bad)',
        'use this over a plain table when the data is tabular AND wants search / sort / conditional colour; keep prose tables on the table block',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateGridData },
};
