import type { Violation } from './types.js';
/**
 * Video BLOCK data — an in-slide block like chart: any number, on any slide.
 *
 *   <figure class="o-videofig">
 *     <script type="application/json" data-odata="video">{…}</script>
 *     <div class="o-video" data-video-mount></div>
 *     <figcaption>…</figcaption>
 *   </figure>
 *
 * THE SEAM: slide source never carries an <iframe> (content policy bans it) or
 * a remote src/href attribute. The watch URL lives in this JSON; the runtime
 * builds the player iframe at mount time, and only AFTER the reader clicks
 * play — the zero-network invariant holds until a deliberate user action.
 *
 * Embedding a provider requires the deck to declare it: manifest.capabilities
 * must contain `embed:<host>` for that provider's player origin (the F30
 * vocabulary's first real user). No capability → the runtime falls back to a
 * link card that opens the watch URL in a browser tab.
 */
export declare const VIDEO_PROVIDERS: readonly ["youtube", "vimeo", "loom"];
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number] | 'link';
export interface VideoData {
    provider: VideoProvider;
    /** Provider video id ('' for plain links). */
    videoId: string;
    /** The pasted watch/share URL — provenance, shown on link cards. */
    url: string;
    title: string;
}
interface ProviderSpec {
    /** Display name on the facade badge. */
    label: string;
    /** Player origin host — `embed:<host>` is the manifest capability token. */
    host: string;
    idRe: RegExp;
    embedUrl: (id: string) => string;
    /** Provider refuses playback without an HTTP Referer identifying the
        embedding page (YouTube enforcement, late 2025 — "Error 153"). file://
        pages can never send one, so referrerless contexts must fall back to
        the link card. Verified live 2026-06-10: same markup plays over http,
        153s from file://; sandbox/referrerpolicy are irrelevant. */
    needsReferrer: boolean;
}
/** Tokenless embed providers. Player origins are fixed here — deck data can
    never steer an iframe anywhere else. */
export declare const VIDEO_PROVIDER_SPECS: Record<(typeof VIDEO_PROVIDERS)[number], ProviderSpec>;
/** Manifest capability token a provider needs; null for plain links. */
export declare function videoCapability(provider: VideoProvider): string | null;
/** Player iframe URL; null when the data can't embed (links, bad ids). */
export declare function videoEmbedUrl(data: VideoData): string | null;
/**
 * Detect provider + video id from a pasted URL. Unrecognised but well-formed
 * https URLs become provider 'link' (the click-out card); anything that isn't
 * an https URL returns null.
 */
export declare function parseVideoUrl(raw: string): Pick<VideoData, 'provider' | 'videoId' | 'url'> | null;
/** Strict shape check for one video data block. REJECT, never repair. */
export declare function validateVideoData(data: unknown): Violation[];
/** Serialize video data for embedding — "<" escaped (the carrier invariant). */
export declare function videoDataJson(data: VideoData): string;
export {};
