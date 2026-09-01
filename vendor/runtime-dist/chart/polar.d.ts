import { type Layout } from './core.js';
export interface PolarBox {
    cx: number;
    cy: number;
    /** Outer radius of the gridded area (the spoke tips). */
    r: number;
}
/** Centre + radius of the largest circle that fits the plot box, less `pad` for the spoke labels
    that sit outside it. */
export declare function polarBox(w: number, lay: Layout, pad: number): PolarBox;
/** The angle of spoke (or sector centre) `i` of `n`, clockwise from 12 o'clock. */
export declare const spokeAngle: (i: number, n: number) => number;
/** Draw the polar frame: `rings` concentric gridlines with their tick values, one spoke per entry
    in `spokes`, and each spoke's name outside its tip. `web` draws the rings as polygons through
    the spokes (radar) rather than as circles (radial bar) — see the note above.

    `namePad` is how far PAST the tip the name sits. It is a parameter rather than a constant
    because a radar with `showValues` runs a column of vertex numbers up each spoke, ending just
    outside the tip — so the name has to start beyond the widest of them or the two meet at the
    ceiling, which is the collision chart/radar.ts's header describes. The caller owns that
    arithmetic (it is the only one holding the values) and must widen polarBox's `pad` to match, or
    the names it pushed out land outside the plot box. */
export declare function polarGrid(svg: SVGElement, box: PolarBox, spokes: string[], rings: number, ringLabel: (k: number) => string, web: boolean, namePad?: number): void;
