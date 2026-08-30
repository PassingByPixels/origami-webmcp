import type { Violation } from './types.js';
/**
 * Tracker kind data — the Coty action tracker, carried per slide as an inert
 * JSON block: <script type="application/json" data-odata="tracker">.
 * Same carrier rules as the gantt (see gantt-data.ts): the serializer escapes
 * every "<" and validateSlideContent enforces the literal script form.
 */
export declare const TRACKER_STATUSES: readonly ["Open", "In progress", "Blocked", "Closed"];
export interface TrackerRow {
    action: string;
    owner: string;
    comments: string;
    due: string;
    /** One of the tracker's status options (the default four, or the deck's custom `statuses`). */
    status: string;
    done: boolean;
}
export interface TrackerData {
    rows: TrackerRow[];
    /** Custom status options (editable in the Studio). Absent = the default four (byte-stable).
        The LAST option is the "done" status, the FIRST the "reopen" status (the Closed⇄done sync). */
    statuses?: string[];
}
/** The effective status options — the deck's custom list, or the default four. */
export declare function trackerStatuses(data: TrackerData): readonly string[];
/** Strict shape check for a tracker data block. REJECT, never repair. */
export declare function validateTrackerData(data: unknown): Violation[];
/** Serialize tracker data for embedding — "<" escaped (same invariant as ganttDataJson). */
export declare function trackerDataJson(data: TrackerData): string;
