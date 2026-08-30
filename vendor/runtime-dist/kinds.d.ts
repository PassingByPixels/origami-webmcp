/** Core slide behaviours + the slide-kind dispatch. The deck IIFE and the Studio
    sandbox canvas both import these — never two implementations of a kind.

    KIND_BEHAVIOURS (the slide-kind mount/finalize table) is now the slide-facet
    VIEW of RUNTIME_BLOCKS (./blocks); mountKind/finalizeKind dispatch through it.
    The count-up + sparkline sweeps below are CORE behaviours (not per-kind),
    applied to every slide alongside the in-slide block sweeps in ./blocks. */
import { KIND_BEHAVIOURS } from './blocks/registry.js';
import type { KindBehaviour } from './blocks/types.js';
export { KIND_BEHAVIOURS };
export type { KindBehaviour };
/** Count-ups are core block behaviour, swept on EVERY slide kind (like
    mountCharts) — a stat card behaves identically wherever it sits. */
export declare function mountCountUps(slide: HTMLElement): void;
export declare function finalizeCountUps(slide: HTMLElement): void;
export declare function mountSparklines(slide: HTMLElement): void;
export declare function finalizeSparklines(slide: HTMLElement): void;
export declare function mountKind(kind: string, slide: HTMLElement): void;
export declare function finalizeKind(kind: string, slide: HTMLElement): void;
