import { validateNotesData } from '../notes-data.js';
export const notesBlock = {
    key: 'notes',
    name: 'Scratch pad (notes board)',
    schemaComment: [
        'a freeform card board (the Scratch Pad fold) — an IN-SLIDE block, any number on any fold',
        'shape: <figure class="o-notesfig anim"> holding ONE inert <script type="application/json" data-odata="notes"> block,',
        '  then <div class="o-notes" data-notes-mount></div> (the runtime renders the searchable card grid here)',
        'JSON shape: { notes: [{ id, title, body, color, pinned: bool, date?, image? }] }',
        '  id = a stable unique string · body = newline-separated lines (each non-empty line is a bullet)',
        '  color = "" (default card) or a "#hex" top-border colour · pinned:true floats the card first',
        '  date = optional "YYYY-MM-DD" stamp · image = optional asset id (data-oasset), like every other deck image',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateNotesData },
};
