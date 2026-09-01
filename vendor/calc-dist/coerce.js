import { err, isErr } from './errors.js';
export const isRange = (a) => Array.isArray(a);
/** A single arg as a 1D list of cell values (a scalar becomes a one-element list). */
export const asRow = (a) => a === undefined ? [] : isRange(a) ? a.flat() : [a];
/** A single arg collapsed to one scalar (top-left cell of a range). */
export const scalar = (a) => a === undefined ? '' : isRange(a) ? a[0]?.[0] ?? '' : a;
/** All args flattened to a single 1D list of cell values (ranges expanded). */
export function flatten(args) {
    const out = [];
    for (const a of args) {
        if (isRange(a)) {
            for (const row of a)
                for (const c of row)
                    out.push(c);
        }
        else
            out.push(a);
    }
    return out;
}
export function firstErr(vals) {
    for (const v of vals)
        if (isErr(v))
            return v;
    return null;
}
/** Lenient numeric collection for aggregates: numbers + numeric strings + booleans
    are kept; blank + non-numeric text are skipped; an error operand propagates. */
export function collectNums(args) {
    const vals = flatten(args);
    const e = firstErr(vals);
    if (e)
        return e;
    const nums = [];
    for (const v of vals) {
        if (typeof v === 'number')
            nums.push(v);
        else if (typeof v === 'boolean')
            nums.push(v ? 1 : 0);
        else if (typeof v === 'string') {
            const s = v.trim();
            if (s !== '') {
                const n = Number(s);
                if (Number.isFinite(n))
                    nums.push(n);
            }
        }
    }
    return nums;
}
/** Strict numeric coercion for arithmetic: blank->0, numeric string->n, bool->1/0,
    non-numeric text-> #VALUE!. Errors propagate. */
export function toNum(v) {
    if (isErr(v))
        return v;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    const s = v.trim();
    if (s === '')
        return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : err('#VALUE!');
}
export function toStr(v) {
    if (isErr(v))
        return v;
    if (typeof v === 'string')
        return v;
    if (typeof v === 'boolean')
        return v ? 'TRUE' : 'FALSE';
    return formatNumber(v);
}
export function toBool(v) {
    if (isErr(v))
        return v;
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    const s = v.trim().toUpperCase();
    if (s === '')
        return false;
    if (s === 'TRUE')
        return true;
    if (s === 'FALSE')
        return false;
    const n = Number(s);
    if (Number.isFinite(n))
        return n !== 0;
    return err('#VALUE!');
}
/** Locale-free number formatting that trims float noise (NO toLocaleString) — the
    determinism anchor that keeps a bake byte-stable. */
export function formatNumber(n) {
    if (!Number.isFinite(n))
        return '#VALUE!';
    const r = Math.round(n * 1e10) / 1e10;
    return Object.is(r, -0) ? '0' : String(r);
}
/** The baked display string for any computed value. */
export function formatValue(v) {
    if (isErr(v))
        return v.code;
    if (typeof v === 'number')
        return formatNumber(v);
    if (typeof v === 'boolean')
        return v ? 'TRUE' : 'FALSE';
    return v;
}
/** Match a cell value against a SUMIF/COUNTIF criterion ("=x" | "<>x" | ">10" |
    "<=3" | plain text/number). Comparison is numeric when both sides are numeric,
    else case-insensitive string. */
export function matchCriterion(value, criterion) {
    if (isErr(value) || isErr(criterion))
        return false;
    let op = '=';
    let rhs = typeof criterion === 'string' ? criterion : formatValue(criterion);
    const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(rhs);
    if (m) {
        op = m[1];
        rhs = m[2];
    }
    const rn = Number(rhs.trim());
    const vn = typeof value === 'number' ? value : Number(String(value).trim());
    const bothNum = Number.isFinite(rn) && Number.isFinite(vn) && String(value).trim() !== '';
    let cmp;
    if (bothNum)
        cmp = vn < rn ? -1 : vn > rn ? 1 : 0;
    else {
        const vs = String(typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value).trim().toLowerCase();
        const rs = rhs.trim().toLowerCase();
        cmp = vs < rs ? -1 : vs > rs ? 1 : 0;
    }
    switch (op) {
        case '=': return cmp === 0;
        case '<>': return cmp !== 0;
        case '<': return cmp < 0;
        case '<=': return cmp <= 0;
        case '>': return cmp > 0;
        case '>=': return cmp >= 0;
    }
    return false;
}
