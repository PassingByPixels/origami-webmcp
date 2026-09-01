import { validateSlideContent } from './content-policy.js';
import { renderComposite } from './block-render.js';
export const COMPOSITE_FIELD_TYPES = ['text', 'number', 'select', 'color'];
const KIND_RE = /^x\.[a-z0-9][a-z0-9-]*$/;
const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Validate one block def: well-formed shape AND its template, rendered with defaults,
    is structurally valid + INERT (a def that would bake to active content is rejected —
    `define_block` and the deck.blocks op both call this, so an active custom block can
    never enter a deck). */
export function validateBlockDef(def) {
    const v = [];
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
        return [{ rule: 'block-def.shape', detail: 'a block def must be an object' }];
    }
    const d = def;
    if (typeof d.kind !== 'string' || !KIND_RE.test(d.kind)) {
        v.push({ rule: 'block-def.kind', detail: 'kind must match x.<name> (lowercase letters, digits, hyphens)' });
    }
    if (typeof d.name !== 'string' || d.name.length === 0)
        v.push({ rule: 'block-def.name', detail: 'name is required' });
    if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) {
        v.push({ rule: 'block-def.version', detail: 'version must be a positive integer' });
    }
    if (typeof d.template !== 'string' || d.template.length === 0)
        v.push({ rule: 'block-def.template', detail: 'template is required' });
    if (!Array.isArray(d.fields)) {
        v.push({ rule: 'block-def.fields', detail: 'fields must be an array' });
    }
    else {
        const seen = new Set();
        for (const f of d.fields) {
            const fo = (f ?? {});
            if (typeof fo.name !== 'string' || !FIELD_RE.test(fo.name)) {
                v.push({ rule: 'block-def.field.name', detail: 'each field needs an identifier name (letters, digits, underscore)' });
                continue;
            }
            if (seen.has(fo.name))
                v.push({ rule: 'block-def.field.name', detail: `duplicate field "${fo.name}"` });
            seen.add(fo.name);
            if (typeof fo.type !== 'string' || !COMPOSITE_FIELD_TYPES.includes(fo.type)) {
                v.push({ rule: 'block-def.field.type', detail: `field "${fo.name}": type must be one of ${COMPOSITE_FIELD_TYPES.join('|')}` });
            }
            if (fo.type === 'select' && (!Array.isArray(fo.options) || fo.options.length === 0)) {
                v.push({ rule: 'block-def.field.options', detail: `field "${fo.name}": a 'select' field needs a non-empty options[]` });
            }
        }
    }
    if (v.length > 0)
        return v;
    // the template, rendered with defaults, must be structurally valid AND inert
    const { html, violations: active } = renderComposite(def, {});
    for (const s of validateSlideContent(html)) {
        v.push({ rule: 'block-def.template', detail: `template renders invalid structure: ${s.detail}` });
    }
    if (active.length > 0) {
        v.push({
            rule: 'block-def.active',
            detail: `template renders ACTIVE content (${active.map((a) => a.rule).join(', ')}) — composite blocks must be inert`,
        });
    }
    return v;
}
/** Validate one composite-block INSTANCE. Shape always; the def-exists check only when a
    `registry` is supplied (validateKindData passes the deck's manifest.blocks; the bare
    KIND_DATA_SPECS entry calls it shape-only). The renderer coerces/defaults individual
    values, so value checking stays light — this guards integrity, not perfection. */
export function validateBlockInstance(data, registry) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return [{ rule: 'block.shape', detail: 'a block instance must be an object {block, values}' }];
    }
    const d = data;
    if (typeof d.block !== 'string' || !d.block)
        return [{ rule: 'block.ref', detail: 'block instance must name its def in "block"' }];
    if (d.values !== undefined && (typeof d.values !== 'object' || d.values === null || Array.isArray(d.values))) {
        return [{ rule: 'block.values', detail: `block "${d.block}": values must be an object` }];
    }
    if (registry && !registry[d.block]) {
        return [{ rule: 'block.unknown-def', detail: `references undefined block "${d.block}" — define it in manifest.blocks (define_block)` }];
    }
    return [];
}
/** Serialize a composite-block instance's data block JSON, escaping "<" so it can never
    terminate the inert <script>. Mirrors gridDataJson / setKindData escaping. */
export function blockInstanceJson(block, values) {
    return JSON.stringify({ block, values }, null, 2).replace(/</g, '\\u003c');
}
/** Strip the inert data-script from every composite-block instance of `kind` in a slide's
    inner HTML, leaving the baked .o-block-out as plain inert content. Deleting a def this way
    never destroys placed content and leaves no dangling def reference (the deck stays valid).
    Zero-dep (regex): the instance JSON escapes "<" as \\u003c, so "</script>" can't appear
    inside it and the non-greedy match always ends at the real closer. */
export function stripBlockInstances(inner, kind) {
    let removed = 0;
    const out = inner.replace(/<script type="application\/json" data-odata="block">([\s\S]*?)<\/script>/g, (whole, json) => {
        try {
            if (JSON.parse(json).block === kind) {
                removed++;
                return '';
            }
        }
        catch {
            /* leave malformed scripts untouched */
        }
        return whole;
    });
    return { inner: out, removed };
}
