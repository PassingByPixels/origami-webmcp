/** Extract the deck's style blocks by id. The Studio canvas renders with the
    DECK's CSS (decks can carry customized themes), never the runtime constants. */
const IDS = [
    ['base', 'origami-base-css'],
    ['kinds', 'origami-kinds-css'],
    ['theme', 'origami-theme-css'],
];
export function extractStyles(text) {
    const out = { base: '', kinds: '', theme: '' };
    for (const [key, id] of IDS) {
        const marker = `id="${id}"`;
        const at = text.indexOf(marker);
        if (at === -1)
            continue;
        const open = text.indexOf('>', at);
        const close = text.indexOf('</style>', open);
        if (open === -1 || close === -1)
            continue;
        out[key] = text.slice(open + 1, close);
    }
    return out;
}
