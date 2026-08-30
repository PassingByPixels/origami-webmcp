import type { ParsedDeck } from './types.js';
export interface SaveOptions {
    /** ISO timestamp for manifest.modified. Injected for testability. */
    now: string;
}
/**
 * The canonical save: apply slide content changes, then stamp manifest.modified.
 * The byte-diff of the result vs the input is confined to the edited slide inner
 * regions plus the manifest region — the P1 round-trip invariant.
 */
export declare function saveDeck(deck: ParsedDeck, slideEdits: Record<string, string>, opts: SaveOptions): ParsedDeck;
