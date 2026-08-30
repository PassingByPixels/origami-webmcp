import { validateVennData } from '../venn-data.js';
export const vennBlock = {
    key: 'venn',
    name: 'Venn diagram',
    schemaComment: [
        'a Venn diagram — an IN-SLIDE block, insertable on any fold (a "Venn Diagram" fold is a free card holding one)',
        'shape: <figure class="o-vennfig anim"> holding ONE inert <script type="application/json" data-odata="venn"> block,',
        '  then <div class="o-venn" data-venn-mount></div> (the runtime renders the overlapping circles here), then a <figcaption>',
        'JSON shape: { count: 2|3|4|5|6, sets: [{ label: string, color: "#hex" }, ...], overlaps?: [{ sets: [int...], label: string, x: 0-100, y: 0-100 }, ...] }',
        'sets.length must equal count; each circle is labelled and coloured; overlaps blend (multiply) for a clean intersection',
        'overlaps name an intersection: sets lists the circle indices it sits on (>= 2, unique), x/y place the label as a percent of the viewBox',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateVennData },
};
