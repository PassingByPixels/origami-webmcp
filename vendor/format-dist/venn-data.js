/**
 * Venn diagram — 2 to 6 overlapping circles, carried as an inert JSON block
 * (data-odata="venn"), same carrier rules as flow/graph/draw.
 *
 * Each set is a labelled circle with a fill colour; the runtime blends the
 * overlaps (multiply in an isolated group) so intersections stay clean.
 * Named overlaps let an author label an intersection (e.g. "both" on A∩B):
 * each entry names the circles it sits on and the label's position, as a
 * percent of the viewBox, so the label stays put at any render size.
 */
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const LABEL_MAX = 40;
export const VENN_MAX_CIRCLES = 6;
const isHex = (x) => typeof x === 'string' && HEX.test(x);
const isCount = (x) => x === 2 || x === 3 || x === 4 || x === 5 || x === 6;
const isPct = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
/** Strict shape check. REJECT, never repair. */
export function validateVennData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `venn.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'venn data must be a JSON object');
        return v;
    }
    const d = data;
    if (!isCount(d.count))
        bad('count', 'count must be 2, 3, 4, 5 or 6');
    if (!Array.isArray(d.sets)) {
        bad('sets', 'sets must be an array');
        return v;
    }
    if (isCount(d.count) && d.sets.length !== d.count) {
        bad('sets.count', `sets must contain exactly ${d.count} entries when count is ${d.count}`);
    }
    if (d.sets.length < 2 || d.sets.length > VENN_MAX_CIRCLES) {
        bad('sets.range', `sets must contain 2-${VENN_MAX_CIRCLES} entries`);
    }
    d.sets.forEach((raw, i) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            bad(`sets.${i}`, `set ${i} must be an object`);
            return;
        }
        const s = raw;
        if (typeof s.label !== 'string')
            bad(`sets.${i}.label`, `set ${i}: label must be a string`);
        else if (s.label.length > LABEL_MAX)
            bad(`sets.${i}.label`, `set ${i}: label max ${LABEL_MAX} chars`);
        if (!isHex(s.color))
            bad(`sets.${i}.color`, `set ${i}: color must be a #hex`);
    });
    if (d.overlaps !== undefined) {
        if (!Array.isArray(d.overlaps)) {
            bad('overlaps', 'overlaps must be an array');
        }
        else {
            const maxIdx = isCount(d.count) ? d.count : VENN_MAX_CIRCLES;
            d.overlaps.forEach((raw, i) => {
                if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
                    bad(`overlaps.${i}`, `overlap ${i} must be an object`);
                    return;
                }
                const o = raw;
                if (!Array.isArray(o.sets)) {
                    bad(`overlaps.${i}.sets`, `overlap ${i}: sets must be an array of circle indices`);
                }
                else {
                    if (o.sets.length < 2 || o.sets.length > VENN_MAX_CIRCLES) {
                        bad(`overlaps.${i}.sets`, `overlap ${i}: sets must name 2-${VENN_MAX_CIRCLES} circles`);
                    }
                    const seen = new Set();
                    o.sets.forEach((s, j) => {
                        if (typeof s !== 'number' || !Number.isInteger(s)) {
                            bad(`overlaps.${i}.sets`, `overlap ${i}: sets[${j}] must be an integer circle index`);
                        }
                        else {
                            if (s < 0 || s >= maxIdx)
                                bad(`overlaps.${i}.sets`, `overlap ${i}: sets[${j}] out of range (0-${maxIdx - 1})`);
                            if (seen.has(s))
                                bad(`overlaps.${i}.sets`, `overlap ${i}: duplicate circle ${s}`);
                            seen.add(s);
                        }
                    });
                }
                if (typeof o.label !== 'string')
                    bad(`overlaps.${i}.label`, `overlap ${i}: label must be a string`);
                else if (o.label.length > LABEL_MAX)
                    bad(`overlaps.${i}.label`, `overlap ${i}: label max ${LABEL_MAX} chars`);
                if (!isPct(o.x))
                    bad(`overlaps.${i}.x`, `overlap ${i}: x must be 0-100`);
                if (!isPct(o.y))
                    bad(`overlaps.${i}.y`, `overlap ${i}: y must be 0-100`);
            });
        }
    }
    return v;
}
/** Serialize for the inert script block — every "<" escaped. */
export function vennDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
