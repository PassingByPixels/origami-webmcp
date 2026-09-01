import { type ParsedDeck } from './types.js';
export interface MigrationResult {
    deck: ParsedDeck;
    /** Format major is newer than this library understands: open read-only, never write. */
    readOnly: boolean;
    actions: string[];
}
/**
 * File-format version policy (F20). manifest.v is an integer GENERATION (see
 * FORMAT_VERSION / FORMAT.md), not a semver — a legacy "1.0"-style value reads as
 * generation 1:
 *   - same generation  → read/write, no rewrite.
 *   - NEWER generation → read-only, no silent rewrite (the forward-compat guard:
 *     an old app must never mangle a deck written by a newer one).
 *   - older generation → migrate forward step-by-step (none exist yet at gen 1).
 */
export declare function migrateDeck(deck: ParsedDeck): MigrationResult;
