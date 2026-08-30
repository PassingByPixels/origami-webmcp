import { type ParsedDeck, type Violation } from './types.js';
export declare function validateThemeTokens(tokens: unknown): Violation[];
/** Project tokens into the theme style block's content. Throws on tokens that
    fail validation — the generator is the last gate before raw CSS. */
export declare function themeCssFromTokens(tokens: Record<string, string>): string;
/** Replace the content of <style id="origami-theme-css">. Returns a fresh
    parse; a deck without the block is returned unchanged (nothing to project
    into — hand-built decks keep whatever styling they have). */
export declare function replaceThemeCss(deck: ParsedDeck, css: string): ParsedDeck;
