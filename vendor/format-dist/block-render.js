/** Render a composite block's template into inert HTML by substituting field values.
    PURE + trusted-layer only (Studio / desktop / MCP) — the distributed Fold carries the
    BAKED output, never this renderer. The output is HTML-escaped per value and then run
    through activeContentFlags, so a composite block can never bake to active content (the
    inert-by-default invariant). Mirrors the table bake: render in the trusted layer, ship
    inert HTML the viewer already knows how to display. */
import { activeContentFlags } from './content-policy.js';
/** Escape for BOTH text and attribute contexts (a value may land in either). */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
/** Substitute {{field}} placeholders with coerced, escaped values. Returns the html and
    any active-content violations (empty = inert; non-empty = the caller MUST reject). */
export function renderComposite(def, values) {
    const byName = new Map((def.fields ?? []).map((f) => [f.name, f]));
    const html = (def.template ?? '').replace(PLACEHOLDER, (_m, name) => {
        const f = byName.get(name);
        let val = values[name];
        if (val === undefined || val === null || val === '')
            val = f?.default ?? '';
        if (f?.type === 'number') {
            const n = Number(val);
            val = Number.isFinite(n) ? n : 0;
        }
        else if (f?.type === 'select' && Array.isArray(f.options)) {
            if (!f.options.includes(String(val)))
                val = f.options[0] ?? '';
        }
        else if (f?.type === 'color') {
            const c = String(val);
            val = /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#000000';
        }
        return esc(String(val));
    });
    return { html, violations: activeContentFlags(html) };
}
