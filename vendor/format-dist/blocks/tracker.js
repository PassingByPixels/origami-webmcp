import { validateTrackerData } from '../tracker-data.js';
export const trackerBlock = {
    key: 'tracker',
    name: 'Action tracker',
    schemaComment: [
        '.o-tracker-shell wraps everything: .o-tracker-head (eyebrow + h2 title) then the data block then <div class="o-tracker" data-tracker-mount></div>',
        'ALL rows live in ONE inert <script type="application/json" data-odata="tracker"> block; the runtime renders the mount div from it',
        'JSON shape: { rows: [{action, owner, comments, due, status, done: bool}] }',
        'status must be one of Open|In progress|Blocked|Closed; done:true pairs with status Closed (the editor keeps them in sync)',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateTrackerData },
};
