import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
/** Hex columns across the plot when the author pins none. */
export declare const DEFAULT_HEX_BINS = 20;
/** Fractional axial (q, r) → the axial coordinates of the NEAREST hex centre, via cube rounding.
    Exported for the boundary tests — see the header for why a naive round is wrong. */
export declare function hexRound(q: number, r: number): [number, number];
/** Pixel → fractional axial, for a pointy-top lattice of circumradius `R` anchored at the origin. */
export declare const hexAxial: (px: number, py: number, R: number) => [number, number];
/** Axial → the pixel centre of that cell — the exact inverse of `hexAxial` on whole coordinates. */
export declare const hexCentre: (q: number, r: number, R: number) => [number, number];
export interface HexCell {
    q: number;
    r: number;
    count: number;
}
/** Aggregate parallel pixel arrays into hex cells, sorted by (r, q) so the output order depends on
    the LATTICE and not on the order the points arrived in. Exported for the tiling/count tests. */
export declare function binPoints(pxs: number[], pys: number[], R: number): HexCell[];
export declare function renderHexbin(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
