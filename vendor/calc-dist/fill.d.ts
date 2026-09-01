/** Fill-drag support: rewrite a formula's cell references when it is copied to a cell
    `dRow` rows down and `dCol` columns right (Excel fill-handle semantics). RELATIVE refs
    shift; `$`-anchored parts hold; named refs (`@block.output`), string literals and function
    names never move. This is a STRING rewrite (via the shared tokeniser) — it never touches the
    parser or evaluator. A ref shifted off the grid (col/row < 1) becomes `#REF!`, like Excel. */
/** Rewrite `formula` (with or without a leading "=") for a copy shifted by (dRow, dCol).
    Returns a "="-prefixed formula. A no-op shift or an unparseable formula is returned unchanged. */
export declare function shiftFormula(formula: string, dRow: number, dCol: number): string;
