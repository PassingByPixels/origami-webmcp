import type { Violation } from '../types.js';
import type { Kind, Placement } from './kind.js';
/** The data-block facet of a block: how the format layer validates + places its
    inert `<script data-odata>` payload. Absent for pure-layout kinds (cover/
    bullets/stats/free/document, which carry no data block). */
export interface FormatBlockData {
    placement: Placement;
    validate: (data: unknown) => Violation[];
    /** Manifest capability this data needs (called on VALID data only); the deck
        must declare it or validation flags the block. Omitted = none needed. */
    capability?: (data: unknown) => string | null;
}
/** The format-layer facet of a block: its AI-facing contract (name + schema
    comment consumed verbatim by extractChunk) plus, for data-carrying kinds, its
    data spec. Pure and isomorphic — no DOM, no calc — so it is safe to import
    anywhere. `KINDS` and `KIND_DATA_SPECS` are projections of the registry of
    these. */
export interface FormatBlock {
    key: Kind;
    name: string;
    schemaComment: string[];
    data?: FormatBlockData;
}
