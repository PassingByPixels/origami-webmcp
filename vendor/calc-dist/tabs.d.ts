/** Whole-BLOCK bake for a multi-tab ledger (Slice: ledger tabs). A ledger block is one ACTIVE sheet
    plus zero or more inactive sibling sheets; a formula on any sheet may reference another by name via
    a qualified ref (`Sheet2!A1`, `'My Sheet'!A1:B5`). `recalcTabs` bakes ALL sheets of one block
    together, mirroring the archived cross-LEDGER `recalcDeck` (git 06a8393:packages/calc/src/deck.ts)
    — blocks→sheets, `@Name.x`→`Sheet!A1` — with one upgrade: RANGES work from day one.

      1. A sheet depends on every OTHER sheet it references by a qualified ref (a self-reference is NOT
         a cross-sheet dependency — it resolves live in-sheet, `self ≡ local`). Non-cyclic deps bake
         FIRST, so a dependent reads the source's freshly-baked values (stronger than "last-committed",
         and a DAG so it terminates).
      2. A cross-sheet CYCLE (A→B→A) can't be ordered — the participating qualified refs resolve to
         `#CYCLE!` (the engine's existing cycle idiom) and the bake never hangs.
      3. A ref to a MISSING sheet → `#NAME?`; a known sheet with a non-A1 suffix → `#REF!`; a valid A1
         that is empty / off the sibling's grid → blank (Excel).

    Unlike deck.ts's scalar `named`-map hand-in (which can only express single values), each sheet is
    baked by the SAME pure `recalc` with a `sheets` CONTEXT — the evaluator resolves qualified refs AND
    ranges natively against the sibling's baked rows. Authoring-layer only (like the rest of @origami/calc):
    the distributed viewer ships baked values and never runs this. */
/** One sheet of a ledger block to bake in whole-block context. `name` is what a qualified ref in
    ANOTHER sheet points at (empty = an unnamed single sheet that can't be referenced). */
export interface TabSheet {
    name: string;
    rows: string[][];
    /** A1 -> "=…". */
    formulas?: Record<string, string>;
    /** name -> "=…" (this sheet's exported @block.output; preserved, untouched by cross-sheet refs). */
    named?: Record<string, string>;
    /** A1 -> user name (reference-by-name), resolved to A1 before recalc, exactly like the editor. */
    cellNames?: Record<string, string>;
}
export interface TabResult {
    /** Baked display values, same shape as the input rows. */
    values: string[][];
}
/** Bake a whole ledger block of sheets, resolving qualified cross-sheet refs. Returns one result per
    input sheet, in input order. Pure + deterministic (inject `now` for TODAY()/NOW()). */
export declare function recalcTabs(sheets: TabSheet[], opts?: {
    now?: number;
}): TabResult[];
