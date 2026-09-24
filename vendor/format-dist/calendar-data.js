export const CALENDAR_YEAR_MIN = 1900;
export const CALENDAR_YEAR_MAX = 2200;
export const CALENDAR_HEADING_MAX = 80;
export const CALENDAR_ENTRY_MAX = 500;
export const CALENDAR_MAX_ENTRIES = 3660;
const pad = (n) => String(n).padStart(2, '0');
export function parseCalendarNote(value) {
    if (typeof value === 'string') {
        const text = value.trim().slice(0, CALENDAR_ENTRY_MAX);
        return text ? { text } : null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    const heading = typeof raw.heading === 'string' ? raw.heading.trim().slice(0, CALENDAR_HEADING_MAX) : '';
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, CALENDAR_ENTRY_MAX) : '';
    if (!heading && !text)
        return null;
    return { ...(heading ? { heading } : {}), ...(text ? { text } : {}) };
}
export function calendarDaysInMonth(year, month) {
    if (month === 2)
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
export function calendarIsoDate(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
}
export function validateCalendarData(data) {
    const out = [];
    const bad = (rule, detail) => { out.push({ rule: `calendar.${rule}`, detail }); };
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return [{ rule: 'calendar.shape', detail: 'calendar data must be a JSON object' }];
    const d = data;
    const yearOk = Number.isInteger(d.year) && Number(d.year) >= CALENDAR_YEAR_MIN && Number(d.year) <= CALENDAR_YEAR_MAX;
    const monthOk = Number.isInteger(d.month) && Number(d.month) >= 1 && Number(d.month) <= 12;
    if (!yearOk)
        bad('year', `year must be an integer from ${CALENDAR_YEAR_MIN} to ${CALENDAR_YEAR_MAX}`);
    if (!monthOk)
        bad('month', 'month must be an integer from 1 to 12');
    if (d.weekendGrey !== undefined && d.weekendGrey !== false)
        bad('weekendGrey', 'weekendGrey must be false when supplied');
    if (d.presets !== undefined && d.presets !== false)
        bad('presets', 'presets must be false when supplied');
    if (d.entries !== undefined) {
        if (!d.entries || typeof d.entries !== 'object' || Array.isArray(d.entries))
            bad('entries', 'entries must be an object');
        else {
            const entries = Object.entries(d.entries);
            if (entries.length > CALENDAR_MAX_ENTRIES)
                bad('entries.count', `entries must contain at most ${CALENDAR_MAX_ENTRIES} dates`);
            for (const [date, text] of entries) {
                const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
                const y = match ? Number(match[1]) : 0;
                const m = match ? Number(match[2]) : 0;
                const day = match ? Number(match[3]) : 0;
                if (!match || y < CALENDAR_YEAR_MIN || y > CALENDAR_YEAR_MAX || m < 1 || m > 12 || day < 1 || day > calendarDaysInMonth(y, m))
                    bad(`entries.${date}`, `${date} must be a valid calendar date`);
                const note = parseCalendarNote(text);
                if (!note)
                    bad(`entries.${date}.text`, `entry must be a non-empty string or { heading?, text? }`);
                else {
                    if (note.heading && note.heading.length > CALENDAR_HEADING_MAX)
                        bad(`entries.${date}.heading`, `heading must contain at most ${CALENDAR_HEADING_MAX} characters`);
                    if (note.text && note.text.length > CALENDAR_ENTRY_MAX)
                        bad(`entries.${date}.text`, `entry text must contain 1-${CALENDAR_ENTRY_MAX} characters`);
                }
            }
        }
    }
    if (d.colors !== undefined) {
        if (!d.colors || typeof d.colors !== 'object' || Array.isArray(d.colors))
            bad('colors', 'colors must be an object');
        else {
            const colors = Object.entries(d.colors);
            if (colors.length > CALENDAR_MAX_ENTRIES)
                bad('colors.count', `colors must contain at most ${CALENDAR_MAX_ENTRIES} dates`);
            for (const [date, color] of colors) {
                const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
                const y = match ? Number(match[1]) : 0;
                const m = match ? Number(match[2]) : 0;
                const day = match ? Number(match[3]) : 0;
                if (!match || y < CALENDAR_YEAR_MIN || y > CALENDAR_YEAR_MAX || m < 1 || m > 12 || day < 1 || day > calendarDaysInMonth(y, m))
                    bad(`colors.${date}`, `${date} must be a valid calendar date`);
                if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))
                    bad(`colors.${date}.color`, 'cell colour must be a six-digit hex colour');
            }
        }
    }
    return out;
}
export function calendarDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
