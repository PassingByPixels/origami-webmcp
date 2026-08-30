/** Slopes at each knot: the classic Fritsch–Carlson filter — zero the tangent at a local extremum,
    then shrink any pair that would leave the monotonicity circle of radius 3. `xs` need not be
    evenly spaced. Fewer than 2 points has no slope to speak of, so every tangent is 0. */
export declare function monotoneTangents(xs: number[], ys: number[]): number[];
/** Path commands running LEFT to RIGHT along the curve, from knot 0. The caller writes the `M`. */
export declare function curveForward(xs: number[], ys: number[], m: number[]): string;
/** The same curve travelled RIGHT to LEFT — a band's lower edge, closing the polygon. A bezier
    reverses exactly by swapping its two control points, so the returned path retraces the forward
    one to the last decimal instead of approximating it back. */
export declare function curveBack(xs: number[], ys: number[], m: number[]): string;
/** `M x y` for a curve's first knot, at the same rounding as its segments. */
export declare const curveStart: (x: number, y: number) => string;
/** `L x y` — the straight end cap that joins a band's two edges. */
export declare const curveLine: (x: number, y: number) => string;
