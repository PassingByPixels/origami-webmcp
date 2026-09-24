export const GALLERY_STYLES = ['single', 'accordion', 'dome', 'drift', 'compare', 'carousel'];
/** Validate a gallery data block. Shape-only: the runtime owns rendering, the asset table owns bytes. */
export function validateGalleryData(data) {
    const v = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        v.push({ rule: 'gallery-data.shape', detail: 'gallery data must be an object' });
        return v;
    }
    const d = data;
    if (d.style !== undefined && (typeof d.style !== 'string' || !GALLERY_STYLES.includes(d.style))) {
        v.push({ rule: 'gallery-data.style', detail: `gallery style must be one of ${GALLERY_STYLES.join(', ')}` });
    }
    if (d.images === undefined)
        return v;
    if (!Array.isArray(d.images)) {
        v.push({ rule: 'gallery-data.images', detail: 'gallery images must be an array' });
        return v;
    }
    d.images.forEach((im, i) => {
        if (!im || typeof im !== 'object' || Array.isArray(im)) {
            v.push({ rule: 'gallery-data.image', detail: `gallery image ${i} must be an object` });
        }
        else if (typeof im.asset !== 'string' || im.asset.length === 0) {
            v.push({ rule: 'gallery-data.image', detail: `gallery image ${i} needs an asset id` });
        }
        else if (im.tag !== undefined && typeof im.tag !== 'string') {
            v.push({ rule: 'gallery-data.tag', detail: `gallery image ${i} tag must be a string` });
        }
    });
    return v;
}
