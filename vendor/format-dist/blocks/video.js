import { validateVideoData, videoCapability } from '../video-data.js';
export const videoBlock = {
    key: 'video',
    name: 'Video (block)',
    schemaComment: [
        'an IN-SLIDE block, not a slide kind — any number may appear on any slide',
        'shape: <figure class="o-videofig anim"> holding ONE inert <script type="application/json" data-odata="video"> block,',
        '  then <div class="o-video" data-video-mount></div> (the runtime builds the player here), then an editable <figcaption>',
        'JSON shape: { provider: youtube|vimeo|loom|link, videoId, url: <the watch/share URL>, title }',
        'provider, videoId and url MUST agree (the id the player loads = the video the url shows); link → videoId ""',
        'prefer this block over a raw <iframe>/remote src: the runtime builds the player after the reader clicks play, it gets the embed trust badge, and the deck stays inactive — a raw iframe/remote URL just marks the deck active',
        'a youtube/vimeo/loom video also needs its capability in manifest.capabilities:',
        '  youtube → embed:www.youtube-nocookie.com | vimeo → embed:player.vimeo.com | loom → embed:www.loom.com',
        'no capability (or provider "link") → renders as a click-out link card',
        'when editing the JSON keep every "<" escaped as \\u003c — never emit a raw "<" inside the block',
    ],
    data: {
        placement: 'block',
        validate: validateVideoData,
        capability: (data) => videoCapability(data.provider),
    },
};
