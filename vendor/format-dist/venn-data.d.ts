import type { Violation } from './types.js';
export type VennCount = 2 | 3 | 4 | 5 | 6;
export declare const VENN_MAX_CIRCLES = 6;
export interface VennSet {
    label: string;
    /** Fill colour #hex — the circle body. */
    color: string;
}
export interface VennOverlap {
    /** The circle indices this intersection is made of (≥2, unique, sorted by the editor). */
    sets: number[];
    label: string;
    /** Label position, percent of the viewBox (0–100). */
    x: number;
    y: number;
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
