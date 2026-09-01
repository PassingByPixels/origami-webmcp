import { FORMAT_VERSION } from './types.js';
/**
 * File-format version policy (F20). manifest.v is an integer GENERATION (see
 * FORMAT_VERSION / FORMAT.md), not a semver — a legacy "1.0"-style value reads as
 * generation 1:
 *   - same generation  → read/write, no rewrite.
 *   - NEWER generation → read-only, no silent rewrite (the forward-compat guard:
 *     an old app must never mangle a deck written by a newer one).
 *   - older generation → migrate forward step-by-step (none exist yet at gen 1).
 */
export function migrateDeck(deck) {
    // the generation is the leading integer, so "1" and a legacy "1.0" both = 1.
    const generation = (v) => parseInt(String(v).split('.')[0], 10) || 0;
    const deckGen = generation(deck.manifest.v ?? '0');
    const libGen = generation(FORMAT_VERSION);
    if (deckGen > libGen) {
        return {
            deck,
            readOnly: true,
            actions: [`deck format generation ${deckGen} is newer than this library's ${libGen}: opened read-only`],
        };
    }
    if (deckGen < libGen) {
        // when generation 2 lands, the gen-1→gen-2 migration steps go here.
        return { deck, readOnly: false, actions: [`no migration steps defined from generation ${deckGen}`] };
    }
    return { deck, readOnly: false, actions: [] };
}
