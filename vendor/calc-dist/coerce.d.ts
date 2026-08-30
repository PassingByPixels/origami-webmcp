import { CalcError } from './errors.js';
import type { CalcValue } from './types.js';
/** A range value is 2D (rows × cols); a function argument is a scalar or a range. */
export type Range2D = CalcValue[][];
export type CalcArg = CalcValue | Range2D;
export declare const isRange: (a: CalcArg) => a is Range2D;
/** A single arg as a 1D list of cell values (a scalar becomes a one-element list). */
export declare const asRow: (a: CalcArg | undefined) => CalcValue[];
/** A single arg collapsed to one scalar (top-left cell of a range). */
export declare const scalar: (a: CalcArg | undefined) => CalcValue;
/** All args flattened to a single 1D list of cell values (ranges expanded). */
export declare function flatten(args: CalcArg[]): CalcValue[];
export declare function firstErr(vals: CalcValue[]): CalcError | null;
/** Lenient numeric collection for aggregates: numbers + numeric strings + booleans
    are kept; blank + non-numeric text are skipped; an error operand propagates. */
export declare function collectNums(args: CalcArg[]): number[] | CalcError;
/** Strict numeric coercion for arithmetic: blank->0, numeric string->n, bool->1/0,
    non-numeric text-> #VALUE!. Errors propagate. */
export declare function toNum(v: CalcValue): number | CalcError;
export declare function toStr(v: CalcValue): string | CalcError;
export declare function toBool(v: CalcValue): boolean | CalcError;
/** Locale-free number formatting that trims float noise (NO toLocaleString) — the
    determinism anchor that keeps a bake byte-stable. */
export declare function formatNumber(n: number): string;
/** The baked display string for any computed value. */
export declare function formatValue(v: CalcValue): string;
/** Match a cell value against a SUMIF/COUNTIF criterion ("=x" | "<>x" | ">10" |
    "<=3" | plain text/number). Comparison is numeric when both sides are numeric,
    else case-insensitive string. */
export declare function matchCriterion(value: CalcValue, criterion: CalcValue): boolean;
