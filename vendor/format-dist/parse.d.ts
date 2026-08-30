import { type ParsedDeck } from './types.js';
/** Parse a deck by string offsets. Never builds a DOM; offsets index the original text. */
export declare function parseDeck(text: string): ParsedDeck;
export declare function slideInner(deck: ParsedDeck, slideId: string): string;
