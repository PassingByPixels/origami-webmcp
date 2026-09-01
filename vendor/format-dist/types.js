/** The .origami FILE-FORMAT generation — an integer counter, NOT a semver and NOT the
    app/npm package version (which is 0.x pre-launch). It is stamped into every deck's
    manifest `v`. Same generation = read/write; a NEWER generation than this library =
    open read-only (never rewrite); an older generation = migrate forward. A legacy
    "1.0"-style value reads as generation 1. Bump ONLY on a breaking format change, and
    add the matching migration step in migrate.ts. See FORMAT.md. */
export const FORMAT_VERSION = '1';
/** The reading experiences a Fold can present. ABSENT on the manifest === 'deck'
    (the default card-stage), so a deck that never sets foldType serializes
    byte-identically — no FORMAT_VERSION bump, no migration. 'scroll' = a
    continuous-reading document (reuses the `document` kind); 'ledger' = data/calc
    (reserved — the gated Ledger pillar). */
export const FOLD_TYPES = ['deck', 'scroll', 'ledger'];
export class FormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FormatError';
    }
}
