import type { Violation } from './types.js';
/**
 * Tracker kind data — the Coty action tracker, carried per slide as an inert
 * JSON block: <script type="application/json" data-odata="tracker">.
 * Same carrier rules as the gantt (see gantt-data.ts): the serializer escapes
 * every "<" and validateSlideContent enforces the literal script form.
 *
 * TWO SHAPES, one reader. A tracker is either
 *   LEGACY  — no `columns` ARRAY: exactly the six fixed columns below, with the
 *             optional `columns` label map, `hidden` list and `statuses` list; or
 *   CUSTOM  — `columns` is an ARRAY of author-defined column specs, each with its
 *             own key/label/type/options; `hidden`/`statuses` are then illegal
 *             because a column carries its own `hidden` flag and its own options.
 * Absence of a `columns` ARRAY means exactly the legacy six, so every tracker
 * written before this shape existed still parses and still saves byte-identical.
 */
export declare const TRACKER_STATUSES: readonly ["Open", "In progress", "Blocked", "Closed"];
/** The LEGACY tracker's columns, in render order. */
export declare const TRACKER_COLUMNS: readonly ["action", "owner", "comments", "due", "status", "done"];
export type TrackerColumn = (typeof TRACKER_COLUMNS)[number];
/** Every legacy column EXCEPT `action` — the action text is the tracker, so it can never be hidden. */
export type TrackerHideableColumn = Exclude<TrackerColumn, 'action'>;
/** The default LEGACY column headings. Absence of an override means exactly these (byte-stable). */
export declare const TRACKER_COLUMN_LABELS: Record<TrackerColumn, string>;
/** What a column holds. The type decides the cell editor, the default width and the sort order. */
export declare const TRACKER_COLUMN_TYPES: readonly ["text", "person", "date", "select", "check", "number"];
export type TrackerColumnType = (typeof TRACKER_COLUMN_TYPES)[number];
/** One author-defined column. */
export interface TrackerColumnSpec {
    /** Stable row-field name: [a-z][a-z0-9_]{0,23}, unique in the tracker. A relabel never moves it. */
    key: string;
    /** The heading, 1–40 chars. */
    label: string;
    type: TrackerColumnType;
    /** `select` only, and REQUIRED there: 1–12 distinct option labels, each 1–40 chars. */
    options?: string[];
    /** Header width in px, 60–600. Absent = the per-type default below. */
    width?: number;
    /** true = the column renders on NO surface (viewer, print, Studio). Absent = shown. */
    hidden?: boolean;
    /** `select` only: this column drives done/reopen — LAST option = done, FIRST = reopen. At most one. */
    status?: boolean;
    /** `check` only: this column is the completion toggle (strike-through + the "open" count). At most one. */
    done?: boolean;
}
export declare const TRACKER_KEY_RE: RegExp;
export declare const TRACKER_WIDTH_MIN = 60;
export declare const TRACKER_WIDTH_MAX = 600;
export declare const TRACKER_MAX_COLUMNS = 24;
/** Header width per type when a column names none. */
export declare const TRACKER_TYPE_WIDTHS: Record<TrackerColumnType, number>;
/** The widths the legacy six have always rendered at — kept verbatim so a legacy tracker's
    header is pixel-identical to what it was before columns became author-defined. */
export declare const TRACKER_LEGACY_WIDTHS: Record<TrackerColumn, string>;
/** Legacy column heading overrides: a key absent = that column's default heading. */
export type TrackerLabelMap = Partial<Record<TrackerColumn, string>>;
/** What one cell holds: `text|person|date|select` = string, `check` = boolean,
    `number` = a finite number (or '' for a blank number cell). */
export type TrackerCell = string | number | boolean;
/** One row: a cell per column key. A LEGACY tracker's rows carry exactly the six fields below. */
export type TrackerRow = Record<string, TrackerCell>;
/** The six fields a legacy tracker's rows carry — the shape the legacy validator enforces. */
export interface TrackerLegacyRow {
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
    /** LEGACY only. Custom status options. Absent = the default four (byte-stable).
        The LAST option is the "done" status, the FIRST the "reopen" status (the Closed⇄done sync). */
    statuses?: string[];
    /** Either the LEGACY heading map over the fixed six, or the CUSTOM column list in render order. */
    columns?: TrackerLabelMap | TrackerColumnSpec[];
    /** LEGACY only. Columns the author hid — rendered on NO surface. `action` is never here. */
    hidden?: TrackerHideableColumn[];
}
/** The author's own column list, or null for a legacy tracker. `Array.isArray` IS the mode flag. */
export declare function trackerCustomColumns(data: TrackerData): TrackerColumnSpec[] | null;
/** The legacy six materialised as specs — the label map, the `hidden` list and `statuses` folded
    in. THE migration input, and the effective column list of every legacy tracker. */
export declare function trackerLegacyColumnSpecs(data: TrackerData): TrackerColumnSpec[];
/** The effective column list, in render order, INCLUDING the hidden ones. */
export declare function trackerColumnSpecs(data: TrackerData): TrackerColumnSpec[];
/** The columns that render, in order. */
export declare function trackerVisibleColumnSpecs(data: TrackerData): TrackerColumnSpec[];
/** The keys of the columns that render, in order. */
export declare function trackerVisibleColumns(data: TrackerData): string[];
/** The effective heading for one column — the author's label, or the key if no such column exists. */
export declare function trackerColumnLabel(data: TrackerData, key: string): string;
/** The column driving done/reopen: a `select` marked `status`. null = no such column. */
export declare function trackerStatusColumn(data: TrackerData): TrackerColumnSpec | null;
/** The completion toggle: a `check` marked `done`. null = the tracker has no done/strike behaviour. */
export declare function trackerDoneColumn(data: TrackerData): TrackerColumnSpec | null;
/** The tracker's status options — the status column's list, or [] when it has no status column. */
export declare function trackerStatuses(data: TrackerData): readonly string[];
/** The header width for one column: the legacy %/px it has always used, or px from the spec/type. */
export declare function trackerColumnWidth(data: TrackerData, spec: TrackerColumnSpec): string;
/** Strict shape check for a tracker data block. REJECT, never repair. */
export declare function validateTrackerData(data: unknown): Violation[];
/** Serialize tracker data for embedding — "<" escaped (same invariant as ganttDataJson). */
export declare function trackerDataJson(data: TrackerData): string;
