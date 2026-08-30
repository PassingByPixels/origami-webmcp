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
/** One structural edit on a single axis: `count` lines inserted or deleted starting at 0-based
    line `start`. Insert: the new lines appear AT `start` (everything at/after shifts away). Delete:
    lines `[start, start+count)` are removed (everything after shifts back). */
export type GridSplice = {
    axis: 'row' | 'col';
    /** 0-based line index where the edit begins. */
    start: number;
    /** Number of lines inserted or deleted (must be > 0). */
    count: number;
    mode: 'insert' | 'delete';
};
/** Remap a single 0-based line index across the splice. Returns the new index, or `null` when the
    line was one of the DELETED ones. Exported so the model-layer orchestrator remaps its side-map
    keys (cellFormats/rowHeights/rules/…) with the exact same arithmetic the formula refs use. */
export declare function remapLine(i: number, sp: GridSplice): number | null;
/** Remap an inclusive 0-based range `[lo,hi]` across the splice. On delete, a boundary that lands
    inside the deleted band CLAMPS (low → first surviving line, high → last surviving line before
    the band) so the range shrinks rather than errors; `null` means the whole range was deleted.
    Exported for the model layer to move `bake.rect`. */
export declare function remapRange(lo: number, hi: number, sp: GridSplice): {
    lo: number;
    hi: number;
} | null;
/** Rewrite `formula` for a structural row/column insert or delete ON ITS OWN SHEET. Returns a
    "="-prefixed formula. A no-op splice (count<=0) or an unparseable formula is returned unchanged.
    `self` (optional) is the spliced sheet's own tab name: a self-qualified ref (`Self!A5` in a formula
    living on Self) then follows the exact same remap as a local ref; qualified refs to OTHER sheets
    are always re-emitted verbatim. */
export declare function spliceFormula(formula: string, sp: GridSplice, self?: string): string;
/** Cross-sheet splice propagation (the seam the tabs slice left open): rewrite a formula living on a
    SIBLING sheet after sheet `sheet` was structurally spliced — only its `sheet!`-qualified refs remap
    (same shift/clamp/#REF! semantics as local refs); every local ref and every other-sheet qref holds.
    A formula with NO qualified ref to `sheet` returns byte-identical (never re-canonicalised), so
    untouched sibling formulas can't churn the persisted JSON. */
export declare function spliceSheetRefs(formula: string, sp: GridSplice, sheet: string): string;
