export const TIMELINE_TITLE_MAX = 200;
export const TIMELINE_BODY_MAX = 2000;
export const TIMELINE_DATE_MAX = 40;
export const TIMELINE_MAX_EVENTS = 200;
/** Shape-only validation: reject bad values, never unknown keys. Absent optional
    fields are the defaults (orientation absent = vertical), so an old deck that
    never carried them validates and saves byte-identically. */
export function validateTimelineData(data) {
    const out = [];
    const bad = (rule, detail) => { out.push({ rule: `timeline.${rule}`, detail }); };
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return [{ rule: 'timeline.shape', detail: 'timeline data must be a JSON object' }];
    const d = data;
    if (d.orientation !== undefined && d.orientation !== 'vertical' && d.orientation !== 'horizontal')
        bad('orientation', 'orientation must be "vertical" or "horizontal"');
    if (!Array.isArray(d.events)) {
        bad('events', 'events must be an array');
        return out;
    }
    if (d.events.length > TIMELINE_MAX_EVENTS)
        bad('events.count', `events must contain at most ${TIMELINE_MAX_EVENTS} events`);
    d.events.forEach((event, i) => {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
            bad(`events.${i}`, 'each event must be a JSON object');
            return;
        }
        const e = event;
        if (typeof e.title !== 'string' || e.title.length < 1 || e.title.length > TIMELINE_TITLE_MAX)
            bad(`events.${i}.title`, `event title must contain 1-${TIMELINE_TITLE_MAX} characters`);
        if (e.date !== undefined && (typeof e.date !== 'string' || e.date.length > TIMELINE_DATE_MAX))
            bad(`events.${i}.date`, `event date must be a string of at most ${TIMELINE_DATE_MAX} characters`);
        if (e.body !== undefined && (typeof e.body !== 'string' || e.body.length > TIMELINE_BODY_MAX))
            bad(`events.${i}.body`, `event body must be a string of at most ${TIMELINE_BODY_MAX} characters`);
    });
    return out;
}
export function timelineDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
