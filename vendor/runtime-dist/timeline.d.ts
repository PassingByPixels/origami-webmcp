import { type TimelineData } from '@origami/format';
/** Lenient normalization — never throws. Absent orientation is the default
    (vertical) and stays absent, so a normalized object serializes back with no
    default written out (the "defaults are absence" idiom). */
export declare function normalizeTimelineData(raw: unknown): TimelineData;
/** Render one timeline into its container's [data-timeline-mount]. Idempotent —
    clears the mount and rebuilds, so a re-render never doubles the events. */
export declare function renderTimeline(figure: HTMLElement, data: TimelineData): void;
export declare function mountTimelines(slide: Element): void;
/** Print path: a static re-render of the same rail + cards. */
export declare const finalizeTimelines: typeof mountTimelines;
