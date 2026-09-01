import { parseDeck } from './parse.js';
import { normalizeEol, spliceText } from './splice.js';
import { FormatError } from './types.js';
/**
 * Theme = the manifest's `{name, tokens}` plus the generated
 * `<style id="origami-theme-css">` block. The tokens are the SOURCE; the CSS
 * block is their deterministic projection — the viewer and print read only
 * the block, so the two must never disagree. serializeModel regenerates the
 * block whenever a deck.theme op changed the theme (and only then — untouched
 * decks keep their bytes, including hand-customized theme CSS).
 */
const TOKEN_KEY_RE = /^[a-z][a-z0-9-]*$/;
/* Values land inside :root{} verbatim. The bans make breakout or smuggling
   structurally impossible: no block/declaration characters, no comments, no
   at-rules, and no url() — theme tokens are colours and font stacks, and a
   url() would be a network fetch in a zero-network file (F31). */
const TOKEN_VALUE_BAD = /[<>{};\\]|url\s*\(|\/\*|@/i;
export function validateThemeTokens(tokens) {
    const v = [];
    if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
        return [{ rule: 'theme.tokens', detail: 'theme tokens must be an object of css custom property values' }];
    }
    for (const [key, value] of Object.entries(tokens)) {
        if (!TOKEN_KEY_RE.test(key)) {
            v.push({ rule: 'theme.token-key', detail: `token "${key}": keys are lowercase [a-z0-9-], starting with a letter` });
        }
        if (typeof value !== 'string' || value.length === 0 || value.length > 300) {
            v.push({ rule: 'theme.token-value', detail: `token "${key}": value must be a non-empty string (max 300)` });
        }
        else if (TOKEN_VALUE_BAD.test(value)) {
            v.push({
                rule: 'theme.token-value',
                detail: `token "${key}": value may not contain braces, semicolons, angle brackets, comments, @, or url()`,
            });
        }
    }
    return v;
}
/** Project tokens into the theme style block's content. Throws on tokens that
    fail validation — the generator is the last gate before raw CSS. */
export function themeCssFromTokens(tokens) {
    const violations = validateThemeTokens(tokens);
    if (violations.length > 0)
        throw new FormatError('theme: ' + violations[0].detail);
    const lines = Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`);
    return '\n:root {\n' + lines.join('\n') + '\n}\n';
}
/** Replace the content of <style id="origami-theme-css">. Returns a fresh
    parse; a deck without the block is returned unchanged (nothing to project
    into — hand-built decks keep whatever styling they have). */
export function replaceThemeCss(deck, css) {
    const marker = 'id="origami-theme-css"';
    const at = deck.text.indexOf(marker);
    if (at === -1)
        return deck;
    const open = deck.text.indexOf('>', at);
    const close = deck.text.indexOf('</style>', open);
    if (open === -1 || close === -1)
        return deck;
    const out = spliceText(deck.text, [
        { start: open + 1, end: close, replacement: normalizeEol(css, deck.eol) },
    ]);
    return parseDeck(out);
}
