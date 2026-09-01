import { validateGanttData } from '../gantt-data.js';
export const ganttBlock = {
    key: 'gantt',
    name: 'Roadmap (Gantt)',
    schemaComment: [
        'a roadmap (Gantt) — an IN-SLIDE block, insertable on any fold (a "Roadmap" fold is a free card holding one)',
        'shape: <figure class="o-ganttfig anim"> holding ONE inert <script type="application/json" data-odata="gantt"> block,',
        '  then <div class="o-gantt" data-gantt-mount></div> (the runtime renders the roadmap here), then a <figcaption>',
        'JSON shape: { totalWeeks: int 4-520, startDate: "YYYY-MM-DD"|null (anchors W1 to the calendar),',
        '  lenses: [{name, color:"#hex"}] (card designations — colour drives bars/chips/legend),',
        '  swimlanes: [{name, owner}], milestones: [{label, week: 1-based number, color:"#hex"}],',
        '  cards: [{id: "C01", title, swimlane: <swimlane name>, start: "W3"|"M2"|number (0-based week, fractional ok),',
        '    durationWeeks, lens: <lens name>, type: Technical|Process|Cultural, effort: EASY|MED|DEFER,',
        '    what, needs, caveat, deliverable, sources, completed: bool}] }',
        'card.swimlane / card.lens must reference existing names; weeks live within totalWeeks; ids unique',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateGanttData },
};
