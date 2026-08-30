export const GANTT_CARD_TYPES = ['Technical', 'Process', 'Cultural'];
export const GANTT_CARD_EFFORTS = ['EASY', 'MED', 'DEFER'];
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const CARD_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 0-based week offset for a card start — number, "W#", "M#" (4 weeks/month) or numeric string. */
export function ganttWeekIndex(v) {
    if (typeof v === 'number')
        return v;
    if (!v)
        return 0;
    if (v.startsWith('W'))
        return parseFloat(v.slice(1)) - 1;
    if (v.startsWith('M'))
        return (parseFloat(v.slice(1)) - 1) * 4;
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
}
/** Strict shape check for a gantt data block. REJECT, never repair. */
export function validateGanttData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `gantt.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'gantt data must be a JSON object');
        return v;
    }
    const d = data;
    const totalWeeks = d.totalWeeks;
    // a positive number of weeks, up to ~10 years; fractional + sub-week allowed so the
    // span control can express a 1-week or 1-day horizon (totalWeeks 1 or ~0.14)
    if (typeof totalWeeks !== 'number' || !(totalWeeks > 0) || totalWeeks > 520) {
        bad('totalWeeks', 'totalWeeks must be a positive number up to 520');
    }
    const weeks = typeof totalWeeks === 'number' ? totalWeeks : 520;
    if (d.startDate !== null && (typeof d.startDate !== 'string' || !DATE_RE.test(d.startDate))) {
        bad('startDate', 'startDate must be null or an ISO "YYYY-MM-DD" string');
    }
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    if (!Array.isArray(d.lenses) || d.lenses.length === 0) {
        bad('lenses', 'lenses must be a non-empty array');
    }
    else {
        const names = new Set();
        d.lenses.forEach((l, i) => {
            const o = (l ?? {});
            if (!str(o.name, 60) || o.name.length === 0)
                bad('lens.name', `lens ${i}: name must be a non-empty string (max 60)`);
            else if (names.has(o.name))
                bad('lens.name', `lens ${i}: duplicate name "${o.name}"`);
            else
                names.add(o.name);
            if (typeof o.color !== 'string' || !COLOR_RE.test(o.color))
                bad('lens.color', `lens ${i}: color must be a #hex value`);
        });
    }
    const lensNames = new Set(Array.isArray(d.lenses) ? d.lenses.map((l) => l?.name).filter((n) => typeof n === 'string') : []);
    if (!Array.isArray(d.swimlanes)) {
        bad('swimlanes', 'swimlanes must be an array');
    }
    else {
        const names = new Set();
        d.swimlanes.forEach((s, i) => {
            const o = (s ?? {});
            if (!str(o.name, 60) || o.name.length === 0)
                bad('swimlane.name', `swimlane ${i}: name must be a non-empty string (max 60)`);
            else if (names.has(o.name))
                bad('swimlane.name', `swimlane ${i}: duplicate name "${o.name}"`);
            else
                names.add(o.name);
            if (!str(o.owner, 60))
                bad('swimlane.owner', `swimlane ${i}: owner must be a string (max 60)`);
        });
    }
    const laneNames = new Set(Array.isArray(d.swimlanes) ? d.swimlanes.map((s) => s?.name).filter((n) => typeof n === 'string') : []);
    if (!Array.isArray(d.cards)) {
        bad('cards', 'cards must be an array');
    }
    else {
        const ids = new Set();
        d.cards.forEach((c, i) => {
            const o = (c ?? {});
            const tag = typeof o.id === 'string' ? o.id : `#${i}`;
            if (typeof o.id !== 'string' || !CARD_ID_RE.test(o.id))
                bad('card.id', `card ${tag}: id must match [A-Za-z0-9_-]{1,24}`);
            else if (ids.has(o.id))
                bad('card.id', `card ${tag}: duplicate id`);
            else
                ids.add(o.id);
            if (!str(o.title, 200))
                bad('card.title', `card ${tag}: title must be a string (max 200)`);
            if (typeof o.swimlane !== 'string' || !laneNames.has(o.swimlane)) {
                bad('card.swimlane', `card ${tag}: swimlane "${String(o.swimlane)}" is not in swimlanes`);
            }
            if (typeof o.lens !== 'string' || !lensNames.has(o.lens)) {
                bad('card.lens', `card ${tag}: lens "${String(o.lens)}" is not in lenses`);
            }
            const startOk = (typeof o.start === 'number' && o.start >= 0 && o.start <= weeks) ||
                (typeof o.start === 'string' && /^[WM]\d+(\.\d+)?$/.test(o.start) && ganttWeekIndex(o.start) >= 0 && ganttWeekIndex(o.start) <= weeks);
            if (!startOk)
                bad('card.start', `card ${tag}: start must be "W#", "M#" or a week number within totalWeeks`);
            if (typeof o.durationWeeks !== 'number' || !(o.durationWeeks > 0) || o.durationWeeks > 520) {
                bad('card.duration', `card ${tag}: durationWeeks must be a positive number`);
            }
            if (!GANTT_CARD_TYPES.includes(o.type)) {
                bad('card.type', `card ${tag}: type must be one of ${GANTT_CARD_TYPES.join('|')}`);
            }
            if (!GANTT_CARD_EFFORTS.includes(o.effort)) {
                bad('card.effort', `card ${tag}: effort must be one of ${GANTT_CARD_EFFORTS.join('|')}`);
            }
            for (const k of ['what', 'needs', 'caveat', 'deliverable', 'sources']) {
                if (!str(o[k], 2000))
                    bad(`card.${k}`, `card ${tag}: ${k} must be a string (max 2000)`);
            }
            if (typeof o.completed !== 'boolean')
                bad('card.completed', `card ${tag}: completed must be a boolean`);
        });
    }
    if (!Array.isArray(d.milestones)) {
        bad('milestones', 'milestones must be an array');
    }
    else {
        d.milestones.forEach((m, i) => {
            const o = (m ?? {});
            if (!str(o.label, 80))
                bad('milestone.label', `milestone ${i}: label must be a string (max 80)`);
            if (typeof o.week !== 'number' || o.week < 1 || o.week > weeks) {
                bad('milestone.week', `milestone ${i}: week must be a number between 1 and totalWeeks`);
            }
            if (typeof o.color !== 'string' || !COLOR_RE.test(o.color))
                bad('milestone.color', `milestone ${i}: color must be a #hex value`);
        });
    }
    // zones are OPTIONAL (absent on decks that never used them); validate only when present
    if (d.zones !== undefined) {
        if (!Array.isArray(d.zones)) {
            bad('zones', 'zones must be an array');
        }
        else {
            d.zones.forEach((z, i) => {
                const o = (z ?? {});
                if (!str(o.label, 80))
                    bad('zone.label', `zone ${i}: label must be a string (max 80)`);
                if (typeof o.startWeek !== 'number' || o.startWeek < 1 || o.startWeek > weeks) {
                    bad('zone.startWeek', `zone ${i}: startWeek must be a number between 1 and totalWeeks`);
                }
                if (typeof o.endWeek !== 'number' || o.endWeek > weeks || (typeof o.startWeek === 'number' && o.endWeek < o.startWeek)) {
                    bad('zone.endWeek', `zone ${i}: endWeek must be a number between startWeek and totalWeeks`);
                }
                if (typeof o.color !== 'string' || !COLOR_RE.test(o.color))
                    bad('zone.color', `zone ${i}: color must be a #hex value`);
                if (o.color2 !== undefined && (typeof o.color2 !== 'string' || !COLOR_RE.test(o.color2))) {
                    bad('zone.color2', `zone ${i}: color2 must be a #hex value when present`);
                }
            });
        }
    }
    return v;
}
/** Serialize gantt data for embedding — "<" escaped so the JSON can never
    terminate its script block or fake a template boundary. */
export function ganttDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
/** All inert data blocks in a slide inner: [kind, rawJson] pairs. String-level. */
export const DATA_BLOCK_RE = /<script type="application\/json" data-odata="([a-z0-9-]+)">([\s\S]*?)<\/script>/g;
export function extractDataBlocks(inner) {
    const out = [];
    for (const m of inner.matchAll(DATA_BLOCK_RE)) {
        out.push({ kind: m[1], json: m[2] });
    }
    return out;
}
