import { type ParsedDeck } from './types.js';
/**
 * "Share a clean copy" (F28): the emailed file must not leak hidden slides or
 * speaker notes — both travel in plaintext otherwise. Strips hidden slide
 * templates, drops their manifest entries, blanks every notes field, and drops
 * assets no remaining slide references (a hidden slide's photo is hidden
 * content too).
 */
export declare function cleanCopy(deck: ParsedDeck): ParsedDeck;
/**
 * DESTRUCTIVE bake for Publish: rewrite every `table` block down to just what it PRESENTS via publishTable.
 * Per block: KEEP every SHOWN sheet (shown = `!hidden || baked`, so a baked hidden sheet still ships),
 * each flattened by the single-sheet publish discipline (a baked sheet → its crop, hidden cells gone; an
 * unbaked sheet → live/full); STRIP every hidden-unbaked sheet entirely (it's hidden content, like the
 * cells behind a "Share full copy" crop); DROP `hidden` from every kept sheet; and COLLAPSE to a
 * single-sheet block when only one sheet survives. A block that is a plain single sheet — not baked, not
 * multi-tab, and not carrying a `hidden` flag — is left byte-identical (the gate never fires). Text-level
 * so it composes with cleanCopy/markPublished; the JSON block escapes "<" the same way the serializer does.
 */
export declare function flattenBakedLedgers(deck: ParsedDeck): ParsedDeck;
/**
 * "Publish" = a clean copy whose runtime refuses to edit: stamps
 * data-origami-published on the <html> element; the viewer hides the
 * lite-edit toggle when it is present. Recipients get a read-only deck.
 */
export declare function markPublished(deck: ParsedDeck): ParsedDeck;
/**
 * Stamp (or clear) data-origami-active on the <html> tag so the file self-
 * describes whether any slide carries active content — scripts, styles, iframes,
 * remote URLs (anything hasActiveContent flags). A recipient's Studio reads it to
 * open the deck LOCKED by default until they trust the sender. Idempotent both
 * directions; byte-identical when the stamp already matches the content.
 */
export declare function stampActive(deck: ParsedDeck): ParsedDeck;
