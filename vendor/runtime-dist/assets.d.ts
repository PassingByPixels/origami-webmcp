/** Images live in the deck's asset table by reference (F26): slide source
    carries `<img data-oasset="id">` with no src; mounted clones get the data
    URL injected here. One implementation for stage, print and Studio canvas.

    IT IS ALSO WHERE A PICTURE'S ALPHA IS FIRST KNOWABLE, and that is why the transparent-PNG shadow
    suppression hangs here rather than in a pass of its own: every surface calls this, on every deck
    image, at the moment the bytes are attached. markAlphaFigures re-asks itself on `load` for the
    ones that have not decoded yet. It is scoped to `figure.o-img` inside it, so a brand logo, a
    backdrop or a notes-card image is untouched. */
export declare function resolveAssetRefs(scope: ParentNode, assets: Record<string, string>): void;
/** Point the page's <link rel="icon"> at the deck's brand-logo asset, so the browser-tab
    favicon IS the user's logo (the crane until they set one) and tracks changes to it — the
    asset table is the source of truth, so changing the logo in Theme & Logo updates this on
    the next open. Creates the link if absent. A property assignment, so any data: URI is safe
    (no attribute-string escaping). No brand-logo → leaves the baked placeholder untouched. */
export declare function applyFavicon(assets: Record<string, string>): void;
/** Expose the deck's brand-logo asset as a CSS var so the inline Motif mark
    ([data-omotif] ::before/::after) and any CSS that wants the brand can paint it
    without injecting an <img>. Base64 data-URIs (the crane + sanitized SVGs) are
    url()-safe. Cleared when the deck has no logo, so the mark gracefully vanishes. */
export declare function applyBrandLogoVar(el: HTMLElement, assets: Record<string, string>): void;
export declare function fontFacesCss(assets: Record<string, string>): string;
