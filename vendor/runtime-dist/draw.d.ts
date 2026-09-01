import { type DrawData, type DrawPoint } from '@origami/format';
/** Deterministic PRNG — pure integer math, identical output on every engine. */
export declare function mulberry32(seed: number): () => number;
/** A hand-drawn stroke between two points: one pass at roughness 0, two
    offset passes otherwise (the double-stroke pencil look). */
export declare function sketchyLine(x1: number, y1: number, x2: number, y2: number, rand: () => number, jit: number, overshoot?: number): string[];
/** Catmull-Rom smoothing through points → cubic bezier path (freedraw ink). */
export declare function smoothPath(pts: DrawPoint[]): string;
/** Ramer-Douglas-Peucker — keep the ink, drop the redundant samples. */
export declare function simplifyPoints(pts: DrawPoint[], epsilon?: number): DrawPoint[];
/** Parallel hatch lines clipped to a polygon by scanline intersection. */
export declare function hachureLines(poly: DrawPoint[], angleDeg: number, gap: number, rand: () => number, jit: number): string[];
export interface SceneBox {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** Bounding box of everything drawn, padded for ink. Null for an empty scene. */
export declare function sceneBounds(data: DrawData): SceneBox | null;
/** Build the whole scene as one static SVG (viewer render AND editor preview).
    A scene with a saved canvas size (w/h) renders on that FIXED canvas — the
    viewBox never refits to the content (UAT: a rebounding canvas is unusable).
    Legacy scenes without one keep the fitted-bounds behaviour. */
export declare function drawSceneSvg(data: DrawData): SVGSVGElement;
export declare function normalizeDrawData(raw: unknown): DrawData;
/** Render one drawing into its figure's mount. Idempotent. */
export declare function renderDraw(figure: HTMLElement, data: DrawData): void;
/** Honour the author's width grip (wpct) and height grip (scene w×h → aspect) on
    every surface. Present/print remount from JSON and never see the editor's live
    style, so this has to run here — not only in the editor render(). */
export declare function applyDrawLayout(figure: HTMLElement, mount: HTMLElement, data: DrawData): void;
/** Sweep a slide for draw blocks and render each. Static SVGs are already
    final, so finalize is the same sweep (mirror of mountFlows). Idempotent. */
export declare function mountDraws(slide: Element): void;
export declare const finalizeDraws: typeof mountDraws;
/** Redraw the scene in front of the audience: every element's ink wipes itself
    in (stroke-dashoffset from full length to 0), elements staggered in z-order.
    Dashed/dotted strokes keep their dasharray, so they fade instead; text fades
    at its slot. One-shot per mount — Present re-mounts a slide on entry, so
    each entry replays. Skipped under prefers-reduced-motion. */
export declare function replayDrawInks(svg: SVGSVGElement, order?: string[]): void;
/** Arm replay on every draw figure of a slide: fires when the slide gains
    `.is-shown` (Present) or `.is-revealed` (scroll), once per arming.
    NOTE: the mode guard (o-present / .o-scroll) is checked INSIDE fire(),
    not at the top, because boot.ts calls createViewer() then viewer.present()
    — on slide 0 the o-present class does not exist yet when this function
    runs, so an early return would skip the observer setup and the first slide
    would never replay (draw-042 UAT finding). */
export declare function armDrawReplay(slide: Element): void;
