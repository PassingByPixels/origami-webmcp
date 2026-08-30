import type { KindBehaviour, RuntimeBlock, SweepCtx } from './types.js';
/** Every runtime-layer block facet. Order is load-bearing for the three projections
    below: the slide facets reproduce the historical KIND_BEHAVIOURS order (cover…
    document), the clone sweep runs chart→video, the stage sweep runs table→grid→
    tracker→notes — exactly the pre-refactor viewer.ts call order. Adding a block =
    add its facet here (+ its render module); no edit to viewer.ts. Composite `block`
    has no entry — it renders as pre-baked inert HTML with no runtime mount. */
export declare const RUNTIME_BLOCKS: RuntimeBlock[];
/** Slide-kind dispatch table — the DERIVED VIEW consumed by mountKind/finalizeKind
    (kinds.ts). Keyed lookup, so order is not behaviourally observed, but it mirrors
    the historical 8-entry order for the characterization freeze. */
export declare const KIND_BEHAVIOURS: Record<string, KindBehaviour>;
/** cloneSlide sweep: chart/video, mounted for both the live stage and the print clone
    (forPrint-aware). Runs AFTER resolveAssetRefs on the base clone. */
export declare function mountCloneBlocks(slide: HTMLElement, ctx: SweepCtx): void;
/** Live-stage sweep: the interactive in-slide blocks (tables/grids/trackers/notes).
    The viewer runs resolveAssetRefs AFTER this — notes inject <img data-oasset>. */
export declare function mountStageBlocks(slide: HTMLElement, ctx: SweepCtx): void;
/** Print sweep: static finalize of the stage blocks (resolveAssetRefs runs after). */
export declare function finalizeStageBlocks(slide: HTMLElement, ctx: SweepCtx): void;
