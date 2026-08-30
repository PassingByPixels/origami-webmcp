import { type VennCount, type VennData } from '@origami/format';
/** Lenient normalize — junk degrades, never throws. Always returns 2–6 sets. */
export declare function normalizeVennData(raw: unknown): VennData;
/** One circle's placement: centre, radius, and the exclusive-lobe spot its own label sits in. */
interface Place {
    cx: number;
    cy: number;
    r: number;
    lx: number;
    ly: number;
}
/** The viewBox for a given circle count (2–3 keep the compact 400×280; 4–6 grow taller). */
export declare function vennViewBox(count: VennCount): {
    w: number;
    h: number;
};
/** Circle layout: 2 side-by-side, 3 in a triangle, 4–6 on a symmetric ring. */
export declare function vennLayout(count: VennCount): Place[];
/** Which circle indices contain a viewBox point (x, y) — the click-to-name hit test. */
export declare function vennContainingSets(data: VennData, x: number, y: number): number[];
/** A stable key for an overlap: its circle indices, sorted. */
export declare const vennOverlapKey: (sets: number[]) => string;
/** Word-wrap `text` into lines that each fit `maxWidth` viewBox units at `fontSize`.
    Splits on spaces first; a single over-long word is then broken at character boundaries
    so nothing ever overflows its segment. Deterministic — no DOM measurement. */
export declare function wrapVennLabel(text: string, fontSize: number, maxWidth: number): string[];
/** Merge the named overlaps whose keys are in `keys` into one: union of their sets,
    label centred at the centroid, position at the centroid. Requires 2+ matching
    overlaps, else returns `data` unchanged (nothing to merge). */
export declare function mergeVennOverlaps(data: VennData, keys: string[], label: string): VennData;
/** Build the static SVG for one Venn diagram. Pure DOM construction.
    `selected` (optional, editor-only) highlights those overlap keys. */
export declare function vennSceneSvg(data: VennData, selected?: ReadonlySet<string>): SVGSVGElement;
/** Render one diagram into its figure mount. Idempotent. */
export declare function renderVenn(figure: HTMLElement, data: VennData, selected?: ReadonlySet<string>): void;
/** Sweep a slide for venn blocks and render each. Static SVGs are already final,
    so finalize is the same sweep. Idempotent. */
export declare function mountVenns(slide: Element): void;
export declare const finalizeVenns: typeof mountVenns;
export declare function parseVennSlideData(root: Element): VennData | null;
export {};
