import { type ParsedDeck, type Violation } from './types.js';
/**
 * The AI chunk contract.
 *
 * extractChunk produces a bounded, self-contained payload (target 30–600 lines).
 * applyChunkReply enforces what the comments merely request (F27): the template
 * root, the slide id, and the kind are immutable through this path — drift is
 * rejected, not repaired silently.
 */
export declare function extractChunk(deck: ParsedDeck, slideId: string): string;
export interface ChunkReply {
    slideId: string;
    kind: string;
    inner: string;
}
/** Accepts a full chunk (context + template) or a bare template element.
    Only template opens carrying data-origami-slide count — chat prose (and the
    chunk's own context comments) may legitimately mention `<template>`. */
export declare function parseChunkReply(reply: string): ChunkReply;
/** A reply after light repair. `coerced` is true when the <template> wrapper was
    absent and the bare inner was re-wrapped for the known target slide. */
export interface CoercedReply extends ChunkReply {
    coerced: boolean;
}
/**
 * Parse a reply, tolerating the two deviations chat models make most:
 *   1. the whole answer wrapped in a ```html … ``` code fence, and
 *   2. returning the bare slide inner with NO <template> wrapper.
 * We already know the open slide's id+kind, so an un-wrapped reply is re-wrapped
 * (coerced) rather than rejected. An EXPLICIT <template> keeps its declared id/kind
 * so the caller can still detect drift; only the wrapper-less case is coerced.
 * Genuinely ambiguous replies (two templates, an unterminated one) still throw.
 */
export declare function coerceChunkReply(reply: string, expected: {
    slideId: string;
    kind: string;
}): CoercedReply;
export interface ApplyResult {
    deck: ParsedDeck;
    /** HARD (format-integrity) violations — when non-empty nothing is applied. */
    violations: Violation[];
    /** SOFT (active-content) signals — applied anyway; the deck is now active and
        recipients open it locked until they trust the sender. */
    warnings: Violation[];
}
export declare function applyChunkReply(deck: ParsedDeck, expectedSlideId: string, reply: string): ApplyResult;
