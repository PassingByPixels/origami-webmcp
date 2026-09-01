import type { CompositeBlockDef } from './block-def.js';
/** The .origami FILE-FORMAT generation — an integer counter, NOT a semver and NOT the
    app/npm package version (which is 0.x pre-launch). It is stamped into every deck's
    manifest `v`. Same generation = read/write; a NEWER generation than this library =
    open read-only (never rewrite); an older generation = migrate forward. A legacy
    "1.0"-style value reads as generation 1. Bump ONLY on a breaking format change, and
    add the matching migration step in migrate.ts. See FORMAT.md. */
export declare const FORMAT_VERSION = "1";
export interface SlideMeta {
    kind: string;
    label: string;
    notes: string;
    /** Tucked under the previous fold's header tab (folds group in the viewer). */
    group?: boolean;
    /** Provenance: who last authored/accepted this chunk, e.g. "agent:claude@…". Inert,
        absent when never set (byte-stable). Stamped on accepting a §3 proposal. */
    oby?: string;
    /** Per-fold background colour override (any CSS colour). Absent === the theme default
        (a card's deck background / a document's paper). Serialized only when set (byte-stable);
        the renderer maps it to --fold-bg on a card or --fold-paper on a document. */
    bg?: string;
}
/** The reading experiences a Fold can present. ABSENT on the manifest === 'deck'
    (the default card-stage), so a deck that never sets foldType serializes
    byte-identically — no FORMAT_VERSION bump, no migration. 'scroll' = a
    continuous-reading document (reuses the `document` kind); 'ledger' = data/calc
    (reserved — the gated Ledger pillar). */
export declare const FOLD_TYPES: readonly ["deck", "scroll", "ledger"];
export type FoldType = (typeof FOLD_TYPES)[number];
/** Deck-level masthead content shown in the header bar (a corporate report header:
    a subtitle line under the title + metadata chips), and the masthead's OWN colours.

    WHY THE COLOURS LIVE HERE AND NOT IN THE THEME. `chrome` / `chrome-ink` / `chrome-soft`
    are theme tokens, and a theme is REPLACED WHOLE by a preset switch (model.ts's
    `deck.theme` reducer) — so a masthead colour kept as a token is wiped the next time the
    author tries a preset card. These three ride the header instead, which no theme op ever
    touches, so a hand-picked masthead survives a preset switch by construction. The tokens
    stay: they still colour an unstyled masthead AND the slide-tab strip, and they are the
    fallback under every field here. Bar THICKNESS (`chrome-pad`) and the brand-mark tint
    (`chrome-mark`) are still theme tokens and are still edited in the Theme panel.

    Optional everywhere; a deck with no masthead omits the key entirely (byte-stable). */
export interface HeaderMeta {
    /** A subtitle line under the deck title. */
    subtitle?: string;
    /** Metadata chips (e.g. "5 plants", "Built 2026-06-15", "Q3 2026"). */
    chips?: string[];
    /** Masthead band background, `#rrggbb`. Absent === follow the theme's `chrome`. */
    bg?: string;
    /** Masthead text: the title, the chips and the active tab. Absent === follow `chrome-ink`. */
    ink?: string;
    /** MUTED masthead text: the subtitle and the inactive tabs. `#rrggbb` or `#rrggbbaa` — the
        editor derives it from `ink` at 68% alpha, which is the same mix the Theme panel makes
        `chrome-soft` with. Absent === follow `chrome-soft`. */
    subInk?: string;
    /** Show the brand stamp (the logo) in the band. Absent === true: every deck ever written drew
        the logo unconditionally, so absence has to keep meaning "shown" — only `false` is stored. */
    stamp?: boolean;
}
export interface Manifest {
    v: string;
    id: string;
    title: string;
    created: string;
    modified: string;
    theme: {
        name: string;
        tokens: Record<string, string>;
    };
    /** Optional deck-level masthead content (subtitle + chips). */
    header?: HeaderMeta;
    /** Reading experience; ABSENT === 'deck'. Optional everywhere (byte-stable). */
    foldType?: FoldType;
    /** Agent-defined composite block definitions, keyed by x.<name>. Absent when the
        deck has no custom blocks (byte-stable). Travels with the Fold so instances stay
        re-editable offline. See block-def.ts. */
    blocks?: Record<string, CompositeBlockDef>;
    order: string[];
    hidden: string[];
    slides: Record<string, SlideMeta>;
    kinds: string[];
    customKinds: string[];
    capabilities: string[];
}
/** Half-open byte range [start, end) into ParsedDeck.text. */
export interface Region {
    start: number;
    end: number;
}
export interface SlideRegion {
    id: string;
    kind: string;
    /** The whole <template ...>...</template> element. */
    element: Region;
    /** Just the content between the open and close tags. */
    inner: Region;
}
export interface ParsedDeck {
    text: string;
    eol: '\n' | '\r\n';
    manifest: Manifest;
    /** Inner JSON text of the manifest script tag. */
    manifestRegion: Region;
    /** Slide template regions in document order. */
    slides: SlideRegion[];
    slideById: Map<string, SlideRegion>;
    /** Asset table (assetId -> data URL); empty when the deck has no assets block. */
    assets: Record<string, string>;
    /** Inner JSON region of the assets script tag; null when the block is absent. */
    assetsRegion: Region | null;
}
export interface Edit {
    start: number;
    end: number;
    replacement: string;
}
export interface Violation {
    rule: string;
    detail: string;
}
export declare class FormatError extends Error {
    constructor(message: string);
}
