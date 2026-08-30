/** Shared formula rewriting: tokenise a formula body (reusing the lexer, so strings, `@`refs,
    operators and numbers are handled correctly) and rebuild it canonically, letting `onName`
    transform each NAME token. A NAME is either a function (when immediately followed by "("),
    a cell ref, TRUE/FALSE, or a user identifier — `onName` decides. Every other token is
    re-emitted verbatim. Malformed input (a lexer error) is returned unchanged. Used by
    shiftFormula (fill-drag), resolveNames (reference-by-name), and the sheet-rename/-delete
    rewrites below (which hook the optional `onQref`). */
import { lex } from './lexer.js';
export function rewriteFormula(formula, onName, onQref) {
    const body = formula.startsWith('=') ? formula.slice(1) : formula;
    let toks;
    try {
        toks = lex(body);
    }
    catch {
        return formula;
    }
    let out = '=';
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        switch (t.k) {
            case 'num':
                out += String(t.v);
                break;
            case 'str':
                out += '"' + t.v.replace(/"/g, '""') + '"';
                break;
            case 'err':
                out += t.v;
                break;
            case 'named':
                out += '@' + t.block + '.' + t.name;
                break;
            case 'qref':
                // Default: re-emit a qualified cross-sheet ref VERBATIM. Reference-by-name (resolveNames) and
                // fill-drag (shiftFormula) must not touch it — a qualified ref points at another sheet, so no
                // in-sheet name-resolve or fill-shift applies. The tab-rename / tab-delete rewrites hook in
                // through `onQref` (renameSheetInFormula / breakSheetRefsInFormula below).
                out += onQref ? onQref(t) : t.raw;
                break;
            case 'op':
                out += t.v;
                break;
            case 'lp':
                out += '(';
                break;
            case 'rp':
                out += ')';
                break;
            case 'comma':
                out += ',';
                break;
            case 'colon':
                out += ':';
                break;
            case 'name':
                out += onName(t.v, toks[i + 1]?.k === 'lp');
                break;
            case 'eof':
                break;
        }
    }
    return out;
}
/** Emit a sheet name in exactly the two forms the lexer accepts for a qualified ref: BARE when it is
    identifier-shaped and not A1-shaped (an `A1`-looking name would shadow a cell ref elsewhere), else
    '-quoted with `''` escaping. The single source of the quoting rule — studio-core's qualifySheetRef
    delegates here so authored refs and rename-rewritten refs can never disagree. */
export function quoteSheetName(name) {
    const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Z]+[0-9]+$/.test(name);
    return bare ? name : "'" + name.replace(/'/g, "''") + "'";
}
/** Rewrite every qualified ref targeting sheet `target` via `emit`; refs to other sheets, local refs,
    strings, etc. are untouched. A formula with NO qualified ref to `target` is returned BYTE-IDENTICAL
    (never re-canonicalised) so an unaffected formula can't churn the persisted JSON. */
function rewriteSheetQrefs(formula, target, emit) {
    const body = formula.startsWith('=') ? formula.slice(1) : formula;
    let toks;
    try {
        toks = lex(body);
    }
    catch {
        return formula;
    }
    if (!toks.some((t) => t.k === 'qref' && t.sheet === target))
        return formula;
    return rewriteFormula(formula, (name) => name, (q) => (q.sheet === target ? emit(q) : q.raw));
}
/** Tab rename: every qualified ref to `oldName` re-points at `newName`, requoted canonically
    (bare↔quoted follows the new name's shape). The A1 suffix is preserved verbatim. */
export function renameSheetInFormula(formula, oldName, newName) {
    return rewriteSheetQrefs(formula, oldName, (q) => quoteSheetName(newName) + '!' + q.a + (q.b !== undefined ? ':' + q.b : ''));
}
/** Tab delete: every qualified ref to the deleted `sheetName` collapses to `#REF!` (Excel semantics —
    the same idiom a deleted local line leaves behind; the cell bakes #REF! on the next recalc). */
export function breakSheetRefsInFormula(formula, sheetName) {
    return rewriteSheetQrefs(formula, sheetName, () => '#REF!');
}
