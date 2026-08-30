import { validateGraphData } from '../diagram-data.js';
export const graphBlock = {
    key: 'graph',
    name: 'Node graph',
    schemaComment: [
        'a node graph — an IN-SLIDE block, insertable on any fold (a "Node graph" fold is a free card holding one)',
        'shape: <figure class="o-graphfig anim"> holding ONE inert <script type="application/json" data-odata="graph"> block,',
        '  then <div class="o-graph" data-graph-mount></div> (the runtime renders the graph here), then a <figcaption>',
        'JSON shape: { nodes: [{id, label, x: 0-100, y: 0-100, tone: ""|accent|green|amber|red}],',
        '  edges: [{from: <node id>, to: <node id>, label}] }',
        'x/y are percent of the diagram canvas (nodes keep their manual positions); ids unique; edges reference existing ids',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateGraphData },
};
