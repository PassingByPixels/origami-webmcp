/** Extract the deck's style blocks by id. The Studio canvas renders with the
    DECK's CSS (decks can carry customized themes), never the runtime constants. */
export interface DeckStyles {
    base: string;
    kinds: string;
    theme: string;
}
export declare function extractStyles(text: string): DeckStyles;
