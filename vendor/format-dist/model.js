/**
 * The editor model + mutation API (F7) and inverse-patch history (F26).
 *
 * Every editor operation — Studio UI, canvas edits, AI applies — flows through
 * applyOp(), which mutates the model and returns the exact inverse op. Undo is
 * applyOp(inverse); redo is applyOp(op) again. Nothing edits slide source any
 * other way, so serialized output can never contain runtime DOM state.
 *
 * Serialization rebases on the parse the model was built from and splices only
 * what changed: untouched slides keep their disk bytes verbatim, slide *moves*
 * touch only the manifest (template file order is cosmetic; manifest.order is
 * truth), and a model with no effective changes serializes byte-identical to
 * its base.
 *
 * Images live in the asset table by reference (`<img data-oasset="id">`), so a
 * slide-inner snapshot in the history is a few hundred bytes even when the
 * slide shows a 2 MB photo — the data URL exists once, in the asset op.
 */
import { parseDeck } from './parse.js';
import { normalizeEol, removeSlides, replaceAssets, replaceManifest, replaceSlideInner, spliceText, } from './splice.js';
import { CAPABILITY_RE, HEADER_HEX } from './validate.js';
import { themeCssFromTokens, replaceThemeCss, validateThemeTokens } from './theme.js';
import { FOLD_TYPES, FormatError } from './types.js';
import { validateBlockDef } from './block-def.js';
const ID_RE = /^[A-Za-z0-9_-]+$/;
export function buildModel(deck) {
    const hidden = new Set(deck.manifest.hidden ?? []);
    const slides = new Map();
    for (const id of deck.manifest.order) {
        const region = deck.slideById.get(id);
        if (!region)
            throw new FormatError(`model: manifest order entry "${id}" has no template`);
        const meta = deck.manifest.slides[id];
        slides.set(id, {
            kind: region.kind,
            label: meta?.label ?? id,
            notes: meta?.notes ?? '',
            hidden: hidden.has(id),
            group: meta?.group === true,
            oby: typeof meta?.oby === 'string' ? meta.oby : '',
            bg: typeof meta?.bg === 'string' && meta.bg ? meta.bg : undefined,
            inner: deck.text.slice(region.inner.start, region.inner.end),
        });
    }
    return {
        base: deck,
        title: deck.manifest.title,
        order: [...deck.manifest.order],
        slides,
        assets: new Map(Object.entries(deck.assets)),
        capabilities: [...(deck.manifest.capabilities ?? [])],
        theme: {
            name: deck.manifest.theme?.name ?? 'origami-default',
            tokens: { ...(deck.manifest.theme?.tokens ?? {}) },
        },
        header: cleanHeader(deck.manifest.header),
        foldType: deck.manifest.foldType ?? 'deck',
        blocks: { ...(deck.manifest.blocks ?? {}) },
        removed: new Set(),
    };
}
/** Normalize a header into a comparable/serializable shape: drop an empty subtitle
    and empty/blank chips, so an absent header and `{}`/`{chips:[]}` all compare equal
    (keeps no-op saves byte-identical).

    A COLOUR THAT IS NOT A COLOUR IS DROPPED HERE, NOT THROWN. This runs on the BASE
    manifest at buildModel, and the base is a file anyone may have hand-edited — an
    exception there would refuse to open the deck rather than open it in the state its
    own bytes describe. The op door is the strict one (applyOp rejects a bad hex), which
    is the same division buildModel and applyOp already keep for every other field. */
function cleanHeader(h) {
    const out = {};
    const subtitle = typeof h?.subtitle === 'string' ? h.subtitle.trim() : '';
    if (subtitle)
        out.subtitle = subtitle;
    const chips = Array.isArray(h?.chips) ? h.chips.map((c) => String(c).trim()).filter((c) => c.length > 0) : [];
    if (chips.length > 0)
        out.chips = chips;
    for (const k of ['bg', 'ink', 'subInk']) {
        const c = h?.[k];
        if (typeof c === 'string' && HEADER_HEX.test(c))
            out[k] = c.toLowerCase();
    }
    // LAYOUT: only a value that CHANGES the band is stored. `stamp: true` is the default stamp,
    // so it is dropped here exactly as an empty subtitle is — which is what keeps a deck that
    // never touched the control byte-identical. A hand-edited `align` (dropped by a prior slice's
    // masthead control, removed) is simply not copied: an unrecognised key never survives cleanHeader.
    if (h?.stamp === false)
        out.stamp = false;
    return out;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
/** Apply one op in place; returns the inverse op. Throws FormatError on invalid input. */
export function applyOp(model, op) {
    switch (op.t) {
        case 'slide.insert': {
            if (!ID_RE.test(op.id))
                throw new FormatError(`insert: invalid slide id "${op.id}"`);
            if (!ID_RE.test(op.kind))
                throw new FormatError(`insert: invalid kind "${op.kind}"`);
            if (model.slides.has(op.id))
                throw new FormatError(`insert: slide "${op.id}" already exists`);
            const index = clamp(op.index, 0, model.order.length);
            model.order.splice(index, 0, op.id);
            model.slides.set(op.id, {
                kind: op.kind,
                label: op.label,
                notes: op.notes ?? '',
                hidden: op.hidden ?? false,
                group: op.group ?? false,
                oby: op.oby ?? '',
                bg: op.bg || undefined,
                inner: normalizeEol(op.inner, model.base.eol),
            });
            model.removed.delete(op.id);
            return { t: 'slide.remove', id: op.id };
        }
        case 'slide.remove': {
            const s = model.slides.get(op.id);
            if (!s)
                throw new FormatError(`remove: unknown slide "${op.id}"`);
            if (model.order.length === 1)
                throw new FormatError('remove: cannot remove the last slide');
            const index = model.order.indexOf(op.id);
            model.order.splice(index, 1);
            model.slides.delete(op.id);
            model.removed.add(op.id);
            return {
                t: 'slide.insert',
                id: op.id,
                index,
                kind: s.kind,
                label: s.label,
                notes: s.notes,
                hidden: s.hidden,
                group: s.group,
                oby: s.oby,
                bg: s.bg,
                inner: s.inner,
            };
        }
        case 'slide.move': {
            const from = model.order.indexOf(op.id);
            if (from === -1)
                throw new FormatError(`move: unknown slide "${op.id}"`);
            const to = clamp(op.to, 0, model.order.length - 1);
            model.order.splice(from, 1);
            model.order.splice(to, 0, op.id);
            return { t: 'slide.move', id: op.id, to: from };
        }
        case 'slide.meta': {
            const s = model.slides.get(op.id);
            if (!s)
                throw new FormatError(`meta: unknown slide "${op.id}"`);
            const prev = {};
            if (op.patch.label !== undefined) {
                prev.label = s.label;
                s.label = op.patch.label;
            }
            if (op.patch.notes !== undefined) {
                prev.notes = s.notes;
                s.notes = op.patch.notes;
            }
            if (op.patch.hidden !== undefined) {
                prev.hidden = s.hidden;
                s.hidden = op.patch.hidden;
            }
            if (op.patch.group !== undefined) {
                prev.group = s.group;
                s.group = op.patch.group;
            }
            if (op.patch.oby !== undefined) {
                prev.oby = s.oby;
                s.oby = op.patch.oby;
            }
            if (op.patch.bg !== undefined) {
                // record the OLD value as null when it was unset, so undo restores "no override" exactly
                // (undefined in the inverse patch would read as "don't touch", never clearing it back).
                prev.bg = s.bg ?? null;
                s.bg = op.patch.bg || undefined;
            }
            return { t: 'slide.meta', id: op.id, patch: prev };
        }
        case 'slide.inner': {
            const s = model.slides.get(op.id);
            if (!s)
                throw new FormatError(`inner: unknown slide "${op.id}"`);
            const prev = s.inner;
            s.inner = normalizeEol(op.inner, model.base.eol);
            return { t: 'slide.inner', id: op.id, inner: prev };
        }
        case 'deck.title': {
            const prev = model.title;
            model.title = op.title;
            return { t: 'deck.title', title: prev };
        }
        case 'deck.caps': {
            for (const c of op.capabilities) {
                if (!CAPABILITY_RE.test(c))
                    throw new FormatError(`caps: invalid capability "${c}"`);
            }
            const prev = model.capabilities;
            model.capabilities = [...op.capabilities];
            return { t: 'deck.caps', capabilities: prev };
        }
        case 'deck.theme': {
            const violations = validateThemeTokens(op.tokens);
            if (violations.length > 0)
                throw new FormatError('theme: ' + violations[0].detail);
            if (typeof op.name !== 'string' || op.name.length === 0 || op.name.length > 60) {
                throw new FormatError('theme: name must be a non-empty string (max 60)');
            }
            const prev = model.theme;
            model.theme = { name: op.name, tokens: { ...op.tokens } };
            return { t: 'deck.theme', name: prev.name, tokens: prev.tokens };
        }
        case 'deck.header': {
            // REJECT, don't silently drop: cleanHeader would quietly discard a malformed colour, and
            // an editor door that writes nothing while saying nothing is how a control comes to look
            // broken. The bar can only send a hex, so anything else is a message it did not produce.
            for (const k of ['bg', 'ink', 'subInk']) {
                const c = op.header?.[k];
                if (c !== undefined && (typeof c !== 'string' || !HEADER_HEX.test(c))) {
                    throw new FormatError(`header: ${k} must be a #rrggbb colour`);
                }
            }
            // and the same for the LAYOUT field, for the same reason: cleanHeader treats anything it
            // does not recognise as "the default", so a typo'd value would silently render as shown
            if (op.header?.stamp !== undefined && typeof op.header.stamp !== 'boolean') {
                throw new FormatError('header: stamp must be true or false');
            }
            const next = cleanHeader(op.header);
            if (next.subtitle && next.subtitle.length > 200)
                throw new FormatError('header: subtitle too long (max 200)');
            if (next.chips) {
                if (next.chips.length > 8)
                    throw new FormatError('header: too many chips (max 8)');
                for (const c of next.chips)
                    if (c.length > 60)
                        throw new FormatError('header: chip too long (max 60)');
            }
            const prev = model.header;
            model.header = next;
            return { t: 'deck.header', header: prev };
        }
        case 'deck.foldType': {
            if (!FOLD_TYPES.includes(op.foldType))
                throw new FormatError(`foldType: invalid value "${String(op.foldType)}"`);
            const prev = model.foldType;
            model.foldType = op.foldType;
            return { t: 'deck.foldType', foldType: prev };
        }
        case 'deck.blocks': {
            // every def must be well-formed AND render inert — a bad/active def never enters the model
            const next = {};
            for (const [key, def] of Object.entries(op.blocks ?? {})) {
                const violations = validateBlockDef(def);
                if (violations.length > 0)
                    throw new FormatError(`deck.blocks "${key}": ${violations[0].detail}`);
                if (def.kind !== key)
                    throw new FormatError(`deck.blocks: key "${key}" != def.kind "${def.kind}"`);
                next[key] = def;
            }
            const prev = model.blocks;
            model.blocks = next;
            return { t: 'deck.blocks', blocks: prev };
        }
        case 'asset.put': {
            if (!ID_RE.test(op.id))
                throw new FormatError(`asset.put: invalid asset id "${op.id}"`);
            const prev = model.assets.get(op.id);
            model.assets.set(op.id, op.dataUrl);
            return prev === undefined
                ? { t: 'asset.remove', id: op.id }
                : { t: 'asset.put', id: op.id, dataUrl: prev };
        }
        case 'asset.remove': {
            const prev = model.assets.get(op.id);
            if (prev === undefined)
                throw new FormatError(`asset.remove: unknown asset "${op.id}"`);
            model.assets.delete(op.id);
            return { t: 'asset.put', id: op.id, dataUrl: prev };
        }
        case 'batch': {
            const inverses = op.ops.map((o) => applyOp(model, o));
            return { t: 'batch', ops: inverses.reverse() };
        }
    }
}
export function serializeModel(model, opts = {}) {
    let d = model.base;
    const toRemove = [...model.removed].filter((id) => d.slideById.has(id));
    if (toRemove.length > 0)
        d = removeSlides(d, toRemove);
    for (const [id, s] of model.slides) {
        const r = d.slideById.get(id);
        if (!r)
            continue; // new slide — inserted below
        const baseInner = d.text.slice(r.inner.start, r.inner.end);
        if (baseInner !== s.inner)
            d = replaceSlideInner(d, id, s.inner);
    }
    // New slides append after the last template; no whitespace is added around the
    // inner content, so a reparse reproduces the model's inner strings exactly.
    for (const id of model.order) {
        if (d.slideById.has(id))
            continue;
        const s = model.slides.get(id);
        const at = d.slides.length > 0
            ? d.slides[d.slides.length - 1].element.end
            : d.manifestRegion.end + '</script>'.length;
        const block = normalizeEol('\n\n', d.eol) +
            `<template data-origami-slide="${id}" data-kind="${s.kind}">` +
            s.inner +
            '</template>';
        d = parseDeck(spliceText(d.text, [{ start: at, end: at, replacement: block }]));
    }
    const assetsObj = Object.fromEntries(model.assets);
    if (!deepEqual(assetsObj, d.assets))
        d = replaceAssets(d, assetsObj);
    // a changed theme re-projects the style block from the tokens; untouched
    // themes keep their bytes (hand-customized theme CSS survives ordinary saves)
    if (themeChanged(model))
        d = replaceThemeCss(d, themeCssFromTokens(model.theme.tokens));
    const manifest = buildManifest(model, d.manifest, opts.now);
    if (!deepEqual(manifest, d.manifest))
        d = replaceManifest(d, manifest);
    return d.text;
}
function themeChanged(model) {
    const base = model.base.manifest.theme;
    return !deepEqual(model.theme, {
        name: base?.name ?? 'origami-default',
        tokens: { ...(base?.tokens ?? {}) },
    });
}
function buildManifest(model, base, now) {
    const slides = {};
    for (const id of model.order) {
        const s = model.slides.get(id);
        // group + oby + bg are written only when set — old decks stay byte-identical on no-op saves
        slides[id] = { kind: s.kind, label: s.label, notes: s.notes, ...(s.group ? { group: true } : {}), ...(s.oby ? { oby: s.oby } : {}), ...(s.bg ? { bg: s.bg } : {}) };
    }
    // declared kinds = base declarations ∪ kinds in use (stale extras are harmless;
    // dropping them would churn the manifest on every save)
    const kinds = [...(base.kinds ?? [])];
    for (const id of model.order) {
        const k = model.slides.get(id).kind;
        if (!kinds.includes(k))
            kinds.push(k);
    }
    // capabilities/theme only override when an op changed them — a base manifest
    // that omits the key must stay byte-identical on a no-op serialize
    const capsChanged = !deepEqual(model.capabilities, base.capabilities ?? []);
    // header overrides only when changed; an empty header writes `undefined` so the
    // key drops out of the JSON entirely (a deck with no masthead stays byte-stable).
    const headerChanged = !deepEqual(model.header, cleanHeader(base.header));
    // foldType overrides only when changed; the default 'deck' writes `undefined` so the
    // key drops out (a deck that never set foldType stays byte-stable — like ...base).
    const foldTypeChanged = model.foldType !== (base.foldType ?? 'deck');
    // blocks override only when changed; an empty registry writes `undefined` so the key
    // drops out (a deck with no custom blocks stays byte-stable — like foldType).
    const blocksChanged = !deepEqual(model.blocks, base.blocks ?? {});
    return {
        ...base,
        ...(capsChanged ? { capabilities: [...model.capabilities] } : {}),
        ...(headerChanged ? { header: Object.keys(model.header).length ? model.header : undefined } : {}),
        ...(foldTypeChanged ? { foldType: model.foldType === 'deck' ? undefined : model.foldType } : {}),
        ...(blocksChanged ? { blocks: Object.keys(model.blocks).length ? model.blocks : undefined } : {}),
        ...(themeChanged(model) ? { theme: { name: model.theme.name, tokens: { ...model.theme.tokens } } } : {}),
        title: model.title,
        modified: now ?? base.modified,
        order: [...model.order],
        hidden: model.order.filter((id) => model.slides.get(id).hidden),
        slides,
        kinds,
    };
}
/** Structural equality of two models (base text excluded). */
export function modelEquals(a, b) {
    if (a.title !== b.title)
        return false;
    if (a.foldType !== b.foldType)
        return false;
    if (!deepEqual(a.header, b.header))
        return false;
    if (!deepEqual(a.blocks, b.blocks))
        return false;
    if (!deepEqual(a.capabilities, b.capabilities))
        return false;
    if (!deepEqual(a.theme, b.theme))
        return false;
    if (!deepEqual(a.order, b.order))
        return false;
    if (a.slides.size !== b.slides.size)
        return false;
    for (const [id, s] of a.slides) {
        const o = b.slides.get(id);
        if (!o || !deepEqual(s, o))
            return false;
    }
    if (a.assets.size !== b.assets.size)
        return false;
    for (const [id, v] of a.assets) {
        if (b.assets.get(id) !== v)
            return false;
    }
    return true;
}
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b || a === null || b === null)
        return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length)
            return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        if (ka.length !== kb.length)
            return false;
        return ka.every((k) => deepEqual(a[k], b[k]));
    }
    return false;
}
/**
 * Bounded undo/redo. Typing bursts coalesce: pushes with the same coalesce key
 * within `coalesceMs` update the entry's redo op but keep the original inverse —
 * one undo step per burst. Timestamps are injected (no Date.now in this lib).
 */
export class History {
    cap;
    coalesceMs;
    undoStack = [];
    redoStack = [];
    constructor(cap = 50, coalesceMs = 1000) {
        this.cap = cap;
        this.coalesceMs = coalesceMs;
    }
    push(op, inverse, at, coalesce) {
        this.redoStack.length = 0;
        const top = this.undoStack[this.undoStack.length - 1];
        if (top && coalesce !== undefined && top.coalesce === coalesce && at - top.at < this.coalesceMs) {
            top.op = op;
            top.at = at;
            return;
        }
        this.undoStack.push({ op, inverse, at, coalesce });
        if (this.undoStack.length > this.cap)
            this.undoStack.shift();
    }
    /** Pop the newest entry for undoing; the entry moves to the redo stack. */
    undo() {
        const e = this.undoStack.pop() ?? null;
        if (e)
            this.redoStack.push(e);
        return e;
    }
    redo() {
        const e = this.redoStack.pop() ?? null;
        if (e)
            this.undoStack.push(e);
        return e;
    }
    canUndo() {
        return this.undoStack.length > 0;
    }
    canRedo() {
        return this.redoStack.length > 0;
    }
    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
    depth() {
        return { undo: this.undoStack.length, redo: this.redoStack.length };
    }
    /** Rough memory footprint — the F26 heap test asserts image bytes aren't duplicated per step. */
    approxBytes() {
        return JSON.stringify(this.undoStack).length + JSON.stringify(this.redoStack).length;
    }
}
