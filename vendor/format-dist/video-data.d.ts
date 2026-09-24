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
 *
 * A LOCAL FILE is the other source: provider 'local' carries a path RELATIVE to
 * the deck (url = "media/intro.mp4", videoId = ""), and the runtime builds a
 * native <video> from it — no provider, no iframe, no `embed:` capability. The
 * path must stay relative and inside the deck folder: validation rejects a
 * scheme, a leading "/" or "//", a backslash, a ".." segment, and any extension
 * outside mp4|m4v|webm|ogv|mov, so a deck can never smuggle a remote URL through
 * the local field.
 */
export declare const VIDEO_PROVIDERS: readonly ["youtube", "vimeo", "loom"];
/** 'local' is NOT in VIDEO_PROVIDERS: that array drives the embed specs and the
    `embed:<host>` capabilities, and a local file is neither. */
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number] | 'link' | 'local';
export interface VideoData {
    provider: VideoProvider;
    /** Provider video id ('' for plain links and local files). */
    videoId: string;
    /** The pasted watch/share URL, or — for 'local' — the deck-relative path. */
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
/** Manifest capability token a provider needs; null for plain links and local
    files (neither is a provider embed, so neither grants a capability). */
export declare function videoCapability(provider: VideoProvider): string | null;
/** Player iframe URL; null when the data can't embed (links, local files, bad ids). */
export declare function videoEmbedUrl(data: VideoData): string | null;
/**
 * Detect provider + video id from a pasted URL. Unrecognised but well-formed
 * https URLs become provider 'link' (the click-out card); anything that isn't
 * an https URL returns null.
 */
export declare function parseVideoUrl(raw: string): Pick<VideoData, 'provider' | 'videoId' | 'url'> | null;
/**
 * Safety shape for a local video path: non-empty, length-capped, relative to the
 * deck, no scheme, no leading "/" or "//", no backslashes, no ".." segment.
 * Shared with the runtime's render-time re-check — deck data is untrusted at
 * mount, and a path that fails this must never become a src.
 */
export declare function localVideoPathIsSafe(url: string): boolean;
/**
 * The distinct deck-relative paths a deck (or a slide) references with provider
 * 'local', in document order. The sandboxed Present stage and editor canvas cannot
 * resolve such a path themselves, so their parent page uses this to find the files
 * to read and hand over. Pure string work — no DOM, no deck model. A malformed data
 * block is skipped; the runtime surfaces its own error when it mounts that block.
 */
export declare function collectLocalVideoRefs(html: string): string[];
/** Strict shape check for one video data block. REJECT, never repair. */
export declare function validateVideoData(data: unknown): Violation[];
/** Serialize video data for embedding — "<" escaped (the carrier invariant). */
export declare function videoDataJson(data: VideoData): string;
export {};
