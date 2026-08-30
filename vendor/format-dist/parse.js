import { FormatError } from './types.js';
const MANIFEST_OPEN = /<script\s+type="application\/json"\s+id="origami-manifest"\s*>/;
const ASSETS_OPEN = /<script\s+type="application\/json"\s+id="origami-assets"\s*>/;
const TEMPLATE_OPEN = '<template';
const TEMPLATE_CLOSE = '</template>';
/** Parse a deck by string offsets. Never builds a DOM; offsets index the original text. */
export function parseDeck(text) {
    if (!/^<!DOCTYPE html>/i.test(text.trimStart())) {
        throw new FormatError('not an HTML document');
    }
    if (!/<html[^>]*\bdata-origami="[^"]+"/.test(text)) {
        throw new FormatError('missing data-origami attribute on <html>');
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const mOpen = MANIFEST_OPEN.exec(text);
    if (!mOpen)
        throw new FormatError('missing origami-manifest script');
    const mStart = mOpen.index + mOpen[0].length;
    const mEnd = text.indexOf('</script>', mStart);
    if (mEnd === -1)
        throw new FormatError('unterminated manifest script');
    let manifest;
    try {
        manifest = JSON.parse(text.slice(mStart, mEnd));
    }
    catch (e) {
        throw new FormatError('manifest is not valid JSON: ' + e.message);
    }
    let assets = {};
    let assetsRegion = null;
    const aOpen = ASSETS_OPEN.exec(text);
    if (aOpen) {
        const aStart = aOpen.index + aOpen[0].length;
        const aEnd = text.indexOf('</script>', aStart);
        if (aEnd === -1)
            throw new FormatError('unterminated origami-assets script');
        let parsed;
        try {
            parsed = JSON.parse(text.slice(aStart, aEnd));
        }
        catch (e) {
            throw new FormatError('origami-assets is not valid JSON: ' + e.message);
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new FormatError('origami-assets must be a JSON object');
        }
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v !== 'string')
                throw new FormatError(`origami-assets: asset "${k}" is not a string`);
        }
        assets = parsed;
        assetsRegion = { start: aStart, end: aEnd };
    }
    // Script blocks can legitimately contain template-looking string literals —
    // the embedded runtime bundles this very parser — so template scanning must
    // never look inside them.
    const scriptRegions = [];
    let sPos = 0;
    for (;;) {
        const sStart = text.indexOf('<script', sPos);
        if (sStart === -1)
            break;
        const sOpen = text.indexOf('>', sStart);
        if (sOpen === -1)
            break;
        const sClose = text.indexOf('</script>', sOpen);
        if (sClose === -1)
            break;
        const end = sClose + '</script>'.length;
        scriptRegions.push({ start: sStart, end });
        sPos = end;
    }
    const inScript = (i) => scriptRegions.find((r) => i >= r.start && i < r.end);
    const slides = [];
    let pos = 0;
    for (;;) {
        const tStart = text.indexOf(TEMPLATE_OPEN, pos);
        if (tStart === -1)
            break;
        const region = inScript(tStart);
        if (region) {
            pos = region.end;
            continue;
        }
        const tagEnd = findTagEnd(text, tStart);
        const tag = text.slice(tStart, tagEnd + 1);
        const idMatch = /\bdata-origami-slide="([^"]*)"/.exec(tag);
        if (!idMatch) {
            // a non-slide template (e.g. brand asset) — skip past its close
            const skipTo = text.indexOf(TEMPLATE_CLOSE, tagEnd);
            if (skipTo === -1)
                throw new FormatError('unterminated <template>');
            pos = skipTo + TEMPLATE_CLOSE.length;
            continue;
        }
        const id = idMatch[1];
        const kindMatch = /\bdata-kind="([^"]*)"/.exec(tag);
        if (!kindMatch)
            throw new FormatError(`slide "${id}": missing data-kind`);
        const innerStart = tagEnd + 1;
        const innerEnd = text.indexOf(TEMPLATE_CLOSE, innerStart);
        if (innerEnd === -1)
            throw new FormatError(`slide "${id}": unterminated template`);
        const nested = text.indexOf(TEMPLATE_OPEN, innerStart);
        if (nested !== -1 && nested < innerEnd) {
            throw new FormatError(`slide "${id}": nested <template> is not allowed`);
        }
        slides.push({
            id,
            kind: kindMatch[1],
            element: { start: tStart, end: innerEnd + TEMPLATE_CLOSE.length },
            inner: { start: innerStart, end: innerEnd },
        });
        pos = innerEnd + TEMPLATE_CLOSE.length;
    }
    const slideById = new Map();
    for (const s of slides) {
        if (slideById.has(s.id))
            throw new FormatError(`duplicate slide id "${s.id}"`);
        slideById.set(s.id, s);
    }
    return {
        text,
        eol,
        manifest,
        manifestRegion: { start: mStart, end: mEnd },
        slides,
        slideById,
        assets,
        assetsRegion,
    };
}
/** Index of the '>' closing an open tag, respecting quoted attribute values. */
function findTagEnd(text, tagStart) {
    let i = tagStart;
    let quote = null;
    while (i < text.length) {
        const c = text[i];
        if (quote) {
            if (c === quote)
                quote = null;
        }
        else if (c === '"' || c === "'") {
            quote = c;
        }
        else if (c === '>') {
            return i;
        }
        i++;
    }
    throw new FormatError('unterminated tag');
}
export function slideInner(deck, slideId) {
    const s = deck.slideById.get(slideId);
    if (!s)
        throw new FormatError(`unknown slide "${slideId}"`);
    return deck.text.slice(s.inner.start, s.inner.end);
}
