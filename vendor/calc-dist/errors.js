export class CalcError {
    code;
    __calcError = true;
    constructor(code) {
        this.code = code;
    }
}
export const err = (code) => new CalcError(code);
export const isErr = (v) => v instanceof CalcError;
/** A syntax/parse failure — recalc maps it to a #NAME?/#VALUE! cell, never repairs. */
export class ParseError extends Error {
}
/** Engine identity sentinel. The runtime build greps the distributed viewer IIFE for this
    string (and for the engine-only #CYCLE! code) and FAILS if found — proving @origami/calc
    never leaks into the inert file (R3). Referenced from recalc so a bundler can't drop it. */
export const CALC_ENGINE_SENTINEL = '__ORIGAMI_CALC_ENGINE__';
