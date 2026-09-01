/* Shared PURE helpers for the ledger `table` kind — the A1 address math, value predicates, cell-format
   lookup, grid extent, and the Σ-aggregate reducer. Used IDENTICALLY by the live EDITOR
   (studio-core/canvas-table.ts) and the inert VIEWER (runtime/table.ts); extracted here so one
   behaviour lives in one place instead of two hand-mirrored copies (the "fix it in two files" tax).

   MUST stay @origami/calc-free: the viewer imports this, and the R3 build-grep forbids the calc engine
   in the distributed viewer IIFE. This file only ADDRESSES and DISPLAYS cells — it never evaluates a
   formula. */
/** A plain A1 cell address: one-or-more column letters + a 1-based row number. */
export const A1_RE = /^([A-Z]+)([0-9]+)$/;
/** Column index (0-based) -> its A1 letters. `0`->"A", `26`->"AA". */
export const colA1 = (c) => {
    let s = '', n = c + 1;
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
};
/** {r,c} (0-based) -> A1 address (`0,0`->"A1"). */
export const a1 = (r, c) => colA1(c) + (r + 1);
/** A1 letters -> column index (0-based). Inverse of colA1; uppercases so a user-typed `a1` still resolves. */
export function colIdx(letters) {
    let c = 0;
    for (const ch of letters.toUpperCase())
        c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
}
/** {r,c} of an A1 key, or null when it isn't a plain A1 address. */
export function a1ToRC(key) {
    const m = A1_RE.exec(key);
    return m ? { r: parseInt(m[2], 10) - 1, c: colIdx(m[1]) } : null;
}
/** An A1 RANGE ("A1:C10") → an inclusive 0-based rect {r0,c0,r1,c1}, ends NORMALIZED so a reversed
    range ("C10:A1") reads the same. A bare cell ("A1") → a 1×1 rect. Returns null when either end
    isn't a plain A1 address (or the string has >1 colon). Pure addressing — never touches values. */
export function a1RangeToRect(range) {
    const parts = range.trim().split(':');
    if (parts.length < 1 || parts.length > 2)
        return null;
    const a = a1ToRC(parts[0].trim());
    const b = a1ToRC((parts[1] ?? parts[0]).trim());
    if (!a || !b)
        return null;
    return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}
/** A baked cell string reads as a NUMBER (locale-free). */
export const isNumeric = (s) => s.trim() !== '' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim());
/** A baked cell string is an ERROR value (`#DIV/0!` etc.) — a leading '#'. */
export const isErrStr = (s) => s.charCodeAt(0) === 35;
/** Trim float noise off an aggregate before display (locale-free). */
export const trimNum = (n) => String(Math.round(n * 1e6) / 1e6);
/** A ledger fill-ramp TOKEN name ("fill-forest" / "fill-3") — re-colours when the doc is re-themed. */
export const FILL_TOKEN = /^fill-[a-z0-9-]{1,27}$/;
/** A raw custom fill colour — a #rgb / #rrggbb hex (fixed; does NOT re-theme). The strict shape means a
    validated fill can never inject anything but a colour when the viewer applies it inline. */
export const FILL_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** A cell fill is EITHER a theme token (re-themes) or a raw hex colour (fixed). */
export const isFill = (s) => FILL_TOKEN.test(s) || FILL_HEX.test(s);
/** The effective display format for a cell — a per-cell override beats the column's format. Structural
    over both the editor's TableData and the viewer's Ledger (both carry cellFormats + columns[].format). */
export function fmtAt(d, r, c) {
    return d.cellFormats?.[a1(r, c)] ?? d.columns[c]?.format;
}
/** The widest content extent — max of columns.length and every row's length. Scanning over THIS (not
    columns.length) is what keeps a wide/hidden cell (a row longer than the columns array) from being missed. */
export function gridWidth(d) {
    return d.rows.reduce((m, r) => Math.max(m, r.length), d.columns.length);
}
/** Apply an aggregate FN over an already-gathered numeric list — the shared SUM/AVG/MIN/MAX/COUNT reducer
    behind both the editor's Σ footer and the viewer's. reduce (never Math.min(...spread)) so a
    pathologically large column can't blow the call stack. Returns null for an empty list. */
export function aggregateNumbers(fn, nums) {
    if (!nums.length)
        return null;
    if (fn === 'COUNT')
        return { fn, text: String(nums.length) };
    let v;
    if (fn === 'AVG')
        v = nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (fn === 'MIN')
        v = nums.reduce((a, b) => (b < a ? b : a));
    else if (fn === 'MAX')
        v = nums.reduce((a, b) => (b > a ? b : a));
    else
        v = nums.reduce((a, b) => a + b, 0); // SUM
    return { fn, text: trimNum(v) };
}
/** Parse `merges` (inclusive A1 range strings, e.g. "B2:D3") into normalized rects, dropping any
    malformed or single-cell (1×1) entry. Used IDENTICALLY by the live EDITOR and the inert VIEWER so
    a merge draws the same colspan/rowspan in both. */
export function mergeRects(merges) {
    if (!merges)
        return [];
    const out = [];
    for (const m of merges) {
        const r = a1RangeToRect(m);
        if (r && !(r.r0 === r.r1 && r.c0 === r.c1))
            out.push(r);
    }
    return out;
}
/** The merge rect covering cell (r,c), or null. Its top-left (r0,c0) is the ANCHOR — the only cell a
    merge renders (as a spanning td); the covered cells render nothing. */
export function mergeAt(rects, r, c) {
    for (const m of rects)
        if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1)
            return m;
    return null;
}
/** Two inclusive rects overlap. */
export function rectsOverlap(a, b) {
    return !(a.r1 < b.r0 || a.r0 > b.r1 || a.c1 < b.c0 || a.c0 > b.c1);
}
/** The inclusive A1 range string ("B2:D3") for a rect — the on-the-wire form of one merge. */
export function rectToRange(m) {
    return a1(m.r0, m.c0) + ':' + a1(m.r1, m.c1);
}
/** Grow `rect` until it fully contains every merge it touches — Excel: a selection that clips a merge
    takes the WHOLE merge. Fixpoint (absorbing one merge can reach another). Pure. */
export function expandRectToMerges(rects, rect) {
    let { r0, c0, r1, c1 } = rect;
    for (let changed = true; changed;) {
        changed = false;
        for (const m of rects) {
            if (m.r1 < r0 || m.r0 > r1 || m.c1 < c0 || m.c0 > c1)
                continue; // no overlap
            if (m.r0 < r0) {
                r0 = m.r0;
                changed = true;
            }
            if (m.c0 < c0) {
                c0 = m.c0;
                changed = true;
            }
            if (m.r1 > r1) {
                r1 = m.r1;
                changed = true;
            }
            if (m.c1 > c1) {
                c1 = m.c1;
                changed = true;
            }
        }
    }
    return { r0, c0, r1, c1 };
}
/** Clip merges to a bake crop window [r0..r1]×[c0..c1] for the viewer. A merge whose ANCHOR is inside
    the window renders with its span clipped to the window's far edges; a merge whose anchor is cropped
    out is dropped (its covered cells are empty anyway). Pure. */
export function clipMergesToCrop(rects, r0, c0, r1, c1) {
    const out = [];
    for (const m of rects) {
        if (m.r0 < r0 || m.c0 < c0 || m.r0 > r1 || m.c0 > c1)
            continue; // anchor outside the window → drop
        out.push({ r0: m.r0, c0: m.c0, r1: Math.min(m.r1, r1), c1: Math.min(m.c1, c1) });
    }
    return out;
}
/** Expand a #rgb to #rrggbb; a #rrggbb passes through. */
const hex6 = (s) => (s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s);
/** Linear interpolate two hex colours at t∈[0,1] → a #rrggbb string. Concrete colours only (scale). */
function lerpHex(from, to, t) {
    const a = hex6(from), b = hex6(to);
    const ch = (i) => {
        const av = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
        const bv = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
        const v = Math.round(av + (bv - av) * t);
        return (v < 16 ? '0' : '') + v.toString(16);
    };
    return '#' + ch(0) + ch(1) + ch(2);
}
/** Evaluate conditional-format rules over a BAKED value grid → per-cell {fill?,color?} overlays keyed
    by A1. PURE + calc-free (value comparisons + a hex interpolator; never a formula). Used IDENTICALLY
    by the editor and the inert viewer, evaluated against the FULL sheet (the viewer then windows the
    render to its crop). Semantics: numeric comparisons (gt/lt/top/bot/scale) consider ONLY numeric
    cells; dupes compares normalized (trimmed, case-sensitive) strings; eq compares to `text` — NUMERIC
    equality when `text` parses as a number (so only numeric cells can match a numeric target), else a
    trimmed CASE-INSENSITIVE string compare (Excel's "Equal To" quick rule ignores case); empty cells
    never match; merged COVERED cells are skipped (they hold no value); ties in top/bot all match; a
    single-value scale range resolves to the `to` colour. When two rules paint the same cell+channel,
    the LATER rule wins. Rows beyond the grid contribute nothing (the range is clamped to the value
    grid, so a hostile/oversized range can never loop past the data). */
export function evaluateCondFmt(values, rules, merges) {
    const out = new Map();
    if (!rules || !rules.length)
        return out;
    const rects = merges ?? [];
    const covered = (r, c) => {
        for (const m of rects)
            if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1 && !(m.r0 === r && m.c0 === c))
                return true;
        return false;
    };
    const put = (r, c, fill, color) => {
        if (!fill && !color)
            return;
        const key = a1(r, c);
        const cur = out.get(key) ?? {};
        if (fill)
            cur.fill = fill;
        if (color)
            cur.color = color;
        out.set(key, cur);
    };
    for (const rule of rules) {
        const rect = a1RangeToRect(rule.range);
        if (!rect)
            continue;
        // gather the range's live (non-covered, in-grid) cells once
        const cells = [];
        const rEnd = Math.min(rect.r1, values.length - 1);
        for (let r = rect.r0; r <= rEnd; r++) {
            const row = values[r];
            if (!row)
                continue;
            const cEnd = Math.min(rect.c1, row.length - 1);
            for (let c = rect.c0; c <= cEnd; c++) {
                if (covered(r, c))
                    continue;
                cells.push({ r, c, s: row[c] ?? '' });
            }
        }
        if (rule.kind === 'dupes') {
            const counts = new Map();
            for (const cell of cells) {
                const s = cell.s.trim();
                if (s !== '')
                    counts.set(s, (counts.get(s) ?? 0) + 1);
            }
            for (const cell of cells) {
                const s = cell.s.trim();
                if (s !== '' && (counts.get(s) ?? 0) >= 2)
                    put(cell.r, cell.c, rule.fill, rule.color);
            }
        }
        else if (rule.kind === 'eq') {
            const target = (rule.text ?? '').trim();
            if (target === '')
                continue;
            // a NUMERIC target only ever matches a numeric cell (numeric equality, so "5"/"5.0"/" 5 " all
            // match 5); a TEXT target matches by trimmed, CASE-INSENSITIVE string compare (Excel semantics).
            const targetIsNum = isNumeric(target);
            const numTarget = targetIsNum ? Number(target) : 0;
            const targetLower = target.toLowerCase();
            for (const cell of cells) {
                const s = cell.s.trim();
                if (s === '')
                    continue; // empty cells never match
                const match = targetIsNum ? (isNumeric(s) && Number(s) === numTarget) : s.toLowerCase() === targetLower;
                if (match)
                    put(cell.r, cell.c, rule.fill, rule.color);
            }
        }
        else if (rule.kind === 'gt' || rule.kind === 'lt') {
            const th = rule.value ?? 0;
            for (const cell of cells) {
                if (!isNumeric(cell.s))
                    continue;
                const v = Number(cell.s);
                if (rule.kind === 'gt' ? v > th : v < th)
                    put(cell.r, cell.c, rule.fill, rule.color);
            }
        }
        else if (rule.kind === 'top' || rule.kind === 'bot') {
            const nums = cells.filter((x) => isNumeric(x.s)).map((x) => Number(x.s));
            if (!nums.length)
                continue;
            const n = Math.max(1, Math.floor(rule.n ?? 1));
            const sorted = nums.slice().sort((x, y) => (rule.kind === 'top' ? y - x : x - y));
            const cutoff = sorted[Math.min(n, sorted.length) - 1];
            for (const cell of cells) {
                if (!isNumeric(cell.s))
                    continue;
                const v = Number(cell.s);
                if (rule.kind === 'top' ? v >= cutoff : v <= cutoff)
                    put(cell.r, cell.c, rule.fill, rule.color);
            }
        }
        else if (rule.kind === 'scale') {
            if (!rule.from || !rule.to)
                continue;
            const nums = cells.filter((x) => isNumeric(x.s)).map((x) => Number(x.s));
            if (!nums.length)
                continue;
            let mn = nums[0], mx = nums[0];
            for (const v of nums) {
                if (v < mn)
                    mn = v;
                if (v > mx)
                    mx = v;
            }
            const span = mx - mn;
            for (const cell of cells) {
                if (!isNumeric(cell.s))
                    continue;
                const t = span === 0 ? 1 : (Number(cell.s) - mn) / span;
                put(cell.r, cell.c, lerpHex(rule.from, rule.to, t));
            }
        }
    }
    return out;
}
