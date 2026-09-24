import type { Violation } from './types.js';
export declare const TIMELINE_TITLE_MAX = 200;
export declare const TIMELINE_BODY_MAX = 2000;
export declare const TIMELINE_DATE_MAX = 40;
export declare const TIMELINE_MAX_EVENTS = 200;
export type TimelineOrientation = 'vertical' | 'horizontal';
export interface TimelineEvent {
    date?: string;
    title: string;
    body?: string;
}
export interface TimelineData {
    orientation?: TimelineOrientation;
    events: TimelineEvent[];
}
/** Shape-only validation: reject bad values, never unknown keys. Absent optional
    fields are the defaults (orientation absent = vertical), so an old deck that
    never carried them validates and saves byte-identically. */
export declare function validateTimelineData(data: unknown): Violation[];
export declare function timelineDataJson(data: TimelineData): string;
