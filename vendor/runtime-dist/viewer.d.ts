/** Manifest shape the viewer needs (structurally matches @origami/format's Manifest). */
export interface ViewerManifest {
    v: string;
    id: string;
    title: string;
    order: string[];
    hidden: string[];
    slides: Record<string, {
        kind: string;
        label: string;
        notes: string;
        group?: boolean;
        bg?: string;
    }>;
    /** Reading experience; absent === 'deck' (card-stage). 'scroll' = continuous doc. */
    foldType?: 'deck' | 'scroll' | 'ledger';
    /** embed:<host> tokens — gate for video player iframes. */
    capabilities?: string[];
    /** Deck-level masthead content (subtitle + chips), its layout (whether the stamp shows) and
        the masthead's own colours; bar thickness and the brand-mark tint are still theme tokens. */
    header?: {
        subtitle?: string;
        chips?: string[];
        bg?: string;
        ink?: string;
        subInk?: string;
        stamp?: boolean;
    };
}
export interface Viewer {
    go(i: number): void;
    next(): void;
    prev(): void;
    current(): string;
    setEditMode(on: boolean): void;
    isEditMode(): boolean;
    /** Enter present mode (fullscreen, chrome hidden) — the Studio Present button. */
    present(): void;
    /** Per-slide lite edits: slideId -> [data-oedit] textContents in document order. */
    edits: Map<string, string[]>;
    visibleOrder: string[];
    refreshPrint(): void;
}
export interface ViewerHooks {
    onSaveCopy: () => void;
}
/** Build the viewer inside #origami-root and mount the first slide.
    Slides render full-bleed (fluid, 100vh scenes) — the deck reads as an
    editorial document, not a slide rectangle in a frame. Fixed geometry
    exists only in the print container.
    INVARIANT: this module performs zero network requests and zero storage writes. */
export declare function createViewer(manifest: ViewerManifest, hooks: ViewerHooks, assets?: Record<string, string>): Viewer;
