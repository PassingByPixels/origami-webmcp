import type { Violation } from './types.js';
/**
 * Notes kind data — the Scratch Pad card board ("your OneNote for the year"),
 * carried per slide as an inert JSON block:
 * <script type="application/json" data-odata="notes">. Same carrier rules as the
 * tracker/gantt (see tracker-data.ts): the serializer escapes every "<" and
 * validateSlideContent enforces the literal script form.
 *
 * A note is a colourable card with a title, newline-separated bullet body, an
 * optional pin (pinned cards float first), an optional date stamp, and an optional
 * image (an asset id resolved via data-oasset, like every other image in a deck).
 */
export interface Note {
    /** Stable id — drag-reorder + image association key. */
    id: string;
    title: string;
    /** Newline-separated lines; each non-empty line renders as a bullet. */
    body: string;
    /** "" = default card, or a #hex top-border colour. */
    color: string;
    pinned: boolean;
    /** Created date "YYYY-MM-DD" (display only; "" = none). */
    date?: string;
    /** Asset id of an embedded image (data-oasset), if any. */
    image?: string;
}
export interface NotesData {
    notes: Note[];
}
/** Strict shape check for a notes data block. REJECT, never repair. */
export declare function validateNotesData(data: unknown): Violation[];
/** Serialize notes data for embedding — "<" escaped (same invariant as trackerDataJson). */
export declare function notesDataJson(data: NotesData): string;
