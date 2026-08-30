import type { GridData, GridToneRule } from '@origami/format';
/** Lenient normalize — junk degrades to a usable shape, never throws. */
export declare function normalizeGridData(raw: unknown): GridData;
export declare function parseGridSlideData(slide: Element): GridData | null;
/** Inline {bg, fg} for a cell, or null when no tone applies. (Exported so the inert
    `table` viewer can reuse the exact same tone logic without forking it.) */
export declare function toneStyle(rule: GridToneRule | undefined, value: string): {
    bg: string;
    fg: string;
} | null;
export interface GridRenderOpts {
    interactive?: boolean;
    edit?: {
        onCommit: (data: GridData) => void;
    };
}
/** Render the grid into the slide's [data-grid-mount]. Idempotent. */
export declare function renderGrid(slide: HTMLElement, data: GridData, opts?: GridRenderOpts): void;
export declare function renderGridError(slide: HTMLElement): void;
/** Sweep a mounted slide for grid blocks and render each. Grids are in-slide blocks —
    swept on every slide kind, the mirror of mountCharts. Idempotent. */
export declare function mountGrids(slide: Element): void;
/** Print path — render each grid statically (no live search bar). */
export declare function finalizeGrids(slide: Element): void;
