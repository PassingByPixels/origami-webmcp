import type { CalcError, CalcErrorCode } from './errors.js';
export type { CalcErrorCode };
/** A computed value. Baked cells arrive as strings and are coerced on use. */
export type CalcValue = number | string | boolean | CalcError;
/** Input to recalc — matches studio-core/platform.ts CalcGrid structurally. */
export interface CalcGrid {
    rows: string[][];
    /** A1 -> "=…" (inert side-map). The displayed value lives in `rows`. */
    formulas?: Record<string, string>;
    /** name -> "=…" — this block's exported outputs. */
    named?: Record<string, string>;
}
export interface CalcCellError {
    at: string;
    code: CalcErrorCode;
}
export interface CalcResult {
    /** Baked display values — same shape as the input rows. */
    values: string[][];
    errors: CalcCellError[];
    /** Named outputs (name -> baked display string) for @block.output cross-refs. */
    outputs: Record<string, string>;
}
