/** Reference-by-name: rewrite a formula, replacing bare identifiers with their mapped A1 address
    so `=price*qty` becomes `=C2*B2` before recalc. `names` maps identifier -> A1 (the caller
    inverts a cellNames A1->name map, and a column-rule expansion supplies per-row column names).

    Resolution rule: an identifier is replaced only when it is in `names` AND is not a function
    call (`name(`). So a function ALWAYS wins over a same-named cell — `=SUM(A1:A2)` keeps SUM,
    while `=SUM+1` with a cell named "SUM" resolves it. Names not in the map are left as-is for
    recalc to flag `#NAME?` (or accept as a bare A1 ref / TRUE / FALSE). Purely a bake-time
    transform: the STORED formula keeps the names; only the recalc input is resolved. */
import { rewriteFormula } from './rewrite.js';
import { isA1 } from './refs.js';
export function resolveNames(formula, names) {
    if (!formula.startsWith('=') || Object.keys(names).length === 0)
        return formula;
    // A real A1 ref always wins over a same-named cell — `=A1` is the cell A1, never a name.
    return rewriteFormula(formula, (name, isFunc) => !isFunc && !isA1(name) && Object.prototype.hasOwnProperty.call(names, name) ? names[name] : name);
}
