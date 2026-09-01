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
export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'loom'];
/** Tokenless embed providers. Player origins are fixed here — deck data can
    never steer an iframe anywhere else. */
export const VIDEO_PROVIDER_SPECS = {
    youtube: {
        label: 'YouTube',
        host: 'www.youtube-nocookie.com',
        idRe: /^[A-Za-z0-9_-]{11}$/,
        embedUrl: (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
        needsReferrer: true,
    },
    vimeo: {
        label: 'Vimeo',
        host: 'player.vimeo.com',
        idRe: /^\d{1,12}$/,
        embedUrl: (id) => `https://player.vimeo.com/video/${id}?autoplay=1`,
        needsReferrer: false, // verified live from file:// 2026-06-10
    },
    loom: {
        label: 'Loom',
        host: 'www.loom.com',
        idRe: /^[a-f0-9]{32}$/,
        embedUrl: (id) => `https://www.loom.com/embed/${id}`,
        needsReferrer: false, // not live-verified yet — flip if a real share 153s
    },
};
/** Manifest capability token a provider needs; null for plain links. */
export function videoCapability(provider) {
    return provider === 'link' ? null : `embed:${VIDEO_PROVIDER_SPECS[provider].host}`;
}
/** Player iframe URL; null when the data can't embed (links, bad ids). */
export function videoEmbedUrl(data) {
    if (data.provider === 'link')
        return null;
    const spec = VIDEO_PROVIDER_SPECS[data.provider];
    if (!spec || !spec.idRe.test(data.videoId))
        return null;
    return spec.embedUrl(data.videoId);
}
const YT_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/* String-level URL shape (this package assumes no platform globals — no URL).
   Deliberately strict: https only, plain host (no userinfo/port — none of the
   providers use them, and rejecting the exotic is the safe default here). */
const URL_SHAPE = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#\S*)?$/i;
/**
 * Detect provider + video id from a pasted URL. Unrecognised but well-formed
 * https URLs become provider 'link' (the click-out card); anything that isn't
 * an https URL returns null.
 */
export function parseVideoUrl(raw) {
    const url = raw.trim();
    const m = URL_SHAPE.exec(url);
    if (!m)
        return null;
    const host = m[1].toLowerCase();
    const path = m[2] ?? '/';
    const query = m[3] ?? '';
    if (host === 'youtu.be') {
        const id = path.slice(1).split('/')[0];
        if (YT_ID.test(id))
            return { provider: 'youtube', videoId: id, url };
    }
    if (YT_HOSTS.has(host) || host === 'www.youtube-nocookie.com') {
        const v = /(?:^|&)v=([A-Za-z0-9_-]{11})(?:&|$)/.exec(query)?.[1];
        if (v)
            return { provider: 'youtube', videoId: v, url };
        const p = path.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
        if (p)
            return { provider: 'youtube', videoId: p[1], url };
    }
    if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
        const p = path.match(/^\/(?:video\/)?(\d{1,12})(?:\/|$)/);
        if (p)
            return { provider: 'vimeo', videoId: p[1], url };
    }
    if (host === 'www.loom.com' || host === 'loom.com') {
        const p = path.match(/^\/(?:share|embed)\/([a-f0-9]{32})(?:\/|$)/);
        if (p)
            return { provider: 'loom', videoId: p[1], url };
    }
    return { provider: 'link', videoId: '', url };
}
const URL_MAX = 2000;
const TITLE_MAX = 200;
/** Strict shape check for one video data block. REJECT, never repair. */
export function validateVideoData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `video.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'video data must be a JSON object');
        return v;
    }
    const d = data;
    const provider = d.provider;
    if (provider !== 'link' && !VIDEO_PROVIDERS.includes(provider)) {
        bad('provider', `provider must be one of ${VIDEO_PROVIDERS.join('|')}|link`);
        return v;
    }
    if (typeof d.url !== 'string' || d.url.length > URL_MAX) {
        bad('url', `url must be a string (max ${URL_MAX})`);
        return v;
    }
    if (typeof d.videoId !== 'string')
        bad('videoId', 'videoId must be a string');
    if (typeof d.title !== 'string' || d.title.length > TITLE_MAX) {
        bad('title', `title must be a string (max ${TITLE_MAX})`);
    }
    if (provider === 'link') {
        if (d.videoId !== '')
            bad('videoId', 'a plain link carries no videoId — use ""');
        if (d.url !== '' && parseVideoUrl(d.url) === null)
            bad('url', 'url must be https (or "" while unset)');
        return v;
    }
    // Embeddable providers: id pattern + provider/url agreement. The url is what
    // readers see and the id is what the iframe plays — they MUST be the same
    // video, or a deck could show one link and play another.
    const spec = VIDEO_PROVIDER_SPECS[provider];
    if (typeof d.videoId === 'string' && !spec.idRe.test(d.videoId)) {
        bad('videoId', `not a valid ${spec.label} video id`);
    }
    const parsed = parseVideoUrl(d.url);
    if (!parsed || parsed.provider !== provider || parsed.videoId !== d.videoId) {
        bad('url', `url does not resolve to ${spec.label} video "${String(d.videoId)}" — provider, videoId and url must agree`);
    }
    return v;
}
/** Serialize video data for embedding — "<" escaped (the carrier invariant). */
export function videoDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
