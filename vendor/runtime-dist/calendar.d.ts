import { type CalendarData } from '@origami/format';
export declare const CALENDAR_PRESETS: Array<{
    key: string;
    label: string;
}>;
export declare function normalizeCalendarData(raw: unknown): CalendarData;
export declare function calendarGrid(year: number, month: number): Array<string | null>;
export declare function shiftCalendarMonth(data: CalendarData, delta: number): CalendarData;
export declare function calendarPresetAnchor(kind: string, view: {
    year: number;
    month: number;
}, now?: Date): {
    year: number;
    month: number;
    day: number;
    iso: string;
};
export declare function shiftCalendarTo(data: CalendarData, year: number, month: number): CalendarData;
export declare function renderCalendar(figure: HTMLElement, data: CalendarData): void;
export declare function mountCalendars(slide: Element): void;
export declare const finalizeCalendars: typeof mountCalendars;
