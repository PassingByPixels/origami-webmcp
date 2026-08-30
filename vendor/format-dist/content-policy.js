/* SOFT — active content. Allowed; flags the deck active; the padlock + sandbox
   govern it at open time. */
const ACTIVE_RULES = [
    { rule: 'event-handler', re: /\son[a-z]+\s*=/i, detail: 'an inline event handler (on*=)' },
    { rule: 'javascript-url', re: /javascript\s*:/i, detail: 'a javascript: URL' },
    { rule: 'meta', re: /<meta/i, detail: 'a <meta> tag' },
    { rule: 'base', re: /<base/i, detail: 'a <base> tag' },
    { rule: 'iframe', re: /<iframe/i, detail: 'a raw <iframe> (prefer the embed block for the trust badge)' },
    { rule: 'object-embed', re: /<(object|embed|applet)/i, detail: 'a plugin element (object/embed/applet)' },
    { rule: 'form', re: /<form/i, detail: 'a <form>' },
    { rule: 'link-tag', re: /<link/i, detail: 'a <link> tag' },
    { rule: 'style-tag', re: /<style/i, detail: 'a custom <style> block' },
    // <set> can set a handler/href attribute via SMIL; declarative <animate*> is
    // inert and intentionally NOT flagged (inline handlers, if any, hit event-handler)
    { rule: 'svg-script', re: /<set\b/i, detail: 'an SVG <set> element' },
    { rule: 'import', re: /@import/i, detail: 'a CSS @import' },
    { rule: 'remote-url', re: /\b(?:src|srcset|href|xlink:href)\s*=\s*["']\s*(?:https?:)?\/\//i, detail: 'a remote src/href (loads from the network)' },
    { rule: 'css-remote-url', re: /url\(\s*["']?\s*(?:https?:)?\/\//i, detail: 'a remote url() (loads from the network)' },
];
/* data: URIs are inert only for known media types; anything else (text/html,
   text/javascript, …) is active content. */
const DATA_URI_RE = /\bdata:([a-z0-9/+.-]+)/gi;
const ALLOWED_DATA_TYPES = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf))$/i;
/* The ONLY inert <script> form is the JSON data block, byte-exact. Any other
   "<script" opener is a real (active) script element. Separately, open/close
   counts must BALANCE or the document-level script-region pairing desyncs —
   that is a structural (HARD) corruption, not merely active content. */
const DATA_SCRIPT_OPEN = /^<script type="application\/json" data-odata="[a-z0-9-]+">/;
const SCRIPT_TOKEN = /<\/?script/gi;
function activeScriptFlags(html) {
    for (const m of html.matchAll(SCRIPT_TOKEN)) {
        if (m[0][1] === '/')
            continue; // a closer is not an opener
        if (!DATA_SCRIPT_OPEN.test(html.slice(m.index))) {
            return [{ rule: 'script', detail: 'a <script> element (runs code)' }];
        }
    }
    return [];
}
function structuralScriptViolations(html) {
    let opens = 0;
    let closes = 0;
    for (const m of html.matchAll(SCRIPT_TOKEN)) {
        if (m[0][1] === '/')
            closes++;
        else
            opens++;
    }
    return opens !== closes
        ? [{ rule: 'script-balance', detail: 'unbalanced <script>/</script> in slide content' }]
        : [];
}
/**
 * HARD violations only — what breaks the single-file structure. These are
 * rejected at write time, always. Returns [] for active-but-well-formed content
 * (scripts, styles, remote URLs) — that is governed by the padlock, not blocked.
 */
export function validateSlideContent(html) {
    const out = [];
    // A literal template tag inside slide content terminates (or nests) the slide's
    // own <template> boundary at the file level — never legitimate, always corrupts.
    if (/<\/?template/i.test(html)) {
        out.push({ rule: 'template-boundary', detail: '<template> tags are not allowed inside slide content (they break the single-file structure)' });
    }
    // WRAP RUNS ARE A VIEW AND MAY NEVER BE STORED (spec Q1, defence in depth). Engine B replaces a
    // leaf's children with absolutely positioned run spans measured at one browser's idea of one
    // width; `withSource` releases before every read, and this is the backstop for the read nobody
    // gated. It belongs with the HARD rules rather than the soft flags because a stored run is
    // CORRUPTION, not a risk: `sanitizeInline` keeps SPAN + class, so a leak degrades to junk spans
    // with the break whitespace mangled — markup that still looks like prose and is not.
    // Rejecting is strictly better than rewriting for the same reason the template rule rejects: the
    // author's real paragraph is still in the DOM at that moment, so a refusal loses nothing, while a
    // silent scrub would write the damaged text back as if it were the source.
    if (/\sdata-orun\b/i.test(html) || /class\s*=\s*["'][^"']*\bo-run\b/i.test(html)) {
        out.push({ rule: 'wrap-run-leak', detail: 'text-wrap run spans (data-orun / .o-run) are a layout view and cannot be saved as slide content' });
    }
    out.push(...structuralScriptViolations(html));
    return out;
}
/** SOFT signals — the deck carries active content. Never blocks; drives the
    data-origami-active stamp and the recipient's padlock. */
export function activeContentFlags(html) {
    const out = [];
    for (const r of ACTIVE_RULES) {
        if (r.re.test(html))
            out.push({ rule: r.rule, detail: r.detail });
    }
    out.push(...activeScriptFlags(html));
    for (const m of html.matchAll(DATA_URI_RE)) {
        if (!ALLOWED_DATA_TYPES.test(m[1])) {
            out.push({ rule: 'data-uri-type', detail: `a data: URI of type "${m[1]}"` });
        }
    }
    return out;
}
export function hasActiveContent(html) {
    // early-exit (this runs per-render in the Studio to keep the padlock in sync)
    for (const r of ACTIVE_RULES)
        if (r.re.test(html))
            return true;
    if (activeScriptFlags(html).length > 0)
        return true;
    for (const m of html.matchAll(DATA_URI_RE)) {
        if (!ALLOWED_DATA_TYPES.test(m[1]))
            return true;
    }
    return false;
}
