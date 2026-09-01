import { type Edit, type ParsedDeck } from './types.js';
/** Apply non-overlapping edits to text by offset, splicing from the end backwards. */
export declare function spliceText(text: string, edits: Edit[]): string;
/** Normalize any EOLs in inserted content to the deck's convention. */
export declare function normalizeEol(content: string, eol: '\n' | '\r\n'): string;
/** Replace one slide's inner content. Returns a freshly parsed deck. */
export declare function replaceSlideInner(deck: ParsedDeck, slideId: string, newInner: string): ParsedDeck;
/** Serialize a manifest object into the manifest script region. Returns a freshly parsed deck.
    `<` is escaped as < so no string value can terminate the script tag or fake a
    template boundary — same parsed JSON, inert source text. */
export declare function replaceManifest(deck: ParsedDeck, manifest: ParsedDeck['manifest']): ParsedDeck;
/** Serialize the asset table into the assets script block. Inserts the block
    (after the last slide template) when the deck doesn't have one yet; replacing
    an absent block with an empty table is a no-op. Same `<` escaping as the
    manifest — no asset value can terminate the script tag. */
export declare function replaceAssets(deck: ParsedDeck, assets: Record<string, string>): ParsedDeck;
/** Remove whole slide templates (plus their trailing newline) by id. Returns a fresh parse. */
export declare function removeSlides(deck: ParsedDeck, slideIds: string[]): ParsedDeck;
