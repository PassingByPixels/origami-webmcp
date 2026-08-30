import { parseDeck } from './parse.js';
import { FormatError } from './types.js';
/** Apply non-overlapping edits to text by offset, splicing from the end backwards. */
export function spliceText(text, edits) {
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end)
            throw new FormatError('overlapping edits');
    }
    let out = text;
    for (let i = sorted.length - 1; i >= 0; i--) {
        const e = sorted[i];
        out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }
    return out;
}
/** Normalize any EOLs in inserted content to the deck's convention. */
export function normalizeEol(content, eol) {
    const lf = content.replace(/\r\n/g, '\n');
    return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}
/** Replace one slide's inner content. Returns a freshly parsed deck. */
export function replaceSlideInner(deck, slideId, newInner) {
    const s = deck.slideById.get(slideId);
    if (!s)
        throw new FormatError(`unknown slide "${slideId}"`);
    const out = spliceText(deck.text, [
        { start: s.inner.start, end: s.inner.end, replacement: normalizeEol(newInner, deck.eol) },
    ]);
    return parseDeck(out);
}
/** Serialize a manifest object into the manifest script region. Returns a freshly parsed deck.
    `<` is escaped as < so no string value can terminate the script tag or fake a
    template boundary — same parsed JSON, inert source text. */
export function replaceManifest(deck, manifest) {
    const safeJson = JSON.stringify(manifest, null, 2).replace(/</g, '\\u003c');
    const json = normalizeEol('\n' + safeJson + '\n', deck.eol);
    const out = spliceText(deck.text, [
        { start: deck.manifestRegion.start, end: deck.manifestRegion.end, replacement: json },
    ]);
    return parseDeck(out);
}
/** Serialize the asset table into the assets script block. Inserts the block
    (after the last slide template) when the deck doesn't have one yet; replacing
    an absent block with an empty table is a no-op. Same `<` escaping as the
    manifest — no asset value can terminate the script tag. */
export function replaceAssets(deck, assets) {
    const safeJson = JSON.stringify(assets, null, 2).replace(/</g, '\\u003c');
    const json = normalizeEol('\n' + safeJson + '\n', deck.eol);
    if (deck.assetsRegion) {
        const out = spliceText(deck.text, [
            { start: deck.assetsRegion.start, end: deck.assetsRegion.end, replacement: json },
        ]);
        return parseDeck(out);
    }
    if (Object.keys(assets).length === 0)
        return deck;
    const at = deck.slides.length > 0
        ? deck.slides[deck.slides.length - 1].element.end
        : deck.manifestRegion.end + '</script>'.length;
    const block = normalizeEol('\n\n', deck.eol) +
        '<script type="application/json" id="origami-assets">' +
        json +
        '</script>';
    return parseDeck(spliceText(deck.text, [{ start: at, end: at, replacement: block }]));
}
/** Remove whole slide templates (plus their trailing newline) by id. Returns a fresh parse. */
export function removeSlides(deck, slideIds) {
    const edits = slideIds.map((id) => {
        const s = deck.slideById.get(id);
        if (!s)
            throw new FormatError(`unknown slide "${id}"`);
        let end = s.element.end;
        if (deck.text.startsWith(deck.eol, end))
            end += deck.eol.length;
        return { start: s.element.start, end, replacement: '' };
    });
    return parseDeck(spliceText(deck.text, edits));
}
