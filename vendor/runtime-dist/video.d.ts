import { type VideoData } from '@origami/format';
export interface VideoRenderOpts {
    /** Deck manifest capabilities — gate for building player iframes. */
    capabilities?: string[];
    /** Wire click-to-play / link-out. False for print and the Studio canvas. */
    interactive?: boolean;
    /** This page cannot send an HTTP Referer (file:// can't, ever). Providers
        with needsReferrer (YouTube, Error 153) downgrade to the link card. */
    referrerless?: boolean;
}
/** Lenient normalize — junk degrades to a link card, never throws. */
export declare function normalizeVideoData(raw: unknown): VideoData;
/** Render one video into its figure's [data-video-mount]. Idempotent. */
export declare function renderVideo(figure: Element, data: VideoData, opts?: VideoRenderOpts): void;
/** Parse one figure's data block. null = missing/unparseable. */
export declare function parseVideoFigureData(figure: Element): VideoData | null;
/** Sweep a mounted slide for video figures and render each. Videos are
    in-slide blocks, so this runs for every slide regardless of its kind. */
export declare function mountVideos(slide: Element, opts?: VideoRenderOpts): void;
