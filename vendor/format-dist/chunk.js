import { activeContentFlags, validateSlideContent } from './content-policy.js';
import { kindSchemaComment } from './kinds.js';
import { slideInner } from './parse.js';
import { replaceSlideInner } from './splice.js';
import { FormatError } from './types.js';
/**
 * The AI chunk contract.
 *
 * extractChunk produces a bounded, self-contained payload (target 30–600 lines).
 * applyChunkReply enforces what the comments merely request (F27): the template
 * root, the slide id, and the kind are immutable through this path — drift is
 * rejected, not repaired silently.
 */
export function extractChunk(deck, slideId) {
    const s = deck.slideById.get(slideId);
    if (!s)
        throw new FormatError(`unknown slide "${slideId}"`);
    const meta = deck.manifest.slides[slideId];
    const lines = [
        '<!-- ORIGAMI EDIT CONTEXT -->',
        `<!-- Deck: ${deck.manifest.title} · Theme: ${deck.manifest.theme?.name ?? 'default'} · Slide: ${slideId} · Kind: ${s.kind} -->`,
        '',
        '<!-- Manifest entry (do not modify) -->',
        JSON.stringify({ id: slideId, kind: s.kind, label: meta?.label ?? '' }, null, 2),
        '',
        '<!-- Kind schema (what is available in this slide type) -->',
        ...kindSchemaComment(s.kind).map((l) => `<!-- ${l} -->`),
        '',
        '<!-- HOW TO REPLY -->',
        '<!-- Rewrite the slide below to meet the request, then reply with that ONE',
        '     <template> element and nothing else:',
        '       * no markdown fences and no prose; exactly one <template>',
        '       * keep its data-origami-slide id and data-kind exactly (drift is rejected)',
        '       * keep every "<" escaped as \\u003c inside JSON data blocks',
        '     The inner markup is yours: any HTML/CSS, <style> @keyframes, SVG animation,',
        '     custom layout. Built-ins still help (class="anim" + style="--i:N" staggers',
        '     reveals; data-opos/-osize/-otone set position, scale, tint). <script>,',
        '     <style>, iframes and remote URLs are allowed - they mark the deck "active"',
        '     (recipients open it locked until they trust you), so prefer declarative SVG',
        '     animation for motion every viewer should see (it stays inert and always plays). -->',
        '',
        '<!-- THE SLIDE (edit this; return the whole <template> element) -->',
        `<template data-origami-slide="${slideId}" data-kind="${s.kind}">${slideInner(deck, slideId)}</template>`,
    ];
    return lines.join('\n');
}
/** Accepts a full chunk (context + template) or a bare template element.
    Only template opens carrying data-origami-slide count — chat prose (and the
    chunk's own context comments) may legitimately mention `<template>`. */
export function parseChunkReply(reply) {
    const candidates = [];
    let pos = 0;
    for (;;) {
        const tStart = reply.indexOf('<template', pos);
        if (tStart === -1)
            break;
        const tagEnd = reply.indexOf('>', tStart);
        if (tagEnd === -1)
            break;
        const tag = reply.slice(tStart, tagEnd + 1);
        const id = /\bdata-origami-slide="([^"]*)"/.exec(tag)?.[1];
        if (id !== undefined) {
            candidates.push({ tagEnd, id, kind: /\bdata-kind="([^"]*)"/.exec(tag)?.[1] });
        }
        pos = tagEnd + 1;
    }
    if (candidates.length === 0) {
        throw new FormatError('reply contains no <template data-origami-slide> element');
    }
    // Chat models (ChatGPT especially) often ECHO the original slide before giving
    // their edit, so a reply can carry several <template>s that all target the SAME
    // slide. Take the LAST one — the final edit. Templates targeting DIFFERENT slides
    // are genuinely ambiguous for a single-slide edit, so those still reject.
    const distinctIds = new Set(candidates.map((c) => c.id));
    if (distinctIds.size > 1) {
        throw new FormatError('reply must contain exactly one <template> element');
    }
    const { tagEnd, id, kind } = candidates[candidates.length - 1];
    if (!kind)
        throw new FormatError('reply template is missing data-kind');
    const innerEnd = reply.indexOf('</template>', tagEnd + 1);
    if (innerEnd === -1)
        throw new FormatError('unterminated <template> element');
    return { slideId: id, kind, inner: reply.slice(tagEnd + 1, innerEnd) };
}
const CODE_FENCE = /^\s*```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i;
/** Strip a single surrounding markdown code fence when the whole reply is fenced. */
function stripCodeFence(reply) {
    const m = CODE_FENCE.exec(reply);
    return m ? m[1] : reply;
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
export function coerceChunkReply(reply, expected) {
    const cleaned = stripCodeFence(reply).trim();
    try {
        return { ...parseChunkReply(cleaned), coerced: false };
    }
    catch (e) {
        // only re-wrap content that LOOKS like slide markup (has a tag). Prose with no
        // '<' is a refusal/acknowledgement, not a slide — reject it rather than apply a
        // chat sentence as a fold (the MCP path has no human gate to catch that).
        if (e instanceof FormatError && /no <template/.test(e.message) && cleaned.includes('<')) {
            return { slideId: expected.slideId, kind: expected.kind, inner: cleaned, coerced: true };
        }
        throw e;
    }
}
export function applyChunkReply(deck, expectedSlideId, reply) {
    const parsed = parseChunkReply(reply);
    const target = deck.slideById.get(expectedSlideId);
    if (!target)
        throw new FormatError(`unknown slide "${expectedSlideId}"`);
    if (parsed.slideId !== expectedSlideId) {
        throw new FormatError(`slide id drift: reply targets "${parsed.slideId}" but the edit was for "${expectedSlideId}"`);
    }
    if (parsed.kind !== target.kind) {
        throw new FormatError(`kind drift: reply declares "${parsed.kind}" but slide "${expectedSlideId}" is "${target.kind}"`);
    }
    // block only on HARD (structure-breaking) violations; active content applies
    // and is reported as warnings (the deck becomes active).
    const violations = validateSlideContent(parsed.inner);
    if (violations.length > 0) {
        return { deck, violations, warnings: [] };
    }
    return {
        deck: replaceSlideInner(deck, expectedSlideId, parsed.inner),
        violations: [],
        warnings: activeContentFlags(parsed.inner),
    };
}
