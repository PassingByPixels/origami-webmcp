import { extractDataBlocks } from './gantt-data.js';
import { validateThemeTokens } from './theme.js';
import { validateBlockDef, validateBlockInstance } from './block-def.js';
import { FORMAT_BLOCKS_BY_KEY } from './blocks/registry.js';
import { FOLD_TYPES } from './types.js';
export const CAPABILITY_RE = /^embed:[a-z0-9.-]+$/;
/** Manifest schema checks (hand-rolled; the format is small enough not to need a schema lib). */
export function validateManifest(m) {
    const v = [];
    const req = (cond, rule, detail) => {
        if (!cond)
            v.push({ rule, detail });
    };
    req(typeof m.v === 'string' && m.v.length > 0, 'manifest.v', 'missing format version');
    req(typeof m.id === 'string' && m.id.length > 0, 'manifest.id', 'missing deck id');
    req(typeof m.title === 'string', 'manifest.title', 'missing title');
    req(Array.isArray(m.order) && m.order.length > 0, 'manifest.order', 'order must be a non-empty array');
    req(Array.isArray(m.hidden), 'manifest.hidden', 'hidden must be an array');
    req(m.slides !== null && typeof m.slides === 'object', 'manifest.slides', 'slides must be an object');
    if (Array.isArray(m.order) && m.slides) {
        const slideIds = new Set(Object.keys(m.slides));
        for (const id of m.order) {
            if (!slideIds.has(id))
                v.push({ rule: 'order/slides', detail: `order entry "${id}" has no slides entry` });
        }
        for (const id of slideIds) {
            if (!m.order.includes(id))
                v.push({ rule: 'order/slides', detail: `slide "${id}" missing from order` });
        }
        const seen = new Set();
        for (const id of m.order) {
            if (seen.has(id))
                v.push({ rule: 'order.duplicate', detail: `"${id}" appears twice in order` });
            seen.add(id);
        }
    }
    if (Array.isArray(m.hidden) && Array.isArray(m.order)) {
        for (const id of m.hidden) {
            if (!m.order.includes(id))
                v.push({ rule: 'hidden/order', detail: `hidden entry "${id}" not in order` });
        }
    }
    if (m.slides && Array.isArray(m.kinds)) {
        const used = new Set(Object.values(m.slides).map((s) => s.kind));
        for (const k of used) {
            if (!m.kinds.includes(k))
                v.push({ rule: 'kinds', detail: `kind "${k}" used but not declared in kinds` });
        }
    }
    for (const c of m.capabilities ?? []) {
        if (!CAPABILITY_RE.test(c)) {
            v.push({ rule: 'capabilities', detail: `"${c}" rejected — v1 vocabulary is embed:<origin> only` });
        }
    }
    if (m.theme !== null && typeof m.theme === 'object' && m.theme.tokens !== undefined) {
        v.push(...validateThemeTokens(m.theme.tokens));
    }
    if (m.header !== undefined)
        v.push(...validateHeader(m.header));
    if (m.foldType !== undefined && !FOLD_TYPES.includes(m.foldType)) {
        v.push({ rule: 'manifest.foldType', detail: `foldType "${String(m.foldType)}" — must be one of ${FOLD_TYPES.join('|')}` });
    }
    // composite block registry: each def well-formed + renders inert; key must equal def.kind
    if (m.blocks !== undefined) {
        if (m.blocks === null || typeof m.blocks !== 'object' || Array.isArray(m.blocks)) {
            v.push({ rule: 'manifest.blocks', detail: 'blocks must be an object keyed by x.<name>' });
        }
        else {
            for (const [key, def] of Object.entries(m.blocks)) {
                for (const bv of validateBlockDef(def))
                    v.push({ rule: bv.rule, detail: `block "${key}": ${bv.detail}` });
                if (def && def.kind !== key) {
                    v.push({ rule: 'manifest.blocks', detail: `block "${key}": key must equal def.kind "${String(def.kind)}"` });
                }
            }
        }
    }
    return v;
}
/** The ONLY shape a masthead colour may take: `#rrggbb`, or `#rrggbbaa` for the derived
    subtitle ink (the editor bakes the Theme panel's 68% `chrome-soft` mix as an alpha).
    The viewer puts these straight into an inline custom property, and a custom property
    takes almost anything — including a `url()` that would fetch from the network out of a
    deck that promises never to. So the shape is the gate, here and at the viewer. */
export const HEADER_HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
/** Masthead content (subtitle + chips), its layout (the stamp) and its own colours. Text is
    rendered as textContent in the viewer, so there is no markup-injection surface — only types,
    lengths, and a chip cap. The colours are shape-checked (see HEADER_HEX), and the layout field
    is an enumeration the viewer projects into an attribute, so only a known value passes. */
function validateHeader(h) {
    const v = [];
    if (h === null || typeof h !== 'object' || Array.isArray(h)) {
        return [{ rule: 'header', detail: 'header must be an object {subtitle?, chips?}' }];
    }
    const { subtitle, chips, stamp } = h;
    if (stamp !== undefined && typeof stamp !== 'boolean') {
        v.push({ rule: 'header.stamp', detail: 'header.stamp must be true or false' });
    }
    for (const k of ['bg', 'ink', 'subInk']) {
        const c = h[k];
        if (c !== undefined && (typeof c !== 'string' || !HEADER_HEX.test(c))) {
            v.push({ rule: `header.${k}`, detail: `header.${k} must be a #rrggbb colour` });
        }
    }
    if (subtitle !== undefined && (typeof subtitle !== 'string' || subtitle.length > 200)) {
        v.push({ rule: 'header.subtitle', detail: 'header.subtitle must be a string (max 200)' });
    }
    if (chips !== undefined) {
        if (!Array.isArray(chips)) {
            v.push({ rule: 'header.chips', detail: 'header.chips must be an array of strings' });
        }
        else {
            if (chips.length > 8)
                v.push({ rule: 'header.chips', detail: 'header.chips: at most 8 chips' });
            for (const c of chips) {
                if (typeof c !== 'string' || c.length > 60) {
                    v.push({ rule: 'header.chips', detail: 'each chip must be a string (max 60)' });
                    break;
                }
            }
        }
    }
    return v;
}
/**
 * Manifest↔DOM cross-checks (F27): id bijection and kind agreement between the
 * manifest and the template attributes. Politeness comments don't bind AI output;
 * this does.
 */
export function validateCrossConsistency(deck) {
    const v = [];
    const manifestIds = new Set(Object.keys(deck.manifest.slides ?? {}));
    const domIds = new Set(deck.slides.map((s) => s.id));
    for (const id of manifestIds) {
        if (!domIds.has(id))
            v.push({ rule: 'xcheck.template', detail: `manifest slide "${id}" has no <template>` });
    }
    for (const id of domIds) {
        if (!manifestIds.has(id))
            v.push({ rule: 'xcheck.manifest', detail: `<template> "${id}" has no manifest entry` });
    }
    for (const s of deck.slides) {
        const meta = deck.manifest.slides?.[s.id];
        if (meta && meta.kind !== s.kind) {
            v.push({ rule: 'xcheck.kind', detail: `slide "${s.id}": manifest kind "${meta.kind}" != data-kind "${s.kind}"` });
        }
    }
    return v;
}
/** Asset-table checks: values must be data:image URLs (reserved font-* slots
    additionally accept embedded fonts — data:font/woff2|woff|ttf|otf, so a user can bring
    their own brand font); every data-oasset reference in slide content must resolve. */
export function validateAssets(deck) {
    const v = [];
    for (const [id, url] of Object.entries(deck.assets)) {
        // FULL-MATCH the font data-URI (scheme + base64 body only). A prefix check would let a
        // crafted tail — e.g. `…;base64,AAA=),url(https://evil)` — survive into the unquoted url()
        // that fontFacesCss emits, smuggling a remote fetch/@import into an otherwise-inert deck.
        if (/^font-[a-z0-9-]+$/.test(id) && /^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))
            continue;
        if (!/^data:image\//.test(url)) {
            v.push({ rule: 'assets.type', detail: `asset "${id}" must be a data:image/* URL` });
        }
    }
    for (const s of deck.slides) {
        const inner = deck.text.slice(s.inner.start, s.inner.end);
        for (const m of inner.matchAll(/\bdata-oasset="([^"]*)"/g)) {
            if (!(m[1] in deck.assets)) {
                v.push({ rule: 'assets.ref', detail: `slide "${s.id}" references missing asset "${m[1]}"` });
            }
        }
    }
    return v;
}
/** Data-carrying kinds, in their historical declaration order. This differs from
    KINDS order (chart/video sit later here), and it is load-bearing: validateKindData
    below iterates KIND_DATA_SPECS and pushes cross-kind violations in this order, so
    preserving it keeps validation output byte-identical. */
const DATA_KIND_ORDER = [
    'gantt', 'flow', 'graph', 'tracker', 'notes', 'grid', 'table', 'chart', 'video', 'block', 'slider', 'draw', 'venn',
];
/** DERIVED VIEW of the block registry: each spec IS the facet's `data` object
    (same reference — so KIND_DATA_SPECS.gantt.validate === validateGanttData, etc.).
    table/tracker/grid/etc. are BLOCKS (insertable into any fold, like chart) — not
    whole-fold kinds; block placement validates the data wherever it sits + any count,
    so a legacy deck carrying one as a slide-kind still validates. The composite `block`
    facet is shape-only; validateKindData runs the full registry-aware check inline. */
// @__PURE__ so esbuild drops this (and the block registry it pulls) from the runtime
// viewer IIFE, which reaches validate.ts only for CAPABILITY_RE — never KIND_DATA_SPECS.
export const KIND_DATA_SPECS = /* @__PURE__ */ Object.fromEntries(DATA_KIND_ORDER.map((k) => [k, FORMAT_BLOCKS_BY_KEY[k].data]));
/** Kind data blocks (script[data-odata]): JSON must parse; slide-placement
    kinds carry exactly one block on their own slide and none elsewhere;
    block-placement kinds validate wherever they appear. Unregistered kinds are
    rejected outright (F27 spirit — confused output, not tolerated). */
export function validateKindData(deck) {
    const v = [];
    const caps = new Set(deck.manifest.capabilities ?? []);
    // shape first; the capability cross-check only when the data itself is clean
    const checkBlock = (slideId, kind, spec, data) => {
        const kvs = spec.validate(data);
        for (const kv of kvs)
            v.push({ rule: kv.rule, detail: `slide "${slideId}": ${kv.detail}` });
        if (kvs.length > 0 || !spec.capability)
            return;
        const cap = spec.capability(data);
        if (cap && !caps.has(cap)) {
            v.push({
                rule: 'kind-data.capability',
                detail: `slide "${slideId}": ${kind} block needs manifest capability "${cap}" — add it to manifest.capabilities`,
            });
        }
    };
    for (const s of deck.slides) {
        const inner = deck.text.slice(s.inner.start, s.inner.end);
        const blocks = extractDataBlocks(inner);
        const parsed = [];
        for (const b of blocks) {
            if (!(b.kind in KIND_DATA_SPECS)) {
                v.push({ rule: 'kind-data.unknown', detail: `slide "${s.id}": unknown data-odata kind "${b.kind}"` });
                continue;
            }
            try {
                parsed.push({ kind: b.kind, data: JSON.parse(b.json) });
            }
            catch (e) {
                v.push({ rule: 'kind-data.json', detail: `slide "${s.id}": ${b.kind} data block is not valid JSON: ${e.message}` });
            }
        }
        for (const [kind, spec] of Object.entries(KIND_DATA_SPECS)) {
            const ofKind = parsed.filter((b) => b.kind === kind);
            if (spec.placement === 'block') {
                for (const b of ofKind) {
                    // composite blocks validate against the deck registry (def must exist); other
                    // block kinds use the generic shape + capability path
                    if (kind === 'block') {
                        for (const kv of validateBlockInstance(b.data, deck.manifest.blocks ?? {})) {
                            v.push({ rule: kv.rule, detail: `slide "${s.id}": ${kv.detail}` });
                        }
                    }
                    else {
                        checkBlock(s.id, kind, spec, b.data);
                    }
                }
                continue;
            }
            if (s.kind === kind) {
                if (ofKind.length !== 1) {
                    v.push({ rule: `kind-data.${kind}`, detail: `slide "${s.id}": ${kind} slide must carry exactly one data-odata="${kind}" block` });
                }
                else {
                    checkBlock(s.id, kind, spec, ofKind[0].data);
                }
            }
            else if (ofKind.length > 0) {
                v.push({ rule: `kind-data.${kind}`, detail: `slide "${s.id}": data-odata="${kind}" block on a non-${kind} slide` });
            }
        }
    }
    return v;
}
export function validateDeck(deck) {
    return [
        ...validateManifest(deck.manifest),
        ...validateCrossConsistency(deck),
        ...validateAssets(deck),
        ...validateKindData(deck),
    ];
}
