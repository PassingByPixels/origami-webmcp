import type { Violation } from './types.js';
/**
 * HARD violations only — what breaks the single-file structure. These are
 * rejected at write time, always. Returns [] for active-but-well-formed content
 * (scripts, styles, remote URLs) — that is governed by the padlock, not blocked.
 */
export declare function validateSlideContent(html: string): Violation[];
/** SOFT signals — the deck carries active content. Never blocks; drives the
    data-origami-active stamp and the recipient's padlock. */
export declare function activeContentFlags(html: string): Violation[];
export declare function hasActiveContent(html: string): boolean;
