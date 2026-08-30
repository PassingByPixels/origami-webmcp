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
export interface Engine {
    /** Current #origami-base-css contents. */
    baseCss: string;
    /** Current #origami-kinds-css contents. */
    kindsCss: string;
    /** Current #origami-runtime IIFE (must not contain "</script"). */
    runtimeJs: string;
}
export declare function upgradeEngine(deckText: string, engine: Engine): string;
