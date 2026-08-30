/** Shared formula rewriting: tokenise a formula body (reusing the lexer, so strings, `@`refs,
    operators and numbers are handled correctly) and rebuild it canonically, letting `onName`
    transform each NAME token. A NAME is either a function (when immediately followed by "("),
    a cell ref, TRUE/FALSE, or a user identifier — `onName` decides. Every other token is
    re-emitted verbatim. Malformed input (a lexer error) is returned unchanged. Used by
    shiftFormula (fill-drag), resolveNames (reference-by-name), and the sheet-rename/-delete
    rewrites below (which hook the optional `onQref`). */
/** A qualified cross-sheet ref token, as `onQref` sees it. */
type QrefTok = {
    sheet: string;
    a: string;
    b?: string;
    raw: string;
};
export declare function rewriteFormula(formula: string, onName: (name: string, isFunc: boolean) => string, onQref?: (q: QrefTok) => string): string;
/** Emit a sheet name in exactly the two forms the lexer accepts for a qualified ref: BARE when it is
    identifier-shaped and not A1-shaped (an `A1`-looking name would shadow a cell ref elsewhere), else
    '-quoted with `''` escaping. The single source of the quoting rule — studio-core's qualifySheetRef
    delegates here so authored refs and rename-rewritten refs can never disagree. */
export declare function quoteSheetName(name: string): string;
/** Tab rename: every qualified ref to `oldName` re-points at `newName`, requoted canonically
    (bare↔quoted follows the new name's shape). The A1 suffix is preserved verbatim. */
export declare function renameSheetInFormula(formula: string, oldName: string, newName: string): string;
/** Tab delete: every qualified ref to the deleted `sheetName` collapses to `#REF!` (Excel semantics —
    the same idiom a deleted local line leaves behind; the cell bakes #REF! on the next recalc). */
export declare function breakSheetRefsInFormula(formula: string, sheetName: string): string;
export {};
