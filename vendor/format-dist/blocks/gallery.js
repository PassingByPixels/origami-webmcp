import { validateGalleryData } from '../gallery-data.js';
export const galleryBlock = {
    key: 'gallery',
    name: 'Gallery',
    schemaComment: [
        'a gallery - an IN-SLIDE block, insertable on any fold; lays its pictures out six ways',
        'shape: <figure class="o-galleryfig anim"> holding ONE inert <script type="application/json" data-odata="gallery"> block,',
        '  then <div data-gallery-mount></div> (the runtime renders the chosen look here)',
        'JSON shape: { style: "single" | "accordion" | "dome" | "drift" | "compare" | "carousel", images: [{ asset: string, alt?: string, caption?: string, tag?: string }, ...] }',
        'each image addresses the deck ASSET TABLE by id (never a URL); the runtime emits <img data-oasset="id">',
        'when editing the JSON keep every "<" escaped as \\u003c, never emit a raw "<" inside the block',
    ],
    data: { placement: 'block', validate: validateGalleryData },
};
