import type { Violation } from './types.js';
export type VennCount = 2 | 3 | 4 | 5 | 6;
export declare const VENN_MAX_CIRCLES = 6;
/** Per-label text scale: a multiplier on the kind's base font size. Absent = 1. The author
    sets it by dragging the label; the renderer may shrink further to keep a word whole, but
    it never writes that back — this is the author's intent, not the fitted result. */
export declare const VENN_SIZE_MIN = 0.5;
export declare const VENN_SIZE_MAX = 2;
/** How far a label may be nudged off its natural point, in viewBox units, on each axis. A set
    label's natural point is its circle's lobe; an overlap's is its own x/y. The nudge is kept
    SEPARATE from an overlap's x/y on purpose: x/y says which region the label belongs to (it is
    what the region hit-test reads), the nudge only says where its text sits. */
export declare const VENN_NUDGE_MAX = 60;
export interface VennSet {
    label: string;
    /** Fill colour #hex — the circle body. */
    color: string;
    /** Label text scale, 0.5–2. Omitted when 1. */
    size?: number;
    /** Label nudge in viewBox units, ±60. Omitted when 0. */
    dx?: number;
    dy?: number;
}
export interface VennOverlap {
    /** The circle indices this intersection is made of (≥2, unique, sorted by the editor). */
    sets: number[];
    label: string;
    /** Label position, percent of the viewBox (0–100). */
    x: number;
    y: number;
    /** Label text scale, 0.5–2. Omitted when 1. */
    size?: number;
    /** Label nudge in viewBox units, ±60. Omitted when 0. */
    dx?: number;
    dy?: number;
}
export interface VennData {
    count: VennCount;
    sets: VennSet[];
    overlaps?: VennOverlap[];
}
/** Strict shape check. REJECT, never repair. */
export declare function validateVennData(data: unknown): Violation[];
/** Serialize for the inert script block — every "<" escaped. */
export declare function vennDataJson(data: VennData): string;
