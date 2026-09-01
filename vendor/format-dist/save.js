import { replaceManifest, replaceSlideInner } from './splice.js';
/**
 * The canonical save: apply slide content changes, then stamp manifest.modified.
 * The byte-diff of the result vs the input is confined to the edited slide inner
 * regions plus the manifest region — the P1 round-trip invariant.
 */
export function saveDeck(deck, slideEdits, opts) {
    let d = deck;
    for (const [slideId, inner] of Object.entries(slideEdits)) {
        d = replaceSlideInner(d, slideId, inner);
    }
    const manifest = { ...d.manifest, modified: opts.now };
    return replaceManifest(d, manifest);
}
