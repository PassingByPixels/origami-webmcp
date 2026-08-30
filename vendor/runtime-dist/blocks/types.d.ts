/** Runtime-layer block facets. The viewer's mount sweep loops over RUNTIME_BLOCKS
    instead of a hardcoded list, so adding an in-slide block or a slide kind touches
    only its own facet + the registry — never viewer.ts. Imports DOM + @origami/format
    only; NEVER @origami/calc (the R3 firewall). */
/** Slide-kind dispatch hooks — run ONLY when the slide's declared kind === the key
    (mountKind/finalizeKind do the keyed lookup). gantt/flow/graph/document animate;
    cover/bullets/stats/free are inert layouts (empty). */
export interface KindBehaviour {
    /** Animate/wire a freshly mounted slide clone. */
    mount?: (slide: HTMLElement) => void;
    /** Set the slide to its final visual state synchronously (print path). */
    finalize?: (slide: HTMLElement) => void;
}
/** Context threaded to an in-slide block sweep. All optional: stage-phase blocks
    read only `assets` (notes); clone-phase video reads capabilities/forPrint/referrerless. */
export interface SweepCtx {
    /** Asset table for blocks that resolve their own injected images (notes). Absent
        in scroll-mode mount — matching pre-refactor mountContinuous, which passed no
        assets to mountNotes (resolveAssetRefs resolves them afterwards). */
    assets?: Record<string, string>;
    /** Manifest capabilities (embed trust) — read only by clone-phase video. */
    capabilities?: string[];
    /** True on the print/finalize clone — clone-phase video downgrades to a static facade. */
    forPrint?: boolean;
    /** True when the page can't send a Referer (file:// or opaque origin) — referrer-gated video downgrades. */
    referrerless?: boolean;
}
/** How an in-slide block is swept onto every slide (independent of the slide kind). */
export interface RuntimeBlockSweep {
    /** 'clone' = mounted inside cloneSlide for EVERY clone (live stage AND print),
        forPrint-aware, no separate finalize (charts/videos). 'stage' = mounted
        interactively on the live stage, finalized statically for print
        (tables/grids/trackers/notes). */
    phase: 'clone' | 'stage';
    mount: (slide: HTMLElement, ctx: SweepCtx) => void;
    /** Static print render (stage-phase only; clone-phase handles print via ctx.forPrint). */
    finalize?: (slide: HTMLElement, ctx: SweepCtx) => void;
}
/** A runtime block facet: a slide-kind dispatch entry, an in-slide sweep, or both
    absent (composite `block` renders as pre-baked inert HTML — no runtime mount). */
export interface RuntimeBlock {
    key: string;
    slide?: KindBehaviour;
    sweep?: RuntimeBlockSweep;
}
