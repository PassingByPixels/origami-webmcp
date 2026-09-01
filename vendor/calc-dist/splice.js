/** Structural-splice reference rewriting: when a row/column is INSERTED or DELETED mid-sheet,
    every cell reference in every formula must move so the formula still points at the same data.
    This is the sibling of fill.ts's shiftFormula — a STRING rewrite over the shared tokeniser
    (`lex`), never the parser/evaluator — but the semantics differ from a fill-drag:

      - A fill shifts EVERY ref by a constant (dRow,dCol) and RESPECTS `$` anchors.
      - A structural splice shifts a ref ONLY when it sits at/after the edit point, and IGNORES
        `$` anchors: inserting a row bumps `$A$5` to `$A$6` too (Excel structural semantics — the
        `$` only pins a ref against fill/copy, never against the grid changing shape underneath it).

    Deletion is the hard case. A single ref to a deleted line becomes `#REF!`. A RANGE endpoint on a
    deleted line CLAMPS instead of erroring (the range shrinks), and a range whose every line is
    deleted collapses to `#REF!`. That clamp-vs-error distinction needs colon context, so this walks
    the token stream directly (handling `A1:B2` as a unit) rather than going through rewriteFormula's
    per-name callback. A lexer error returns the formula unchanged (never corrupted). */
import { lex } from './lexer.js';
import { isA1, colToNum, numToCol } from './refs.js';
/** Remap a single 0-based line index across the splice. Returns the new index, or `null` when the
    line was one of the DELETED ones. Exported so the model-layer orchestrator remaps its side-map
    keys (cellFormats/rowHeights/rules/…) with the exact same arithmetic the formula refs use. */
export function remapLine(i, sp) {
    if (sp.mode === 'insert')
        return i >= sp.start ? i + sp.count : i;
    if (i < sp.start)
        return i; // before the deletion — unmoved
    if (i >= sp.start + sp.count)
        return i - sp.count; // after the deletion — shifts back
    return null; // inside the deletion — gone
}
/** Remap an inclusive 0-based range `[lo,hi]` across the splice. On delete, a boundary that lands
    inside the deleted band CLAMPS (low → first surviving line, high → last surviving line before
    the band) so the range shrinks rather than errors; `null` means the whole range was deleted.
    Exported for the model layer to move `bake.rect`. */
export function remapRange(lo, hi, sp) {
    if (sp.mode === 'insert') {
        return { lo: lo >= sp.start ? lo + sp.count : lo, hi: hi >= sp.start ? hi + sp.count : hi };
    }
    const end = sp.start + sp.count; // exclusive upper bound of the deleted band
    const nlo = lo < sp.start ? lo : lo >= end ? lo - sp.count : sp.start; // low clamps UP to the band start
    const nhi = hi < sp.start ? hi : hi >= end ? hi - sp.count : sp.start - 1; // high clamps DOWN to below the band
    if (nlo > nhi)
        return null; // every line the range spanned was deleted
    return { lo: nlo, hi: nhi };
}
const REF_PARTS = /^(\$?)([A-Z]+)(\$?)([0-9]+)$/;
/** Parse an A1 token (already known `isA1`) into 0-based col/row + its `$` anchors. */
function parseRef(ref) {
    const m = REF_PARTS.exec(ref);
    if (!m)
        return null;
    return { colAnchor: m[1], col: colToNum(m[2]) - 1, rowAnchor: m[3], row: parseInt(m[4], 10) - 1 };
}
/** Rebuild an A1 string from parsed parts (0-based col/row → letters/1-based), anchors preserved. */
function buildRef(p) {
    return p.colAnchor + numToCol(p.col + 1) + p.rowAnchor + (p.row + 1);
}
/** The axis coordinate (0-based) a splice acts on for a given ref. */
const axisCoord = (p, sp) => (sp.axis === 'row' ? p.row : p.col);
const withCoord = (p, sp, v) => sp.axis === 'row' ? { ...p, row: v } : { ...p, col: v };
/** Rewrite a single cell ref. A deleted target → `#REF!`. */
function spliceRef(ref, sp) {
    const p = parseRef(ref);
    if (!p)
        return ref;
    const nv = remapLine(axisCoord(p, sp), sp);
    return nv === null ? '#REF!' : buildRef(withCoord(p, sp, nv));
}
/** Rewrite a range `a:b` as a unit (clamp-aware). Whole range deleted → `#REF!`. Orientation
    (which endpoint is written first) is preserved. */
function spliceRange(a, b, sp) {
    const pa = parseRef(a), pb = parseRef(b);
    if (!pa || !pb)
        return a + ':' + b;
    const ca = axisCoord(pa, sp), cb = axisCoord(pb, sp);
    const rr = remapRange(Math.min(ca, cb), Math.max(ca, cb), sp);
    if (!rr)
        return '#REF!';
    const newA = ca <= cb ? rr.lo : rr.hi; // the endpoint that was the low one takes the new low
    const newB = ca <= cb ? rr.hi : rr.lo;
    return buildRef(withCoord(pa, sp, newA)) + ':' + buildRef(withCoord(pb, sp, newB));
}
/** Rewrite ONE qualified-ref token whose target sheet was structurally spliced: the sheet-name prefix
    re-emits verbatim from `raw` (a splice never renames), the A1 suffix remaps with the exact local
    semantics (shift / range-clamp). A deleted target or fully-deleted range collapses the WHOLE qref
    to bare `#REF!` — the local deleted-line idiom (a `Sheet!#REF!` suffix wouldn't even lex). */
function spliceQref(t, sp) {
    const suffixLen = t.a.length + (t.b !== undefined ? t.b.length + 1 : 0);
    const prefix = t.raw.slice(0, t.raw.length - suffixLen); // "Sheet2!" / "'My Sheet'!" — quoting kept as written
    if (t.b !== undefined) {
        const rr = spliceRange(t.a, t.b, sp);
        return rr === '#REF!' ? '#REF!' : prefix + rr;
    }
    const nv = spliceRef(t.a, sp);
    return nv === '#REF!' ? '#REF!' : prefix + nv;
}
/** The shared token walk behind spliceFormula / spliceSheetRefs. `local` rewrites bare A1 refs (the
    formula lives ON the spliced sheet); `qsheet` names the spliced sheet, so qualified refs to IT
    remap too (a self-ref on the spliced sheet, or any ref from a sibling sheet). */
function spliceTokens(toks, sp, local, qsheet) {
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
            // A qualified ref remaps only when it points AT the spliced sheet (self-ref, or sibling-side
            // propagation); a ref to any OTHER sheet is untouched by this sheet changing shape.
            case 'qref':
                out += qsheet !== undefined && t.sheet === qsheet ? spliceQref(t, sp) : t.raw;
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
            case 'name': {
                if (!local) {
                    out += t.v;
                    break;
                } // a sibling's own grid didn't change — its local refs hold
                const next = toks[i + 1], after = toks[i + 2];
                if (isA1(t.v) && next?.k === 'colon' && after?.k === 'name' && isA1(after.v)) {
                    out += spliceRange(t.v, after.v, sp); // A1:B2 rewritten together
                    i += 2; // consumed the colon + second endpoint
                }
                else if (isA1(t.v) && next?.k !== 'lp') {
                    out += spliceRef(t.v, sp); // a lone cell ref (never a function-call name)
                }
                else {
                    out += t.v; // function name / user identifier / TRUE / FALSE
                }
                break;
            }
            case 'eof': break;
        }
    }
    return out;
}
/** Rewrite `formula` for a structural row/column insert or delete ON ITS OWN SHEET. Returns a
    "="-prefixed formula. A no-op splice (count<=0) or an unparseable formula is returned unchanged.
    `self` (optional) is the spliced sheet's own tab name: a self-qualified ref (`Self!A5` in a formula
    living on Self) then follows the exact same remap as a local ref; qualified refs to OTHER sheets
    are always re-emitted verbatim. */
export function spliceFormula(formula, sp, self) {
    if (sp.count <= 0)
        return formula;
    const body = formula.startsWith('=') ? formula.slice(1) : formula;
    let toks;
    try {
        toks = lex(body);
    }
    catch {
        return formula;
    }
    return spliceTokens(toks, sp, true, self);
}
/** Cross-sheet splice propagation (the seam the tabs slice left open): rewrite a formula living on a
    SIBLING sheet after sheet `sheet` was structurally spliced — only its `sheet!`-qualified refs remap
    (same shift/clamp/#REF! semantics as local refs); every local ref and every other-sheet qref holds.
    A formula with NO qualified ref to `sheet` returns byte-identical (never re-canonicalised), so
    untouched sibling formulas can't churn the persisted JSON. */
export function spliceSheetRefs(formula, sp, sheet) {
    if (sp.count <= 0 || !sheet)
        return formula;
    const body = formula.startsWith('=') ? formula.slice(1) : formula;
    let toks;
    try {
        toks = lex(body);
    }
    catch {
        return formula;
    }
    if (!toks.some((t) => t.k === 'qref' && t.sheet === sheet))
        return formula; // byte-stable when unaffected
    return spliceTokens(toks, sp, false, sheet);
}
