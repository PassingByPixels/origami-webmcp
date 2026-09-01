import type { Violation } from './types.js';
/**
 * Data-grid kind data — a searchable / sortable table with per-column conditional
 * tone, carried per slide as an inert JSON block:
 * <script type="application/json" data-odata="grid">. Same carrier rules as the
 * tracker/gantt: the serializer escapes every "<" and validateSlideContent
 * enforces the literal script form. The grid is interactive (search/sort) WITHOUT
 * tripping the padlock because all of that lives in the bundled runtime renderer,
 * never in slide-level script — exactly the tracker pattern.
 */
export declare const GRID_TONES: readonly ["", "accent", "green", "amber", "red"];
export type GridTone = (typeof GRID_TONES)[number];
export declare const GRID_ALIGNS: readonly ["left", "right", "center"];
export type GridAlign = (typeof GRID_ALIGNS)[number];
/** Conditional formatting rule for a column. `status` maps an exact cell value to
    a tone; `scale` reads the cell as a number and tints it on a min→max heatmap
    (reverse = high is bad). */
export type GridToneRule = {
    type: 'status';
    map: Record<string, GridTone>;
} | {
    type: 'scale';
    min: number;
    max: number;
    reverse?: boolean;
};
export interface GridColumn {
    label: string;
    align?: GridAlign;
    tone?: GridToneRule;
}
export interface GridData {
    columns: GridColumn[];
    /** Row-major cells, each a display string; a row may be shorter than columns. */
    rows: string[][];
}
export declare const GRID_MAX_COLS = 40;
export declare const GRID_MAX_ROWS = 2000;
/** Strict shape check for a grid data block. REJECT, never repair. `maxCols` lets the
    ledger (a spreadsheet) reuse this with a wider ceiling than the display grid — see
    TABLE_MAX_COLS; grid callers keep the default GRID_MAX_COLS. */
export declare function validateGridData(data: unknown, maxCols?: number): Violation[];
/** Serialize grid data for embedding — "<" escaped (same invariant as trackerDataJson). */
export declare function gridDataJson(data: GridData): string;
