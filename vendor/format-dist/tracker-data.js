/**
 * Tracker kind data — the Coty action tracker, carried per slide as an inert
 * JSON block: <script type="application/json" data-odata="tracker">.
 * Same carrier rules as the gantt (see gantt-data.ts): the serializer escapes
 * every "<" and validateSlideContent enforces the literal script form.
 */
export const TRACKER_STATUSES = ['Open', 'In progress', 'Blocked', 'Closed'];
/** The effective status options — the deck's custom list, or the default four. */
export function trackerStatuses(data) {
    return data.statuses && data.statuses.length > 0 ? data.statuses : TRACKER_STATUSES;
}
/** Strict shape check for a tracker data block. REJECT, never repair. */
export function validateTrackerData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `tracker.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'tracker data must be a JSON object');
        return v;
    }
    const d = data;
    if (!Array.isArray(d.rows)) {
        bad('rows', 'rows must be an array');
        return v;
    }
    // optional custom status options; absent = the default four
    let allowed = TRACKER_STATUSES;
    if (d.statuses !== undefined) {
        if (!Array.isArray(d.statuses) ||
            d.statuses.length < 1 ||
            d.statuses.length > 12 ||
            !d.statuses.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 40)) {
            bad('statuses', 'statuses must be an array of 1–12 short (≤40 char) strings');
        }
        else {
            allowed = d.statuses;
        }
    }
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    d.rows.forEach((r, i) => {
        const o = (r ?? {});
        if (!str(o.action, 2000))
            bad('row.action', `row ${i}: action must be a string (max 2000)`);
        if (!str(o.owner, 200))
            bad('row.owner', `row ${i}: owner must be a string (max 200)`);
        if (!str(o.comments, 2000))
            bad('row.comments', `row ${i}: comments must be a string (max 2000)`);
        if (!str(o.due, 60))
            bad('row.due', `row ${i}: due must be a string (max 60)`);
        if (!allowed.includes(o.status)) {
            bad('row.status', `row ${i}: status must be one of ${allowed.join('|')}`);
        }
        if (typeof o.done !== 'boolean')
            bad('row.done', `row ${i}: done must be a boolean`);
    });
    return v;
}
/** Serialize tracker data for embedding — "<" escaped (same invariant as ganttDataJson). */
export function trackerDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
