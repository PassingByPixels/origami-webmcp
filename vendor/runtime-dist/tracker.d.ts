import type { TrackerData } from '@origami/format';
export declare const TRACKER_STATUSES: readonly ["Open", "In progress", "Blocked", "Closed"];
/** Lenient normalize — junk degrades to defaults, never throws. */
export declare function normalizeTrackerData(raw: unknown): TrackerData;
/** Read + normalize the slide's data block. null = no/unparseable block. */
export declare function parseTrackerSlideData(slide: Element): TrackerData | null;
export interface TrackerRenderOpts {
    /** Wire the search / hide-completed filters (viewer + canvas). */
    interactive?: boolean;
    /** Studio canvas only: render the editing controls and commit through this. */
    edit?: {
        onCommit: (data: TrackerData) => void;
    };
}
/** Render the tracker into the slide's [data-tracker-mount]. Idempotent. */
export declare function renderTracker(slide: HTMLElement, data: TrackerData, opts?: TrackerRenderOpts): void;
/** Render an explicit failure notice — never a silent blank. */
export declare function renderTrackerError(slide: HTMLElement): void;
/** Sweep a mounted slide for tracker blocks and render each. Trackers are in-slide
    blocks — swept on every slide kind, the mirror of mountCharts. Idempotent. */
export declare function mountTrackers(slide: Element): void;
/** Print/static path: every row, no filter bar, no controls. */
export declare function finalizeTrackers(slide: Element): void;
