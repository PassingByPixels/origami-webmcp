export type StackMode = 'cumulative' | 'signed' | 'centred';
export interface StackSeg {
    /** Value-axis coordinate where this segment starts (the previous segment's end). */
    from: number;
    /** Value-axis coordinate where it ends. */
    to: number;
}
/** Segment offsets for ONE category. `values[i]` is series i's contribution. */
export declare function stackSegments(values: number[], mode?: StackMode): StackSeg[];
/** Height of a whole stack. A stacked chart's axis must scale to THIS, not to the largest value. */
export declare function stackTotal(values: number[]): number;
