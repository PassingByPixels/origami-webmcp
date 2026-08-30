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
    Breaks at WORD BOUNDARIES ONLY — a word is never cut. It used to fall back to breaking an
    over-wide word at character boundaries, which turned "Them" in a narrow lobe into "The" over
    "m": a word chopped mid-way is not a smaller label, it is a different word. A word too wide
    for its region is handled before we get here (fitVennLabelSize shrinks the label to fit it);
    if it is STILL too wide at the floor, it stays whole and overhangs, which reads.
    Deterministic — no DOM measurement. */
export declare function wrapVennLabel(text: string, fontSize: number, maxWidth: number): string[];
/** The size at which this label's WIDEST WORD fits `maxWidth`, never above `fontSize` and
    never below the floor. estTextWidth is linear in fontSize, so the ratio is exact rather
    than a search. Returns `fontSize` unchanged whenever every word already fits. */
export declare function fitVennLabelSize(text: string, fontSize: number, maxWidth: number): number;
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
