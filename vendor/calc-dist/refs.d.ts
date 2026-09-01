/** A1 cell-reference helpers. Columns are 1-based letters (A=1); internally we use
    0-based {r,c}. `$`-anchors are accepted and stripped (v1 has no fill, so anchors
    don't change single-cell evaluation). */
export declare function colToNum(letters: string): number;
export declare function numToCol(n: number): string;
/** A1 -> {r,c} 0-based, or null if malformed. */
export declare function a1ToRC(a1: string): {
    r: number;
    c: number;
} | null;
export declare function rcToA1(r: number, c: number): string;
export declare function isA1(s: string): boolean;
/** Strip `$` anchors -> canonical A1 (e.g. "$B$3" -> "B3"). */
export declare function normA1(a1: string): string;
/** Expand A1:B3 to the row-major list of A1 addresses, or null if either end is malformed. */
export declare function expandRange(a: string, b: string): string[] | null;
