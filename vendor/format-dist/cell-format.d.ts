/** Display-only formatting of a baked cell value under a user-applied CellFormat. PURE (no calc,
    no DOM) so both the Studio editor and the inert viewer format identically from the same code.
    NEVER changes the stored/baked string — `general` (or no format) returns it verbatim (calc
    already produced its canonical form). Ported from the alpha's applyFmtText/numFmt/dateDisplay;
    "units are permanently off" in the alpha, so there is no unit/dimensional handling here. */
import type { CellFormat } from './table-data.js';
/** A baked string (calc output or a typed literal) interpreted for display. */
export type TypedVal = {
    kind: 'blank';
} | {
    kind: 'err';
    code: string;
} | {
    kind: 'bool';
    b: boolean;
} | {
    kind: 'date';
    y: number;
    m: number;
    d: number;
} | {
    kind: 'num';
    n: number;
} | {
    kind: 'text';
    text: string;
};
/** Interpret a baked string as a typed value. Calc bakes numbers as canonical strings, dates as
    ISO (YYYY-MM-DD), booleans as TRUE/FALSE, and errors as `#…`. */
export declare function typedFromBaked(s: string): TypedVal;
/** The display string for a baked value under a format. Display-only; non-numeric values ignore
    numeric formats (shown natural), mirroring the alpha. */
export declare function formatCell(baked: string, fmt?: CellFormat): string;
/** The tint-class suffix for a format ('cur'|'pct'|'date'|'num') — the alpha's format-driven
    cell tinting (currency green, percent purple, date amber, else neutral). */
export declare function formatTone(fmt?: CellFormat): 'cur' | 'pct' | 'date' | 'num';
