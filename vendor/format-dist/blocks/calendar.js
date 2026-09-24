import { validateCalendarData } from '../calendar-data.js';
export const calendarBlock = {
    key: 'calendar',
    name: 'Calendar',
    schemaComment: [
        'an editable month calendar — an IN-SLIDE block for Card and Scroll folds',
        'shape: <figure class="o-calendarfig anim"> holding one inert data-odata="calendar" JSON script, one data-calendar-mount div, and a figcaption',
        'JSON shape: { year: integer 1900-2200, month: integer 1-12, entries?: { "YYYY-MM-DD": string | { heading?: string, text?: string } }, presets?: false }',
        'a day note is heading + text shown as a hover popup in Present; omit empty notes',
    ],
    data: { placement: 'block', validate: validateCalendarData },
};
