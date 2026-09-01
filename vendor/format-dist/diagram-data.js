/**
 * Diagram kinds (UX round H) — flowchart + node graph, carried per slide as an
 * inert JSON block (data-odata="flow" / data-odata="graph"), same carrier rules
 * as the gantt/tracker: the serializer escapes every "<" and
 * validateSlideContent enforces the literal script form.
 *
 * flow  — directed steps; the runtime auto-layouts layers left→right.
 * graph — free-form web; nodes carry manual x/y (percent of the canvas).
 */
export const DIAGRAM_TONES = ['', 'accent', 'green', 'amber', 'red'];
export const FLOW_SHAPES = ['box', 'pill', 'diamond'];
export const GRAPH_SHAPES = ['box', 'pill', 'diamond', 'circle', 'hexagon'];
export const EDGE_ARROWS = ['none', 'end', 'both'];
export const EDGE_STYLES = ['straight', 'curved'];
const MAX_NODES = 60;
const MAX_EDGES = 120;
function validateCommon(d, bad) {
    if (!Array.isArray(d.nodes)) {
        bad('nodes', 'nodes must be an array');
        return null;
    }
    if (!Array.isArray(d.edges)) {
        bad('edges', 'edges must be an array');
        return null;
    }
    if (d.nodes.length < 1 || d.nodes.length > MAX_NODES) {
        bad('nodes.count', `nodes must contain 1-${MAX_NODES} entries`);
    }
    if (d.edges.length > MAX_EDGES)
        bad('edges.count', `edges must contain at most ${MAX_EDGES} entries`);
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    const ids = new Set();
    const nodes = d.nodes;
    nodes.forEach((n, i) => {
        const o = (n ?? {});
        if (!str(o.id, 40) || o.id.length === 0)
            bad('node.id', `node ${i}: id must be a non-empty string (max 40)`);
        else if (ids.has(o.id))
            bad('node.id', `node ${i}: duplicate id "${o.id}"`);
        else
            ids.add(o.id);
        if (!str(o.label, 200))
            bad('node.label', `node ${i}: label must be a string (max 200)`);
        if (!DIAGRAM_TONES.includes(o.tone)) {
            bad('node.tone', `node ${i}: tone must be one of ${DIAGRAM_TONES.filter(Boolean).join('|')} or ""`);
        }
        if (o.icon !== undefined && !str(o.icon, 40))
            bad('node.icon', `node ${i}: icon must be a string (max 40)`);
        if (o.color !== undefined && !(o.color === '' || (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color)))) {
            bad('node.color', `node ${i}: color must be "" or a #hex`);
        }
        if (o.fill !== undefined && !(o.fill === '' || (typeof o.fill === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.fill)))) {
            bad('node.fill', `node ${i}: fill must be "" or a #hex`);
        }
        const dim = (x, min, max) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
        if (!dim(o.width, 60, 400))
            bad('node.width', `node ${i}: width must be a number 60-400 when present`);
        if (!dim(o.height, 30, 200))
            bad('node.height', `node ${i}: height must be a number 30-200 when present`);
    });
    const edges = d.edges;
    edges.forEach((e, i) => {
        const o = (e ?? {});
        if (!str(o.from, 40) || !ids.has(o.from))
            bad('edge.from', `edge ${i}: from must reference an existing node id`);
        if (!str(o.to, 40) || !ids.has(o.to))
            bad('edge.to', `edge ${i}: to must reference an existing node id`);
        if (!str(o.label, 80))
            bad('edge.label', `edge ${i}: label must be a string (max 80)`);
        if (o.color !== undefined && !(o.color === '' || (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color)))) {
            bad('edge.color', `edge ${i}: color must be "" or a #hex`);
        }
        if (o.width !== undefined && !(typeof o.width === 'number' && Number.isFinite(o.width) && o.width >= 1 && o.width <= 8)) {
            bad('edge.width', `edge ${i}: width must be a number 1-8 when present`);
        }
        if (o.dash !== undefined && !(typeof o.dash === 'string' && /^[0-9.,\s]{1,40}$/.test(o.dash))) {
            bad('edge.dash', `edge ${i}: dash must be numbers and separators (max 40)`);
        }
        if (o.arrow !== undefined && !EDGE_ARROWS.includes(o.arrow)) {
            bad('edge.arrow', `edge ${i}: arrow must be one of ${EDGE_ARROWS.join('|')}`);
        }
        if (o.style !== undefined && !EDGE_STYLES.includes(o.style)) {
            bad('edge.style', `edge ${i}: style must be one of ${EDGE_STYLES.join('|')}`);
        }
    });
    return { nodes, edges };
}
/** Validate an optional `lanes` array and return the set of valid lane ids
    (empty when absent or malformed). Shared by flow and graph. */
function validateLanes(data, bad) {
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    const laneIds = new Set();
    const rawLanes = data.lanes;
    if (rawLanes !== undefined) {
        if (!Array.isArray(rawLanes))
            bad('lanes', 'lanes must be an array');
        else if (rawLanes.length > 10)
            bad('lanes.count', 'lanes must contain at most 10 entries');
        else {
            rawLanes.forEach((l, i) => {
                const o = (l ?? {});
                if (!str(o.id, 40) || o.id.length === 0)
                    bad('lane.id', `lane ${i}: id must be a non-empty string (max 40)`);
                else if (laneIds.has(o.id))
                    bad('lane.id', `lane ${i}: duplicate id "${o.id}"`);
                else
                    laneIds.add(o.id);
                if (!str(o.label, 80))
                    bad('lane.label', `lane ${i}: label must be a string (max 80)`);
                if (o.order !== undefined && !(typeof o.order === 'number' && Number.isFinite(o.order)))
                    bad('lane.order', `lane ${i}: order must be a number when present`);
                if (o.color !== undefined && !(o.color === '' || (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color))))
                    bad('lane.color', `lane ${i}: color must be "" or a #hex`);
                if (o.actor !== undefined && !str(o.actor, 80))
                    bad('lane.actor', `lane ${i}: actor must be a string (max 80)`);
            });
        }
    }
    return laneIds;
}
/** Strict shape check for a flow data block. REJECT, never repair. */
export function validateFlowData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `flow.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'flow data must be a JSON object');
        return v;
    }
    const parts = validateCommon(data, bad);
    const laneIds = validateLanes(data, bad);
    parts?.nodes.forEach((n, i) => {
        if (!FLOW_SHAPES.includes(n.shape)) {
            bad('node.shape', `node ${i}: shape must be one of ${FLOW_SHAPES.join('|')}`);
        }
        const pct = (x) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100);
        if (!pct(n.x))
            bad('node.x', `node ${i}: x must be a number 0-100 when present`);
        if (!pct(n.y))
            bad('node.y', `node ${i}: y must be a number 0-100 when present`);
        if (n.lane !== undefined && (typeof n.lane !== 'string' || !laneIds.has(n.lane))) {
            bad('node.lane', `node ${i}: lane must reference an existing lane id`);
        }
    });
    return v;
}
/** Strict shape check for a graph data block. REJECT, never repair. */
export function validateGraphData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `graph.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'graph data must be a JSON object');
        return v;
    }
    const parts = validateCommon(data, bad);
    const laneIds = validateLanes(data, bad);
    parts?.nodes.forEach((n, i) => {
        const pct = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
        if (!pct(n.x))
            bad('node.x', `node ${i}: x must be a number 0-100 (percent of the canvas)`);
        if (!pct(n.y))
            bad('node.y', `node ${i}: y must be a number 0-100 (percent of the canvas)`);
        if (n.shape !== undefined && !GRAPH_SHAPES.includes(n.shape)) {
            bad('node.shape', `node ${i}: shape must be one of ${GRAPH_SHAPES.join('|')}`);
        }
        if (n.lane !== undefined && (typeof n.lane !== 'string' || !laneIds.has(n.lane))) {
            bad('node.lane', `node ${i}: lane must reference an existing lane id`);
        }
    });
    return v;
}
/** Serialize for embedding — "<" escaped (same invariant as ganttDataJson). */
export function flowDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
export function graphDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
