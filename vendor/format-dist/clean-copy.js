import { hasActiveContent } from './content-policy.js';
import { parseDeck } from './parse.js';
import { publishTable } from './publish-table.js';
import { replaceAssets, replaceManifest, removeSlides } from './splice.js';
import { FormatError } from './types.js';
/**
 * "Share a clean copy" (F28): the emailed file must not leak hidden slides or
 * speaker notes — both travel in plaintext otherwise. Strips hidden slide
 * templates, drops their manifest entries, blanks every notes field, and drops
 * assets no remaining slide references (a hidden slide's photo is hidden
 * content too).
 */
export function cleanCopy(deck) {
    const hidden = deck.manifest.hidden ?? [];
    let d = hidden.length > 0 ? removeSlides(deck, hidden.filter((id) => deck.slideById.has(id))) : deck;
    const slides = {};
    for (const [id, meta] of Object.entries(d.manifest.slides)) {
        if (hidden.includes(id))
            continue;
        slides[id] = { ...meta, notes: '' };
    }
    const manifest = {
        ...d.manifest,
        order: d.manifest.order.filter((id) => !hidden.includes(id)),
        hidden: [],
        slides,
    };
    d = replaceManifest(d, manifest);
    if (Object.keys(d.assets).length > 0) {
        const referenced = new Set();
        // chrome-referenced reserved assets (not slide content, not hidden content):
        // the brand logo, its per-surface colour overrides (masthead-logo drawn by the
        // viewer header, backdrop-logo by the watermark), and every embedded font
        const RESERVED = new Set(['brand-logo', 'masthead-logo', 'backdrop-logo']);
        for (const id of Object.keys(d.assets)) {
            if (RESERVED.has(id) || /^font-[a-z0-9-]+$/.test(id))
                referenced.add(id);
        }
        for (const s of d.slides) {
            const inner = d.text.slice(s.inner.start, s.inner.end);
            for (const m of inner.matchAll(/\bdata-oasset="([^"]*)"/g))
                referenced.add(m[1]);
        }
        const kept = {};
        for (const [id, url] of Object.entries(d.assets)) {
            if (referenced.has(id))
                kept[id] = url;
        }
        if (Object.keys(kept).length !== Object.keys(d.assets).length)
            d = replaceAssets(d, kept);
    }
    return d;
}
/**
 * DESTRUCTIVE bake for Publish: rewrite every `table` block down to just what it PRESENTS via publishTable.
 * Per block: KEEP every SHOWN sheet (shown = `!hidden || baked`, so a baked hidden sheet still ships),
 * each flattened by the single-sheet publish discipline (a baked sheet → its crop, hidden cells gone; an
 * unbaked sheet → live/full); STRIP every hidden-unbaked sheet entirely (it's hidden content, like the
 * cells behind a "Share full copy" crop); DROP `hidden` from every kept sheet; and COLLAPSE to a
 * single-sheet block when only one sheet survives. A block that is a plain single sheet — not baked, not
 * multi-tab, and not carrying a `hidden` flag — is left byte-identical (the gate never fires). Text-level
 * so it composes with cleanCopy/markPublished; the JSON block escapes "<" the same way the serializer does.
 */
export function flattenBakedLedgers(deck) {
    const RE = /(<script\b[^>]*\bdata-odata="table"[^>]*>)([\s\S]*?)(<\/script>)/g;
    let changed = false;
    const text = deck.text.replace(RE, (full, open, body, close) => {
        let data;
        try {
            data = JSON.parse(body);
        }
        catch {
            return full;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return full;
        const d = data;
        const hasTabs = d.tabName !== undefined || d.tabs !== undefined || d.tabPos !== undefined;
        const anyHidden = d.hidden === true || (Array.isArray(d.tabs) && d.tabs.some((t) => t?.data?.hidden === true));
        if (!d.bake?.rect && !hasTabs && !anyHidden)
            return full; // nothing to flatten, strip, or drop
        changed = true;
        const out = publishTable(d);
        return open + '\n' + JSON.stringify(out, null, 2).replace(/</g, '\\u003c') + '\n' + close;
    });
    return changed ? parseDeck(text) : deck;
}
/**
 * "Publish" = a clean copy whose runtime refuses to edit: stamps
 * data-origami-published on the <html> element; the viewer hides the
 * lite-edit toggle when it is present. Recipients get a read-only deck.
 */
export function markPublished(deck) {
    const open = deck.text.indexOf('<html');
    const end = deck.text.indexOf('>', open);
    if (open === -1 || end === -1)
        throw new FormatError('markPublished: no <html> tag');
    // idempotence must check the TAG, not the document — the runtime's own gate
    // code mentions the attribute name inside every deck's embedded IIFE
    if (deck.text.slice(open, end).includes('data-origami-published'))
        return deck;
    return parseDeck(deck.text.slice(0, end) + ' data-origami-published=""' + deck.text.slice(end));
}
/**
 * Stamp (or clear) data-origami-active on the <html> tag so the file self-
 * describes whether any slide carries active content — scripts, styles, iframes,
 * remote URLs (anything hasActiveContent flags). A recipient's Studio reads it to
 * open the deck LOCKED by default until they trust the sender. Idempotent both
 * directions; byte-identical when the stamp already matches the content.
 */
export function stampActive(deck) {
    const open = deck.text.indexOf('<html');
    const end = deck.text.indexOf('>', open);
    if (open === -1 || end === -1)
        throw new FormatError('stampActive: no <html> tag');
    // TAG-scoped, NEVER a whole-document includes() — the embedded runtime IIFE and
    // the mount scrub both mention this attribute name (the FIXTURE-STRING TRAP).
    const tag = deck.text.slice(open, end);
    const present = /\bdata-origami-active\b/.test(tag);
    const active = deck.slides.some((s) => hasActiveContent(deck.text.slice(s.inner.start, s.inner.end)));
    if (active === present)
        return deck; // already correct → byte-identical
    if (active) {
        return parseDeck(deck.text.slice(0, end) + ' data-origami-active=""' + deck.text.slice(end));
    }
    // clear it: strip the attribute from the <html> tag region only
    const cleaned = tag.replace(/\s*data-origami-active(?:="[^"]*")?/, '');
    return parseDeck(deck.text.slice(0, open) + cleaned + deck.text.slice(end));
}
