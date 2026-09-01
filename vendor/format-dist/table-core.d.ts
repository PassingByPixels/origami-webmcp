import type { CellFormat, CondRule } from './table-data.js';
/** A plain A1 cell address: one-or-more column letters + a 1-based row number. */
export declare const A1_RE: RegExp;
/** Column index (0-based) -> its A1 letters. `0`->"A", `26`->"AA". */
export declare const colA1: (c: number) => string;
/** {r,c} (0-based) -> A1 address (`0,0`->"A1"). */
export declare const a1: (r: number, c: number) => string;
/** A1 letters -> column index (0-based). Inverse of colA1; uppercases so a user-typed `a1` still resolves. */
export declare function colIdx(letters: string): number;
/** {r,c} of an A1 key, or null when it isn't a plain A1 address. */
export declare function a1ToRC(key: string): {
    r: number;
    c: number;
} | null;
/** An A1 RANGE ("A1:C10") → an inclusive 0-based rect {r0,c0,r1,c1}, ends NORMALIZED so a reversed
    range ("C10:A1") reads the same. A bare cell ("A1") → a 1×1 rect. Returns null when either end
    isn't a plain A1 address (or the string has >1 colon). Pure addressing — never touches values. */
export declare function a1RangeToRect(range: string): {
    r0: number;
    c0: number;
    r1: number;
    c1: number;
} | null;
/** A baked cell string reads as a NUMBER (locale-free). */
export declare const isNumeric: (s: string) => boolean;
/** A baked cell string is an ERROR value (`#DIV/0!` etc.) — a leading '#'. */
export declare const isErrStr: (s: string) => boolean;
/** Trim float noise off an aggregate before display (locale-free). */
export declare const trimNum: (n: number) => string;
/** A ledger fill-ramp TOKEN name ("fill-forest" / "fill-3") — re-colours when the doc is re-themed. */
export declare const FILL_TOKEN: RegExp;
/** A raw custom fill colour — a #rgb / #rrggbb hex (fixed; does NOT re-theme). The strict shape means a
    validated fill can never inject anything but a colour when the viewer applies it inline. */
export declare const FILL_HEX: RegExp;
/** A cell fill is EITHER a theme token (re-themes) or a raw hex colour (fixed). */
export declare const isFill: (s: string) => boolean;
/** The effective display format for a cell — a per-cell override beats the column's format. Structural
    over both the editor's TableData and the viewer's Ledger (both carry cellFormats + columns[].format). */
export declare function fmtAt(d: {
    cellFormats?: Record<string, CellFormat>;
    columns: ReadonlyArray<{
        format?: CellFormat;
    } | undefined>;
}, r: number, c: number): CellFormat | undefined;
/** The widest content extent — max of columns.length and every row's length. Scanning over THIS (not
    columns.length) is what keeps a wide/hidden cell (a row longer than the columns array) from being missed. */
export declare function gridWidth(d: {
    rows: ReadonlyArray<{
        length: number;
    }>;
    columns: {
        length: number;
    };
}): number;
/** Apply an aggregate FN over an already-gathered numeric list — the shared SUM/AVG/MIN/MAX/COUNT reducer
    behind both the editor's Σ footer and the viewer's. reduce (never Math.min(...spread)) so a
    pathologically large column can't blow the call stack. Returns null for an empty list. */
export declare function aggregateNumbers(fn: string, nums: number[]): {
    fn: string;
    text: string;
} | null;
/** An inclusive 0-based cell rectangle — one merge region (also the shape the merge math works over). */
export interface MergeRect {
    r0: number;
    c0: number;
    r1: number;
    c1: number;
}
/** Parse `merges` (inclusive A1 range strings, e.g. "B2:D3") into normalized rects, dropping any
    malformed or single-cell (1×1) entry. Used IDENTICALLY by the live EDITOR and the inert VIEWER so
    a merge draws the same colspan/rowspan in both. */
export declare function mergeRects(merges: readonly string[] | undefined): MergeRect[];
/** The merge rect covering cell (r,c), or null. Its top-left (r0,c0) is the ANCHOR — the only cell a
    merge renders (as a spanning td); the covered cells render nothing. */
export declare function mergeAt(rects: readonly MergeRect[], r: number, c: number): MergeRect | null;
/** Two inclusive rects overlap. */
export declare function rectsOverlap(a: MergeRect, b: MergeRect): boolean;
/** The inclusive A1 range string ("B2:D3") for a rect — the on-the-wire form of one merge. */
export declare function rectToRange(m: MergeRect): string;
/** Grow `rect` until it fully contains every merge it touches — Excel: a selection that clips a merge
    takes the WHOLE merge. Fixpoint (absorbing one merge can reach another). Pure. */
export declare function expandRectToMerges(rects: readonly MergeRect[], rect: MergeRect): MergeRect;
/** Clip merges to a bake crop window [r0..r1]×[c0..c1] for the viewer. A merge whose ANCHOR is inside
    the window renders with its span clipped to the window's far edges; a merge whose anchor is cropped
    out is dropped (its covered cells are empty anyway). Pure. */
export declare function clipMergesToCrop(rects: readonly MergeRect[], r0: number, c0: number, r1: number, c1: number): MergeRect[];
/** A per-cell conditional-format overlay: a fill and/or a font colour to apply UNDER any explicit user
    cellStyle (an explicit user fill/color always wins). Keyed by A1 in the map evaluateCondFmt returns. */
export interface CondOverlay {
    fill?: string;
    color?: string;
}
/** Evaluate conditional-format rules over a BAKED value grid → per-cell {fill?,color?} overlays keyed
    by A1. PURE + calc-free (value comparisons + a hex interpolator; never a formula). Used IDENTICALLY
    by the editor and the inert viewer, evaluated against the FULL sheet (the viewer then windows the
    render to its crop). Semantics: numeric comparisons (gt/lt/top/bot/scale) consider ONLY numeric
    cells; dupes compares normalized (trimmed, case-sensitive) strings; eq compares to `text` — NUMERIC
    equality when `text` parses as a number (so only numeric cells can match a numeric target), else a
    trimmed CASE-INSENSITIVE string compare (Excel's "Equal To" quick rule ignores case); empty cells
    never match; merged COVERED cells are skipped (they hold no value); ties in top/bot all match; a
    single-value scale range resolves to the `to` colour. When two rules paint the same cell+channel,
    the LATER rule wins. Rows beyond the grid contribute nothing (the range is clamped to the value
    grid, so a hostile/oversized range can never loop past the data). */
export declare function evaluateCondFmt(values: ReadonlyArray<ReadonlyArray<string>>, rules: readonly CondRule[] | undefined, merges?: readonly MergeRect[]): Map<string, CondOverlay>;
