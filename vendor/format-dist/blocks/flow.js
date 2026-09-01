import { validateFlowData } from '../diagram-data.js';
export const flowBlock = {
    key: 'flow',
    name: 'Flowchart',
    schemaComment: [
        'a flowchart — an IN-SLIDE block, insertable on any fold (a "Flowchart" fold is a free card holding one)',
        'shape: <figure class="o-flowfig anim"> holding ONE inert <script type="application/json" data-odata="flow"> block,',
        '  then <div class="o-flow" data-flow-mount></div> (the runtime auto-layouts + renders the chart here), then a <figcaption>',
        'JSON shape: { nodes: [{id, label, shape: box|pill|diamond, tone: ""|accent|green|amber|red, x?, y?}],',
        '  edges: [{from: <node id>, to: <node id>, label}] }',
        'layout is automatic (layers flow left to right from the roots); a node with x/y (0-100, percent of the canvas) keeps that manual position instead',
        'ids unique; edges reference existing ids',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateFlowData },
};
