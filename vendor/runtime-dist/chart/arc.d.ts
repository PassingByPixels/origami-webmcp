/** 12 o'clock — where every ring in this codebase starts. */
export declare const TOP: number;
/** One full turn, in this module's radians. */
export declare const FULL_TURN: number;
export interface Pt {
    x: number;
    y: number;
}
/** The point at radius `r`, angle `a`, around (cx, cy). */
export declare function polarPt(cx: number, cy: number, r: number, a: number): Pt;
/** A wedge (`rIn` = 0) or a ring segment (`rIn` > 0) from `a0` to `a1`, as a path `d`.
    '' when there is nothing to draw — a zero sweep or a zero outer radius. */
export declare function arcPath(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): string;
/** The outer radius at which a wedge's AREA is `frac` of the full wedge's area, between `rIn` and
    `rOut`. This is the honest scale for value-as-radius (23 Nightingale): a wedge's area grows with
    the SQUARE of its radius, so scaling radius linearly makes a doubled value look quadrupled.
    With rIn = 0 it is exactly rOut × √frac — a 4× value gives a 2× radius. */
export declare function areaRadius(frac: number, rIn: number, rOut: number): number;
