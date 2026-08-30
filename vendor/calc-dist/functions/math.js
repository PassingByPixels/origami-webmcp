import { err, isErr } from '../errors.js';
import { asRow, collectNums, flatten, matchCriterion, scalar, toNum } from '../coerce.js';
const n1 = (a) => toNum(scalar(a));
/** A 1-or-2 arg numeric function (the 2nd arg optional with a default). */
const fn2 = (f, defB) => (args) => {
    const a = n1(args[0]);
    if (isErr(a))
        return a;
    const b = args[1] === undefined ? defB : n1(args[1]);
    if (isErr(b))
        return b;
    return f(a, b);
};
const fn1 = (f) => (args) => {
    const a = n1(args[0]);
    return isErr(a) ? a : f(a);
};
const roundTo = (x, d, mode) => {
    const p = Math.pow(10, d);
    const y = x * p;
    const r = mode === 'up' ? Math.ceil(Math.abs(y)) * Math.sign(y || 1) : mode === 'down' ? Math.trunc(y) : Math.round(y);
    return r / p;
};
const sumifLike = (args, reduce, emptyIsErr) => {
    const range = asRow(args[0]);
    const crit = scalar(args[1]);
    const sumRange = args[2] === undefined ? range : asRow(args[2]);
    const e1 = range.find(isErr) ?? (isErr(crit) ? crit : undefined) ?? sumRange.find(isErr);
    if (e1)
        return e1;
    const picked = [];
    for (let i = 0; i < range.length; i++) {
        if (matchCriterion(range[i], crit)) {
            const v = toNum(sumRange[i] ?? '');
            if (isErr(v))
                return v;
            picked.push(v);
        }
    }
    if (!picked.length && emptyIsErr)
        return err('#DIV/0!');
    return reduce(picked);
};
export const MATH = {
    SUM: (args) => { const ns = collectNums(args); return isErr(ns) ? ns : ns.reduce((a, b) => a + b, 0); },
    PRODUCT: (args) => { const ns = collectNums(args); return isErr(ns) ? ns : ns.reduce((a, b) => a * b, 1); },
    AVERAGE: (args) => { const ns = collectNums(args); if (isErr(ns))
        return ns; return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : err('#DIV/0!'); },
    MIN: (args) => { const ns = collectNums(args); if (isErr(ns))
        return ns; return ns.length ? Math.min(...ns) : 0; },
    MAX: (args) => { const ns = collectNums(args); if (isErr(ns))
        return ns; return ns.length ? Math.max(...ns) : 0; },
    COUNT: (args) => { const ns = collectNums(args); return isErr(ns) ? ns : ns.length; },
    COUNTA: (args) => {
        const vals = flatten(args);
        const e = vals.find(isErr);
        if (e)
            return e;
        return vals.filter((v) => !(typeof v === 'string' && v.trim() === '')).length;
    },
    ABS: fn1((a) => Math.abs(a)),
    INT: fn1((a) => Math.floor(a)),
    SQRT: fn1((a) => (a < 0 ? err('#VALUE!') : Math.sqrt(a))),
    ROUND: fn2((a, d) => roundTo(a, d, 'round'), 0),
    ROUNDUP: fn2((a, d) => roundTo(a, d, 'up'), 0),
    ROUNDDOWN: fn2((a, d) => roundTo(a, d, 'down'), 0),
    MOD: fn2((a, b) => (b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b)), 1),
    POWER: fn2((a, b) => { const r = Math.pow(a, b); return Number.isFinite(r) ? r : err('#VALUE!'); }, 2),
    CEILING: fn2((a, sig) => (sig === 0 ? 0 : Math.ceil(a / sig) * sig), 1),
    FLOOR: fn2((a, sig) => (sig === 0 ? err('#DIV/0!') : Math.floor(a / sig) * sig), 1),
    SUMIF: (args) => sumifLike(args, (v) => v.reduce((a, b) => a + b, 0), false),
    AVERAGEIF: (args) => sumifLike(args, (v) => v.reduce((a, b) => a + b, 0) / v.length, true),
    COUNTIF: (args) => {
        const range = asRow(args[0]);
        const crit = scalar(args[1]);
        const e = range.find(isErr) ?? (isErr(crit) ? crit : undefined);
        if (e)
            return e;
        return range.filter((v) => matchCriterion(v, crit)).length;
    },
    SUMIFS: (args) => sumifsLike(args, true),
    COUNTIFS: (args) => sumifsLike(args, false),
};
/** SUMIFS(sumRange, critRange1, crit1, [critRange2, crit2, …]) and
    COUNTIFS(critRange1, crit1, …) — AND across all (range, criterion) pairs. */
function sumifsLike(args, isSum) {
    const sumRange = isSum ? asRow(args[0]) : null;
    const pairStart = isSum ? 1 : 0;
    const pairs = [];
    for (let i = pairStart; i + 1 < args.length + 1 && i + 1 <= args.length; i += 2) {
        if (args[i + 1] === undefined)
            break;
        pairs.push({ range: asRow(args[i]), crit: scalar(args[i + 1]) });
    }
    if (!pairs.length)
        return err('#VALUE!');
    const len = pairs[0].range.length;
    let total = 0;
    let count = 0;
    for (let r = 0; r < len; r++) {
        let ok = true;
        for (const p of pairs) {
            if (isErr(p.range[r]))
                return p.range[r];
            if (!matchCriterion(p.range[r], p.crit)) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        if (isSum) {
            const v = toNum(sumRange[r] ?? '');
            if (isErr(v))
                return v;
            total += v;
        }
        else
            count++;
    }
    return isSum ? total : count;
}
