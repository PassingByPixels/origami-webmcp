/**
 * DELIBERATE GAP — table formula baking is NOT performed in the browser.
 *
 * The stdio server calls bakeTableInner(inner, Date.now()) on every `table` chunk write, which
 * runs @origami/calc's `recalc` to turn formulas into values. `@origami/calc` is NOT in
 * vendor/ — only @origami/format and @origami/runtime were vendored — so there is no calc
 * engine to call and reimplementing one would be inventing behaviour, not porting it.
 *
 * Consequence: a `table` chunk written through this app keeps whatever `rows` the author
 * supplied; its `formulas` are not recomputed. The deck is still VALID (validateKindData does
 * not require baked rows) and the Studio re-bakes when it opens the Fold. Anything that must
 * be born baked has to go through the stdio server or the Studio until @origami/calc is
 * vendored — see README "Known gaps".
 */
export function bakeTableInner(inner: string, _now: number): string {
  return inner;
}

/** True when this build cannot bake — surfaced in tool results so a caller is never
    silently told a table was baked when it was not. */
export const BAKING_AVAILABLE = false;
