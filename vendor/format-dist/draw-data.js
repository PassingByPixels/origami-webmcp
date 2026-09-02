/**
 * draw — a freehand drawing block (the Excalidraw-style sketch surface), carried
 * as an inert JSON block (data-odata="draw"), same carrier rules as flow/graph:
 * the serializer escapes every "<" and validateSlideContent enforces the literal
 * script form.
 *
 * A scene is a flat array of elements in UNBOUNDED scene coordinates; the
 * renderer fits the bounding box of all elements into the block, so a drawing
 * never needs a canvas size saved with it. Every element carries its own `seed`
 * so the hand-drawn jitter renders identically on every open (deterministic,
 * dependency-free SVG — no rough.js, MV3 + file:// forbid remote code).
 */
export const DRAW_MAX_ELEMENTS = 200;
/* Why 200: a card-sized illustration or diagram. Denser scenes bloat every
   saved deck (the JSON rides inside the single file) and slow Present renders
   on weak machines. Same derivation as TREEMAP_MAX_NODES — geometry, not whim. */
export const DRAW_MAX_POINTS = 1200;
export const DRAW_TEXT_MAX = 2000;
const COORD_LIMIT = 100000;
export const DRAW_TYPES = ['rect', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text'];
export const DRAW_FILL_STYLES = ['none', 'hachure', 'cross', 'solid'];
export const DRAW_STROKE_STYLES = ['solid', 'dashed', 'dotted'];
export const DRAW_FONTS = ['playfair', 'lora', 'inter', 'source-serif', 'caveat'];
export const DRAW_TEXT_ALIGNS = ['left', 'center', 'right'];
/** Arrowheads an arrow may carry. Absent = "end", the shape every arrow drawn before this had, so
    no deck changes on load. A LINE with a head is an arrow, so the field is arrow-only. */
export const DRAW_ARROW_HEADS = ['end', 'both'];
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const isHex = (x) => typeof x === 'string' && HEX.test(x);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const inRange = (x, lo, hi) => finite(x) && x >= lo && x <= hi;
const bounded = (x) => finite(x) && Math.abs(x) <= COORD_LIMIT;
/** id (unique across the scene) + type. The id is added to `ids` only when it is BOTH well-formed
    and new, so a duplicate never registers itself and the attach pass below cannot resolve to it. */
function checkElementIdentity(e, ids, at) {
    if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 40)
        at('id', 'id must be a non-empty string (max 40)');
    else if (ids.has(e.id))
        at('id', `duplicate id "${e.id}"`);
    else
        ids.add(e.id);
    if (!DRAW_TYPES.includes(e.type))
        at('type', `type must be one of ${DRAW_TYPES.join('|')}`);
}
/** The element's box: where it sits, how big it is, how far it is turned, what it is called. */
function checkElementBox(e, at) {
    if (!bounded(e.x) || !bounded(e.y))
        at('xy', 'x and y must be finite numbers within ±100000');
    if (!bounded(e.width) || !bounded(e.height) || e.width < 0 || e.height < 0) {
        at('size', 'width and height must be numbers ≥ 0 within ±100000');
    }
    if (e.angle !== undefined && !finite(e.angle))
        at('angle', 'angle must be a finite number (degrees)');
    if (e.name !== undefined && (typeof e.name !== 'string' || e.name.trim().length === 0 || e.name.length > 40)) {
        at('name', 'name must be a non-empty string of at most 40 characters');
    }
}
/** The ink: what the outline and the interior are drawn with. Every field is absent-by-default
    except `stroke`, which every element carries. */
function checkElementStroke(e, at) {
    if (!isHex(e.stroke))
        at('stroke', 'stroke must be a #hex colour');
    if (e.fill !== undefined && !(e.fill === '' || isHex(e.fill)))
        at('fill', 'fill must be "" or a #hex');
    if (e.fillStyle !== undefined && !DRAW_FILL_STYLES.includes(e.fillStyle)) {
        at('fillStyle', `fillStyle must be one of ${DRAW_FILL_STYLES.join('|')}`);
    }
    if (e.strokeWidth !== undefined && !inRange(e.strokeWidth, 1, 8))
        at('strokeWidth', 'strokeWidth must be 1-8');
    if (e.strokeStyle !== undefined && !DRAW_STROKE_STYLES.includes(e.strokeStyle)) {
        at('strokeStyle', `strokeStyle must be one of ${DRAW_STROKE_STYLES.join('|')}`);
    }
    if (e.roughness !== undefined && ![0, 1, 2].includes(e.roughness))
        at('roughness', 'roughness must be 0, 1 or 2');
}
// heads and smoothing each belong to ONE element type, like attach below and text/fontSize
// above — a head on a rect or a smoothing on a text is confused data, so it is rejected
function checkTypeOnlyFields(e, at) {
    if (e.heads !== undefined) {
        if (e.type !== 'arrow')
            at('heads', 'heads is only valid on arrow elements');
        else if (!DRAW_ARROW_HEADS.includes(e.heads)) {
            at('heads', `heads must be one of ${DRAW_ARROW_HEADS.join('|')}`);
        }
    }
    if (e.smoothing !== undefined) {
        if (e.type !== 'freedraw')
            at('smoothing', 'smoothing is only valid on freedraw elements');
        else if (![0, 1, 2].includes(e.smoothing))
            at('smoothing', 'smoothing must be 0, 1 or 2');
    }
}
/** How the element is RENDERED rather than what shape it is: how solid it looks, and the seed the
    rough renderer draws its wobble from. */
function checkElementRenderOptions(e, at) {
    if (e.opacity !== undefined && !inRange(e.opacity, 0, 100))
        at('opacity', 'opacity must be 0-100');
    const seed = e.seed;
    if (seed !== undefined && !(typeof seed === 'number' && Number.isInteger(seed) && seed >= 1 && seed <= 2147483647)) {
        at('seed', 'seed must be an integer 1..2147483647');
    }
}
/** The path types carry their own vertex list; every other type has none to check. */
function checkElementPoints(e, at) {
    if (e.type !== 'arrow' && e.type !== 'line' && e.type !== 'freedraw')
        return;
    if (!Array.isArray(e.points) || e.points.length < 2) {
        at('points', `${e.type} needs a points array of at least 2 [x, y] pairs`);
        return;
    }
    if (e.points.length > DRAW_MAX_POINTS)
        at('points', `points must hold at most ${DRAW_MAX_POINTS} entries`);
    e.points.forEach((p, j) => {
        if (!Array.isArray(p) || p.length !== 2 || !bounded(p[0]) || !bounded(p[1])) {
            at('points', `point ${j} must be a [x, y] pair of finite numbers within ±100000`);
        }
    });
}
/** The text type's own carrier and its typography. */
function checkTextElement(e, at) {
    if (e.type !== 'text')
        return;
    if (typeof e.text !== 'string' || e.text.length === 0)
        at('text', 'text needs a non-empty string');
    else if (e.text.length > DRAW_TEXT_MAX)
        at('text', `text must hold at most ${DRAW_TEXT_MAX} characters`);
    if (e.fontSize !== undefined && !inRange(e.fontSize, 6, 200))
        at('fontSize', 'fontSize must be 6-200');
    if (e.font !== undefined && !DRAW_FONTS.includes(e.font))
        at('font', `font must be one of ${DRAW_FONTS.join('|')}`);
    if (e.textAlign !== undefined && !DRAW_TEXT_ALIGNS.includes(e.textAlign)) {
        at('textAlign', `textAlign must be one of ${DRAW_TEXT_ALIGNS.join('|')}`);
    }
}
/** ONE element, checked in the order its violations are expected in: what it IS, where it sits,
    what it is drawn with, the fields only its own type may carry, then its type's own carrier. */
function checkDrawElement(raw, i, ids, bad) {
    const e = (raw ?? {});
    const at = (rule, detail) => bad(`element.${rule}`, `element ${i}: ${detail}`);
    checkElementIdentity(e, ids, at);
    checkElementBox(e, at);
    checkElementStroke(e, at);
    checkTypeOnlyFields(e, at);
    checkElementRenderOptions(e, at);
    checkElementPoints(e, at);
    checkTextElement(e, at);
}
/** Strict shape check for a draw data block. REJECT, never repair. */
export function validateDrawData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `draw.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'draw data must be a JSON object');
        return v;
    }
    const d = data;
    if (!Array.isArray(d.elements)) {
        bad('elements', 'elements must be an array');
        return v;
    }
    if (d.wpct !== undefined && !(finite(d.wpct) && d.wpct >= 10 && d.wpct <= 100)) {
        bad('wpct', 'wpct must be a number between 10 and 100');
    }
    if (d.replay !== undefined && typeof d.replay !== 'boolean')
        bad('replay', 'replay must be true or false');
    if (d.replayOrder !== undefined) {
        const ro = d.replayOrder;
        if (!Array.isArray(ro))
            bad('replayOrder', 'replayOrder must be an array of element ids');
        else {
            if (ro.length > DRAW_MAX_ELEMENTS)
                bad('replayOrder', `replayOrder must hold at most ${DRAW_MAX_ELEMENTS} ids`);
            ro.forEach((id, i) => {
                if (typeof id !== 'string' || id.length === 0 || id.length > 40)
                    bad('replayOrder', `replayOrder ${i}: must be an element id (max 40 chars)`);
            });
        }
    }
    for (const k of ['w', 'h']) {
        if (d[k] !== undefined && !(finite(d[k]) && d[k] >= 50 && d[k] <= COORD_LIMIT)) {
            bad('canvas', `${k} must be a number between 50 and ${COORD_LIMIT}`);
        }
    }
    if (d.elements.length > DRAW_MAX_ELEMENTS) {
        bad('elements.count', `a drawing holds at most ${DRAW_MAX_ELEMENTS} elements`);
    }
    const ids = new Set();
    d.elements.forEach((raw, i) => checkDrawElement(raw, i, ids, bad));
    // attachments must name elements that exist (either direction of definition order)
    for (let i = 0; i < d.elements.length; i++) {
        const e = (d.elements[i] ?? {});
        const at2 = (rule, detail) => bad(`element.${rule}`, `element ${i}: ${detail}`);
        const a = e.attach;
        if (a === undefined)
            continue;
        if (e.type !== 'arrow' && e.type !== 'line') {
            at2('attach', 'attach is only valid on arrow and line elements');
            continue;
        }
        if (a !== null && typeof a === 'object') {
            for (const side of ['from', 'to']) {
                const id = a[side];
                if (id === undefined)
                    continue;
                if (typeof id !== 'string' || !ids.has(id))
                    at2('attach', `attach.${side} must name an element in the scene`);
            }
        }
    }
    return v;
}
/** Serialize for embedding — "<" escaped (same invariant as flowDataJson). */
export function drawDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
