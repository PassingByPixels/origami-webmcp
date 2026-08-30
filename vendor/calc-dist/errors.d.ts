/** Excel-style error values. They propagate through evaluation (an error operand
    poisons the result) unless a function tolerates them (IFERROR / ISERROR). */
export type CalcErrorCode = '#REF!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#N/A' | '#CYCLE!';
export declare class CalcError {
    readonly code: CalcErrorCode;
    readonly __calcError: true;
    constructor(code: CalcErrorCode);
}
export declare const err: (code: CalcErrorCode) => CalcError;
export declare const isErr: (v: unknown) => v is CalcError;
/** A syntax/parse failure — recalc maps it to a #NAME?/#VALUE! cell, never repairs. */
export declare class ParseError extends Error {
}
/** Engine identity sentinel. The runtime build greps the distributed viewer IIFE for this
    string (and for the engine-only #CYCLE! code) and FAILS if found — proving @origami/calc
    never leaks into the inert file (R3). Referenced from recalc so a bundler can't drop it. */
export declare const CALC_ENGINE_SENTINEL = "__ORIGAMI_CALC_ENGINE__";
