/** A1 cell-reference helpers. Columns are 1-based letters (A=1); internally we use
    0-based {r,c}. `$`-anchors are accepted and stripped (v1 has no fill, so anchors
    don't change single-cell evaluation). */
const A1_RE = /^\$?([A-Z]+)\$?([0-9]+)$/;
export function colToNum(letters) {
    let n = 0;
    for (const ch of letters)
        n = n * 26 + (ch.charCodeAt(0) - 64); // 'A' = 65 -> 1
    return n;
}
export function numToCol(n) {
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}
/** A1 -> {r,c} 0-based, or null if malformed. */
export function a1ToRC(a1) {
    const m = A1_RE.exec(a1);
    if (!m)
        return null;
    return { r: parseInt(m[2], 10) - 1, c: colToNum(m[1]) - 1 };
}
export function rcToA1(r, c) {
    return numToCol(c + 1) + (r + 1);
}
export function isA1(s) {
    return A1_RE.test(s);
}
/** Strip `$` anchors -> canonical A1 (e.g. "$B$3" -> "B3"). */
export function normA1(a1) {
    const rc = a1ToRC(a1);
    return rc ? rcToA1(rc.r, rc.c) : a1;
}
/** Expand A1:B3 to the row-major list of A1 addresses, or null if either end is malformed. */
export function expandRange(a, b) {
    const ra = a1ToRC(a);
    const rb = a1ToRC(b);
    if (!ra || !rb)
        return null;
    const r0 = Math.min(ra.r, rb.r), r1 = Math.max(ra.r, rb.r);
    const c0 = Math.min(ra.c, rb.c), c1 = Math.max(ra.c, rb.c);
    const out = [];
    for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
            out.push(rcToA1(r, c));
    return out;
}
