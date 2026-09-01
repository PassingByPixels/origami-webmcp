import { err, isErr } from '../errors.js';
import { flatten, scalar, toNum, toStr } from '../coerce.js';
const s1 = (a) => toStr(scalar(a));
const intArg = (a, def) => a === undefined ? def : toNum(scalar(a));
const concat = (args) => {
    let out = '';
    for (const v of flatten(args)) {
        const s = toStr(v);
        if (isErr(s))
            return s;
        out += s;
    }
    return out;
};
export const TEXT = {
    CONCAT: concat,
    CONCATENATE: concat,
    LEN: (args) => { const s = s1(args[0]); return isErr(s) ? s : s.length; },
    UPPER: (args) => { const s = s1(args[0]); return isErr(s) ? s : s.toUpperCase(); },
    LOWER: (args) => { const s = s1(args[0]); return isErr(s) ? s : s.toLowerCase(); },
    TRIM: (args) => { const s = s1(args[0]); return isErr(s) ? s : s.replace(/\s+/g, ' ').trim(); },
    PROPER: (args) => { const s = s1(args[0]); return isErr(s) ? s : s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); },
    LEFT: (args) => { const s = s1(args[0]); if (isErr(s))
        return s; const n = intArg(args[1], 1); if (isErr(n))
        return n; return s.slice(0, Math.max(0, Math.trunc(n))); },
    RIGHT: (args) => { const s = s1(args[0]); if (isErr(s))
        return s; const n = intArg(args[1], 1); if (isErr(n))
        return n; const k = Math.max(0, Math.trunc(n)); return k === 0 ? '' : s.slice(-k); },
    MID: (args) => {
        const s = s1(args[0]);
        if (isErr(s))
            return s;
        const start = toNum(scalar(args[1]));
        if (isErr(start))
            return start;
        const len = toNum(scalar(args[2]));
        if (isErr(len))
            return len;
        const st = Math.max(1, Math.trunc(start));
        return s.slice(st - 1, st - 1 + Math.max(0, Math.trunc(len)));
    },
    SUBSTITUTE: (args) => {
        const s = s1(args[0]);
        if (isErr(s))
            return s;
        const find = s1(args[1]);
        if (isErr(find))
            return find;
        const repl = s1(args[2]);
        if (isErr(repl))
            return repl;
        return find === '' ? s : s.split(find).join(repl);
    },
    FIND: (args) => {
        const find = s1(args[0]);
        if (isErr(find))
            return find;
        const within = s1(args[1]);
        if (isErr(within))
            return within;
        const start = intArg(args[2], 1);
        if (isErr(start))
            return start;
        const idx = within.indexOf(find, Math.max(0, Math.trunc(start) - 1));
        return idx < 0 ? err('#VALUE!') : idx + 1;
    },
    REPLACE: (args) => {
        const s = s1(args[0]);
        if (isErr(s))
            return s;
        const start = toNum(scalar(args[1]));
        if (isErr(start))
            return start;
        const len = toNum(scalar(args[2]));
        if (isErr(len))
            return len;
        const newt = s1(args[3]);
        if (isErr(newt))
            return newt;
        const st = Math.max(1, Math.trunc(start)) - 1;
        return s.slice(0, st) + newt + s.slice(st + Math.max(0, Math.trunc(len)));
    },
    VALUE: (args) => { const s = s1(args[0]); if (isErr(s))
        return s; const n = Number(s.trim()); return Number.isFinite(n) ? n : err('#VALUE!'); },
    // v1: TEXT ignores the (Excel) format code and returns the value's display string.
    TEXT: (args) => { const s = toStr(scalar(args[0])); return s; },
};
