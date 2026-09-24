import { type VideoData } from '@origami/format';
export interface VideoRenderOpts {
    /** Deck manifest capabilities — gate for building player iframes. */
    capabilities?: string[];
    /** Wire click-to-play / link-out. False for print and the Studio canvas. */
    interactive?: boolean;
    /** This page cannot send an HTTP Referer (file:// can't, ever). Providers
        with needsReferrer (YouTube, Error 153) downgrade to the link card. */
    referrerless?: boolean;
    /** Can this surface load a deck-relative local file? The Studio canvas cannot:
        its page origin is chrome-extension://, so "media/x.mp4" resolves nowhere.
        Pass false there to get the honest placeholder instead of a dead player. */
    localPlayback?: boolean;
}
/** Lenient normalize — junk degrades to a link card, never throws. */
export declare function normalizeVideoData(raw: unknown): VideoData;
/** A host-supplied local-file payload: the file's bytes (play it) or the reason it
    could not be read (show the placeholder). */
export type LocalVideoPayload = ArrayBuffer | string;
/** Apply host-supplied local-file payloads (see LocalVideoPayload). Called by the
    sandboxed frame when the parent page hands the bytes over. Remembers them so a
    later mount of the same ref plays too. Idempotent. */
export declare function applyLocalVideoBytes(map: Record<string, LocalVideoPayload>, root?: ParentNode): void;
/** Render one video into its figure's [data-video-mount]. Idempotent. */
export declare function renderVideo(figure: Element, data: VideoData, opts?: VideoRenderOpts): void;
/** Parse one figure's data block. null = missing/unparseable. */
export declare function parseVideoFigureData(figure: Element): VideoData | null;
/** Sweep a mounted slide for video figures and render each. Videos are
    in-slide blocks, so this runs for every slide regardless of its kind. */
export declare function mountVideos(slide: Element, opts?: VideoRenderOpts): void;
