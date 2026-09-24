import type { Violation } from './types.js';
export declare const CALENDAR_YEAR_MIN = 1900;
export declare const CALENDAR_YEAR_MAX = 2200;
export declare const CALENDAR_HEADING_MAX = 80;
export declare const CALENDAR_ENTRY_MAX = 500;
export declare const CALENDAR_MAX_ENTRIES = 3660;
export interface CalendarNote {
    heading?: string;
    text?: string;
}
export interface CalendarData {
    year: number;
    month: number;
    entries?: Record<string, CalendarNote>;
    weekendGrey?: false;
    presets?: false;
    colors?: Record<string, string>;
}
export declare function parseCalendarNote(value: unknown): CalendarNote | null;
export declare function calendarDaysInMonth(year: number, month: number): number;
export declare function calendarIsoDate(year: number, month: number, day: number): string;
export declare function validateCalendarData(data: unknown): Violation[];
export declare function calendarDataJson(data: CalendarData): string;
