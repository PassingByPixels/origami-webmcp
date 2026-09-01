import type { GanttCard, GanttData } from '@origami/format';
export declare const GANTT_LANE_PADDING = 8;
export declare const GANTT_CARD_HEIGHT = 36;
export declare const GANTT_CARD_VSPACING = 6;
export declare const GANTT_LABEL_WIDTH = 230;
export declare const GANTT_PX_PER_WEEK = 80;
export declare const GANTT_PX_MIN = 24;
/** Raised well past the old 220 so zooming in reaches day- and hour-grain axes.
    A day is ppw/7 and an hour ppw/168, so legible HOUR labels need a very large
    ppw — feasible once the span is a week/day (the timeline stays a sane width). */
export declare const GANTT_PX_MAX = 9000;
/** Card bars sit 2px in from the week line; widths lose 4px of breathing room. */
export declare const GANTT_CARD_INSET = 2;
export declare const GANTT_CARD_GAP = 4;
export declare const GANTT_CARD_MIN_PX = 36;
/** 0-based week offset — number (free-dragged), "W#", "M#" (4 weeks/month) or numeric string. */
export declare function ganttWeekIndex(v: string | number): number;
export declare function ganttLensColor(data: GanttData, name: string): string;
/** Lenient normalize — junk degrades to defaults, never throws. */
export declare function normalizeGanttData(raw: unknown): GanttData;
/** Read + normalize the slide's data block. null = no/unparseable block. */
export declare function parseGanttSlideData(slide: Element): GanttData | null;
/** Greedy row packing per lane — Coty's algorithm verbatim. Rows are computed
    into a local map, never written onto the data (transient fields must not
    exist on the model — F7). */
export declare function packLane(cards: GanttCard[]): {
    rows: Map<string, number>;
    numRows: number;
};
export type GanttAxisUnit = 'month' | 'week' | 'day' | 'hour';
/** The denomination the axis ticks switch to at the current pixel density — the
    same scale shows months when zoomed out and days/hours when zoomed in. */
export declare function ganttAxisUnit(pxPerWeek: number): GanttAxisUnit;
export interface GanttRenderOpts {
    /** Horizontal scale. Ignored when `fitPx` is set. */
    pxPerWeek?: number;
    /** Fit the whole timeline into this track width (print / static contexts). */
    fitPx?: number;
    /** Wire the lens chips as live filters (viewer). Static contexts leave them inert. */
    interactive?: boolean;
    /** Initial lens filter. */
    activeLens?: string;
}
/** Render the roadmap into the slide's [data-gantt-mount]. Idempotent — clears
    and rebuilds, so editors can call it after every data change. */
export declare function renderGantt(slide: HTMLElement, data: GanttData, opts?: GanttRenderOpts): void;
/** Render an explicit failure notice — a broken data block must be visible,
    never a silent blank. */
export declare function renderGanttError(slide: HTMLElement): void;
/** Sweep a mounted slide for roadmap blocks and render each into its own container. Roadmaps are
    in-slide blocks now — swept on every slide kind, the mirror of mountTables. Idempotent. */
export declare function mountGantts(slide: Element): void;
/** Print/static sweep: every roadmap visible, timeline fitted to the fixed page. */
export declare function finalizeGantts(slide: Element): void;
