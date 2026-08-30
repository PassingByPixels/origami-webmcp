import { type Manifest, type ParsedDeck, type Violation } from './types.js';
export declare const CAPABILITY_RE: RegExp;
/** Manifest schema checks (hand-rolled; the format is small enough not to need a schema lib). */
export declare function validateManifest(m: Manifest): Violation[];
/** The ONLY shape a masthead colour may take: `#rrggbb`, or `#rrggbbaa` for the derived
    subtitle ink (the editor bakes the Theme panel's 68% `chrome-soft` mix as an alpha).
    The viewer puts these straight into an inline custom property, and a custom property
    takes almost anything — including a `url()` that would fetch from the network out of a
    deck that promises never to. So the shape is the gate, here and at the viewer. */
export declare const HEADER_HEX: RegExp;
/**
 * Manifest↔DOM cross-checks (F27): id bijection and kind agreement between the
 * manifest and the template attributes. Politeness comments don't bind AI output;
 * this does.
 */
export declare function validateCrossConsistency(deck: ParsedDeck): Violation[];
/** Asset-table checks: values must be data:image URLs (reserved font-* slots
    additionally accept embedded fonts — data:font/woff2|woff|ttf|otf, so a user can bring
    their own brand font); every data-oasset reference in slide content must resolve. */
export declare function validateAssets(deck: ParsedDeck): Violation[];
/** Data-driven kinds. Placement 'slide' = a whole-slide kind: exactly one
    block on slides OF that kind, none anywhere else. Placement 'block' = an
    in-slide block: any number, on any slide. */
export interface KindDataSpec {
    placement: 'slide' | 'block';
    validate: (data: unknown) => Violation[];
    /** Manifest capability this data needs (called on valid data only); the deck
        must declare it or validation flags the block. null = none needed. */
    capability?: (data: unknown) => string | null;
}
/** DERIVED VIEW of the block registry: each spec IS the facet's `data` object
    (same reference — so KIND_DATA_SPECS.gantt.validate === validateGanttData, etc.).
    table/tracker/grid/etc. are BLOCKS (insertable into any fold, like chart) — not
    whole-fold kinds; block placement validates the data wherever it sits + any count,
    so a legacy deck carrying one as a slide-kind still validates. The composite `block`
    facet is shape-only; validateKindData runs the full registry-aware check inline. */
export declare const KIND_DATA_SPECS: Record<string, KindDataSpec>;
/** Kind data blocks (script[data-odata]): JSON must parse; slide-placement
    kinds carry exactly one block on their own slide and none elsewhere;
    block-placement kinds validate wherever they appear. Unregistered kinds are
    rejected outright (F27 spirit — confused output, not tolerated). */
export declare function validateKindData(deck: ParsedDeck): Violation[];
export declare function validateDeck(deck: ParsedDeck): Violation[];
