/** Fill-drag support: rewrite a formula's cell references when it is copied to a cell
    `dRow` rows down and `dCol` columns right (Excel fill-handle semantics). RELATIVE refs
    shift; `$`-anchored parts hold; named refs (`@block.output`), string literals and function
    names never move. This is a STRING rewrite (via the shared tokeniser) — it never touches the
    parser or evaluator. A ref shifted off the grid (col/row < 1) becomes `#REF!`, like Excel. */
import { rewriteFormula } from './rewrite.js';
import { isA1, colToNum, numToCol } from './refs.js';
/** Split an A1 token into its anchors + parts. Uppercase only (mirrors the engine's isA1). */
const REF_PARTS = /^(\$?)([A-Z]+)(\$?)([0-9]+)$/;
function shiftRef(ref, dRow, dCol) {
    const m = REF_PARTS.exec(ref);
    if (!m)
        return ref; // caller guards with isA1, so this is unreachable in practice
    const [, colAnchor, colLetters, rowAnchor, rowDigits] = m;
    let col = colToNum(colLetters);
    let row = parseInt(rowDigits, 10);
    if (colAnchor !== '$')
        col += dCol;
    if (rowAnchor !== '$')
        row += dRow;
    if (col < 1 || row < 1)
        return '#REF!';
    return colAnchor + numToCol(col) + rowAnchor + row;
}
/** Rewrite `formula` (with or without a leading "=") for a copy shifted by (dRow, dCol).
    Returns a "="-prefixed formula. A no-op shift or an unparseable formula is returned unchanged. */
export function shiftFormula(formula, dRow, dCol) {
    if (dRow === 0 && dCol === 0)
        return formula;
    return rewriteFormula(formula, (name, isFunc) => (!isFunc && isA1(name) ? shiftRef(name, dRow, dCol) : name));
}
