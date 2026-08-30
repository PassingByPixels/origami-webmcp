/** Upgrade-on-save (F20): re-embed the current ENGINE — the base + kinds style
    sheets and the runtime script — into a deck when it is saved, so a deck made
    by an older addon heals to the current renderer the moment you edit and save
    it. The viewer is forward-safe (old decks still play on their own embedded
    runtime), so this never runs on open — only on a write.

    Only blocks whose content actually DIFFERS are rewritten, so a deck already
    on the current engine returns byte-identical: the round-trip / byte-stability
    invariant holds for the common case. Theme CSS (the deck's own, re-projected
    on a theme change), the manifest, slides and assets are never touched. EOLs
    are preserved. A missing block is left as-is.

    The Studio owns the current engine (its bundled BASE_CSS / KINDS_CSS and the
    runtime IIFE) and calls this on every disk save; this library stays zero-dep. */
import { normalizeEol } from './splice.js';
const BLOCKS = [
    { id: 'origami-base-css', closeTag: '</style>', wrap: (s) => s, pick: (e) => e.baseCss },
    { id: 'origami-kinds-css', closeTag: '</style>', wrap: (s) => s, pick: (e) => e.kindsCss },
    { id: 'origami-runtime', closeTag: '</script>', wrap: (s) => '\n' + s + '\n', pick: (e) => e.runtimeJs },
];
export function upgradeEngine(deckText, engine) {
    const eol = deckText.includes('\r\n') ? '\r\n' : '\n';
    let out = deckText;
    for (const b of BLOCKS) {
        // the engine blocks live in <head>/end-of-<body> BEFORE any same-named string
        // the runtime IIFE might mention — the first id marker is the real tag (the
        // same lookup extractStyles uses)
        const at = out.indexOf(`id="${b.id}"`);
        if (at === -1)
            continue;
        const open = out.indexOf('>', at);
        if (open === -1)
            continue;
        const innerStart = open + 1;
        const close = out.indexOf(b.closeTag, innerStart);
        if (close === -1)
            continue;
        const target = normalizeEol(b.wrap(b.pick(engine)), eol);
        if (out.slice(innerStart, close) === target)
            continue; // already current — no churn
        out = out.slice(0, innerStart) + target + out.slice(close);
    }
    return out;
}
