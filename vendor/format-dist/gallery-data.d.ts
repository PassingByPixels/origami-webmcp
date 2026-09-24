/** The gallery image block's inert JSON payload: <script type="application/json" data-odata="gallery">.
    Same carrier rules as chart/video/venn — a plain object, no executable content. */
import type { Violation } from './types.js';
export declare const GALLERY_STYLES: readonly ["single", "accordion", "dome", "drift", "compare", "carousel"];
export interface GalleryImage {
    /** Asset-table id the image resolves through (`<img data-oasset>`), never a URL. */
    asset?: string;
    alt?: string;
    /** Optional caption shown with the picture (under it in the flat looks, in the spotlight too). */
    caption?: string;
    /** Optional short tag shown as a pill on the carousel's front card (e.g. "ADVENTURE"). */
    tag?: string;
}
export interface GalleryData {
    /** Which look the block is rendered in. */
    style?: string;
    images?: GalleryImage[];
}
/** Validate a gallery data block. Shape-only: the runtime owns rendering, the asset table owns bytes. */
export declare function validateGalleryData(data: unknown): Violation[];
