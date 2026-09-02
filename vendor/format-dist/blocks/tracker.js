import { validateTrackerData } from '../tracker-data.js';
export const trackerBlock = {
    key: 'tracker',
    name: 'Action tracker',
    schemaComment: [
        '.o-tracker-shell wraps everything: .o-tracker-head (eyebrow + h2 title) then the data block then <div class="o-tracker" data-tracker-mount></div>',
        'ALL rows live in ONE inert <script type="application/json" data-odata="tracker"> block; the runtime renders the mount div from it',
        'TWO SHAPES. LEGACY (no "columns" ARRAY): { rows: [{action, owner, comments, due, status, done: bool}], statuses?, columns?, hidden? }',
        'CUSTOM (the author defines the columns): { columns: [{key, label, type, options?, width?, hidden?, status?, done?}], rows: [{<key>: cell}] } — "statuses" and "hidden" are ILLEGAL alongside a columns array',
        'column key: [a-z][a-z0-9_]{0,23}, unique; label 1–40 chars; type one of text|person|date|select|check|number; width an integer 60–600 px (absent = the per-type default); 1–24 columns',
        'a select column MUST carry "options" (1–12 distinct labels, ≤40 chars) and only a select column may; at most ONE select may set status:true and at most ONE check may set done:true',
        'status:true drives the done/reopen rule (LAST option = done, FIRST = reopen) and done:true is the completion toggle; with neither, the tracker has no done/strike behaviour',
        'a cell must fit its column: text|person|date = a string (≤2000), select = one of that column’s options, check = a boolean, number = a finite number or "" for blank; an ABSENT cell is blank; a row key naming no column is rejected',
        'LEGACY status must be one of the tracker’s status options — the optional "statuses" array (1–12 strings, ≤40 chars each) or, when absent, the default Open|In progress|Blocked|Closed',
        'LEGACY: the LAST status option is the "done" status and the FIRST is the "reopen" status (the editor keeps them in sync)',
        'LEGACY optional "columns" renames headings: {action|owner|comments|due|status|done: "label"} (1–40 chars); a key absent = that column’s default heading',
        'LEGACY optional "hidden" lists columns that render nowhere: any of owner|comments|due|status|done, distinct — "action" can never be hidden',
        'DEFAULTS ARE ABSENCE: omit statuses/columns/hidden entirely when they equal the defaults — never write them out as the default value',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateTrackerData },
};
