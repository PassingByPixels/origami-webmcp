import type { Violation } from './types.js';
/**
 * draw — a freehand drawing block (the Excalidraw-style sketch surface), carried
 * as an inert JSON block (data-odata="draw"), same carrier rules as flow/graph:
 * the serializer escapes every "<" and validateSlideContent enforces the literal
 * script form.
 *
 * A scene is a flat array of elements in UNBOUNDED scene coordinates; the
 * renderer fits the bounding box of all elements into the block, so a drawing
 * never needs a canvas size saved with it. Every element carries its own `seed`
 * so the hand-drawn jitter renders identically on every open (deterministic,
 * dependency-free SVG — no rough.js, MV3 + file:// forbid remote code).
 */
export declare const DRAW_MAX_ELEMENTS = 200;
export declare const DRAW_MAX_POINTS = 1200;
export declare const DRAW_TEXT_MAX = 2000;
export declare const DRAW_TYPES: readonly ["rect", "diamond", "ellipse", "arrow", "line", "freedraw", "text"];
export declare const DRAW_FILL_STYLES: readonly ["none", "hachure", "cross", "solid"];
export declare const DRAW_STROKE_STYLES: readonly ["solid", "dashed", "dotted"];
export declare const DRAW_FONTS: readonly ["playfair", "lora", "inter", "source-serif", "caveat"];
export declare const DRAW_TEXT_ALIGNS: readonly ["left", "center", "right"];
export type DrawType = (typeof DRAW_TYPES)[number];
export type DrawFillStyle = (typeof DRAW_FILL_STYLES)[number];
export type DrawStrokeStyle = (typeof DRAW_STROKE_STYLES)[number];
export type DrawFont = (typeof DRAW_FONTS)[number];
/** [dx, dy] relative to the element's x/y — arrow/line/freedraw only. */
export type DrawPoint = [number, number];
export interface DrawElement {
    id: string;
    /** Optional human/agent-readable label ("database box") — lets a follow-up
        prompt address an element by meaning instead of coordinates. */
    name?: string;
    type: DrawType;
    /** Scene coordinates (unbounded); for point types this is the first point. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Degrees clockwise, default 0. */
    angle?: number;
    /** Outline / ink colour, #hex. */
    stroke: string;
    /** Background colour, "" (none) or #hex. Ignored for freedraw/text. */
    fill?: string;
    /** default "hachure" — the hand-drawn diagonal fill. */
    fillStyle?: DrawFillStyle;
    /** 1-8, default 2. */
    strokeWidth?: number;
    /** default "solid". */
    strokeStyle?: DrawStrokeStyle;
    /** 0 (clean) | 1 (sketchy) | 2 (loose), default 1. */
    roughness?: number;
    /** 0-100, default 100. */
    opacity?: number;
    /** Jitter seed, int 1..2^31-1 — same seed, same drawing, every open. */
    seed?: number;
    /** arrow/line/freedraw only; renderer treats points as authoritative over width/height. */
    points?: DrawPoint[];
    /** arrow/line only. When set, the arrow's first/last point stays glued to the
        named element's border: moving either party re-points the arrow. */
    attach?: {
        from?: string;
        to?: string;
    };
    /** text only. "\n" breaks lines. */
    text?: string;
    /** Scene units, 6-200, default 16. */
    fontSize?: number;
    /** default "inter". */
    font?: DrawFont;
    /** default "left" (multi-line alignment). */
    textAlign?: (typeof DRAW_TEXT_ALIGNS)[number];
}
export interface DrawData {
    /**
     * Canvas size in scene units. The drawing surface is FIXED at this size —
     * it never refits to the content (a UAT call: the rebounding canvas made
     * drawing impossible). Absent on legacy scenes, which keep the fitted
     * behaviour; the editor stamps a default on first edit.
     */
    w?: number;
    h?: number;
    /** Layout width as a percent of the column (10-100, default 100). The width
        grip changes THIS — the block gets more room without rescaling the ink. */
    wpct?: number;
    /** Stroke-replay entrance order: element ids, first drawn first. Ids not
        listed replay in z-order after the listed ones. Absent = drawing order. */
    replayOrder?: string[];
    /** false disables the stroke-replay entrance entirely. */
    replay?: boolean;
    elements: DrawElement[];
}
/** Strict shape check for a draw data block. REJECT, never repair. */
export declare function validateDrawData(data: unknown): Violation[];
/** Serialize for embedding — "<" escaped (same invariant as flowDataJson). */
export declare function drawDataJson(data: DrawData): string;
