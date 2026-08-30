import type { ChartData } from '@origami/format';
export declare const SVG_NS = "http://www.w3.org/2000/svg";
export interface Layout {
    mL: number;
    mR: number;
    mT: number;
    mB: number;
    chartH: number;
    plotH: number;
    horizontal: boolean;
}
export declare const svgEl: (tag: string, attrs: Record<string, string | number>, parent: Element) => SVGElement;
/** The series/slice palette. It lives HERE rather than in chart.ts so the per-capability modules
    can read it without importing chart.ts back and creating a cycle — the same reason svgEl and
    niceMax moved. chart.ts re-exports it, so every existing consumer is untouched. */
export declare const CHART_PALETTE: string[];
/** Colour for CATEGORY i: an explicit per-category colour when set, else the palette. A PURE MOVE
    out of chart.ts (identical body) — the pie owned it, and the 0.4.1 wave-3 charts that colour by
    category rather than by series (11 Funnel, 22 Radial bar) read it from their own modules, which
    cannot import chart.ts back without a cycle. chart.ts re-exports it, so every consumer of the
    public API is untouched. */
export declare function sliceColor(data: ChartData, i: number): string;
/** A palette colour guaranteed to DIFFER from `base`, preferring index `i`.

    Three of the wave-2 pictures need a second (or third) colour that the schema never supplies:
    a pareto carries exactly one series but draws a bar AND a cumulative line, and a waterfall
    carries one series but draws three step kinds. Deriving the extra colours from the author's own
    colour — instead of pinning a constant — keeps a deck that recolours its series from ending up
    with a line the same colour as its bars. Pure: same base and index give the same colour in the
    viewer, in the print clone and on the Studio canvas, on every render. */
export declare function altColor(base: string, i: number): string;
/** Category names along the bottom of a categorical plot, one per column centre. A PURE MOVE out
    of chart.ts — bar, line, stream, waterfall and box plot all label the same way. */
export declare function xLabels(svg: SVGElement, labels: string[], plotW: number, lay: Layout): void;
/** Estimated width of `text` at `fontSize`, in viewBox units. Iterates by CODE POINT, so a
    surrogate pair counts once and a truncation built on it never splits one. */
export declare function estTextWidth(text: string, fontSize: number): number;
/** The longest PREFIX of `text` whose estimated width fits `avail`, cut on a code-point boundary.
    Returns '' when not even the first character fits — the caller decides what to do about that. */
export declare function fitPrefix(text: string, fontSize: number, avail: number): string;
/** A pinned `yMax` applied to a data maximum under the EXTEND-ONLY rule: a pin may only PUSH the
    axis out, never truncate it below the data. Clipping would draw two different values at the same
    place, against an axis that says they are the same — which is the one failure a reader of a
    printed deck cannot recover from. The rule is stacked bars' and scatter's from 0.4.0 and
    chart/radial.ts's and chart/funnel.ts's from wave 3; this is it named once, for the charts whose
    axis can run NEGATIVE, where `Math.max(hi, yMax ?? 0)` would wrongly drag the ceiling up to zero.
    Absent or null reads nothing, so an unpinned chart is byte-identical. */
export declare const extendMax: (hi: number, yMax: number | null | undefined) => number;
/** A power-of-two factor that makes `count` values of at most `max` safe to ADD UP.

    A treemap's subtree total and a sankey's node throughput are both SUMS, and the sum of two
    finite doubles near MAX_VALUE is Infinity. Every ratio then taken against that total is
    0/Infinity = 0 or Infinity/Infinity = NaN, so the picture comes out blank, or painted with
    `NaN` coordinates, or — worst — drawn as one NaN rectangle that erases the healthy branches
    beside it. One root cause, three different-looking wrecks.

    THE CURE IS A PRE-SCALE, NEVER A CLAMP. Both layouts consume RATIOS and nothing else, so
    dividing every value by one factor before the fold moves no mark by a single unit while making
    the sum representable. Clamping the total instead would change the ratios — which is the one
    thing an area encoding or a height encoding may not do, since the ratio IS the claim.

    THE FACTOR IS A POWER OF TWO, so the scaling is EXACT: `v * 2^-k * 2^k` is `v` to the bit for
    every normal double. That is what lets the caption print the number the author typed rather
    than a round trip through it.

    THE BOUND. `count` is the number of terms that can reach one sum — a treemap's node count, a
    sankey's flow count doubled because every flow lands in one inflow sum and one outflow sum.
    Requiring `count * max * s <= MAX_VALUE / 4` keeps every partial sum finite with two doublings
    to spare, which also covers the round-to-nearest step that can carry a sum sitting just under
    MAX_VALUE over it. Below the bound the factor is exactly 1, so every picture that never
    overflowed is byte-identical. */
export declare function sumScale(max: number, count: number): number;
/** Round up to a friendly axis maximum (1/2/5 × 10^n). */
export declare function niceMax(v: number): number;
/** X / Y axis titles (every axed chart — a pie has no axes). */
export declare function axisTitles(svg: SVGElement, data: ChartData, plotW: number, lay: Layout): void;
