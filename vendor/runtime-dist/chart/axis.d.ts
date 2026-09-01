import { type Layout } from './core.js';
export interface NumScale {
    /** Nice lower bound (≤ the data minimum). */
    min: number;
    /** Nice upper bound (≥ the data maximum). */
    max: number;
    /** Tick interval. */
    step: number;
    /** Value → pixel along this axis. */
    at(v: number): number;
}
/** Widest bound niceRange will accept, so `hi - lo` can never overflow to Infinity. Shared with
    the stack accumulator (chart/stack.ts), which can overflow the same way by SUMMING. */
export declare const SPAN_CAP: number;
/** Widen [lo,hi] out to round bounds on a common step. A range that crosses zero keeps 0 ON a
    tick (both bounds are whole multiples of the step), so the axis reads honestly. */
export declare function niceRange(lo: number, hi: number, div?: number): {
    min: number;
    max: number;
    step: number;
};
/** Build a scale over [lo,hi] mapping onto pixels [p0,p1] (pass p0 > p1 for a y-axis). */
export declare function numScale(lo: number, hi: number, p0: number, p1: number, div?: number): NumScale;
/** Horizontal gridlines + value ticks up the LEFT of the plot box. Split out of numericAxes
    because the wave-2 categorical charts — waterfall and box plot — need exactly this half: their
    x is a category, but their y crosses zero and so cannot use chart.ts's zero-based `axes`. */
export declare function valueAxisY(svg: SVGElement, sy: NumScale, lay: Layout, plotW: number): void;
/** Vertical gridlines + numeric ticks along the BOTTOM (continuous x only). */
export declare function valueAxisX(svg: SVGElement, sx: NumScale, lay: Layout): void;
/** Gridlines + numeric ticks for both axes inside `lay`'s plot box. */
export declare function numericAxes(svg: SVGElement, sx: NumScale, sy: NumScale, lay: Layout, plotW: number): void;
export declare function rightValueAxis(svg: SVGElement, lay: Layout, plotW: number, min: number, max: number, color: string, suffix?: string, div?: number): (v: number) => number;
