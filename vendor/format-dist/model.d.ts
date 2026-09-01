import { type FoldType, type HeaderMeta, type ParsedDeck } from './types.js';
import { type CompositeBlockDef } from './block-def.js';
export interface ModelSlide {
    kind: string;
    label: string;
    notes: string;
    hidden: boolean;
    /** Tucked under the previous fold's header tab in the viewer. */
    group: boolean;
    /** Provenance — who last authored/accepted this chunk (§3). '' when never set. */
    oby: string;
    /** Per-fold background colour override; undefined === the theme default. */
    bg?: string;
    /** Source inner HTML, normalized to the deck's EOL convention. */
    inner: string;
}
export interface DeckModel {
    /** The parse this model splices against (last load or save). */
    base: ParsedDeck;
    title: string;
    order: string[];
    slides: Map<string, ModelSlide>;
    /** assetId -> data URL */
    assets: Map<string, string>;
    /** Manifest capability tokens (embed:<host>) — grown when blocks need them. */
    capabilities: string[];
    /** Theme name + css custom-property tokens. The tokens are truth; a theme
        change re-projects the deck's theme style block at serialize. */
    theme: {
        name: string;
        tokens: Record<string, string>;
    };
    /** Deck-level masthead content (subtitle + chips). Header colours/thickness are
        theme tokens, not here. */
    header: HeaderMeta;
    /** Reading experience; 'deck' (default card-stage) | 'scroll' | 'ledger'. */
    foldType: FoldType;
    /** Agent-defined composite block definitions (x.<name> -> def); empty when none. */
    blocks: Record<string, CompositeBlockDef>;
    /** Slides removed by ops since base — never inferred, so stray templates
        outside the manifest are left untouched rather than silently deleted. */
    removed: Set<string>;
}
export type Op = {
    t: 'slide.insert';
    id: string;
    index: number;
    kind: string;
    label: string;
    inner: string;
    notes?: string;
    hidden?: boolean;
    group?: boolean;
    oby?: string;
    bg?: string;
} | {
    t: 'slide.remove';
    id: string;
} | {
    t: 'slide.move';
    id: string;
    to: number;
} | {
    t: 'slide.meta';
    id: string;
    patch: {
        label?: string;
        notes?: string;
        hidden?: boolean;
        group?: boolean;
        oby?: string;
        bg?: string | null;
    };
} | {
    t: 'slide.inner';
    id: string;
    inner: string;
} | {
    t: 'deck.title';
    title: string;
} | {
    t: 'deck.caps';
    capabilities: string[];
} | {
    t: 'deck.theme';
    name: string;
    tokens: Record<string, string>;
} | {
    t: 'deck.header';
    header: HeaderMeta;
} | {
    t: 'deck.foldType';
    foldType: FoldType;
} | {
    t: 'deck.blocks';
    blocks: Record<string, CompositeBlockDef>;
} | {
    t: 'asset.put';
    id: string;
    dataUrl: string;
} | {
    t: 'asset.remove';
    id: string;
}
/** Several ops as one undo step (e.g. asset.put + the slide.inner that references it). */
 | {
    t: 'batch';
    ops: Op[];
};
export declare function buildModel(deck: ParsedDeck): DeckModel;
/** Apply one op in place; returns the inverse op. Throws FormatError on invalid input. */
export declare function applyOp(model: DeckModel, op: Op): Op;
export interface SerializeOptions {
    /** Stamp manifest.modified (the save path). Omit for byte-stable serialization:
        a model with no effective changes returns its base text byte-identical. */
    now?: string;
}
export declare function serializeModel(model: DeckModel, opts?: SerializeOptions): string;
/** Structural equality of two models (base text excluded). */
export declare function modelEquals(a: DeckModel, b: DeckModel): boolean;
export interface HistoryEntry {
    op: Op;
    inverse: Op;
    at: number;
    coalesce?: string;
}
/**
 * Bounded undo/redo. Typing bursts coalesce: pushes with the same coalesce key
 * within `coalesceMs` update the entry's redo op but keep the original inverse —
 * one undo step per burst. Timestamps are injected (no Date.now in this lib).
 */
export declare class History {
    private cap;
    private coalesceMs;
    private undoStack;
    private redoStack;
    constructor(cap?: number, coalesceMs?: number);
    push(op: Op, inverse: Op, at: number, coalesce?: string): void;
    /** Pop the newest entry for undoing; the entry moves to the redo stack. */
    undo(): HistoryEntry | null;
    redo(): HistoryEntry | null;
    canUndo(): boolean;
    canRedo(): boolean;
    clear(): void;
    depth(): {
        undo: number;
        redo: number;
    };
    /** Rough memory footprint — the F26 heap test asserts image bytes aren't duplicated per step. */
    approxBytes(): number;
}
