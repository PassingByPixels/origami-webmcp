import { err, isErr } from './errors.js';
import { toNum, toStr } from './coerce.js';
import { FUNCTIONS } from './functions/index.js';
const fin = (n) => (Number.isFinite(n) ? n : err('#VALUE!'));
/** Collapse a range result to a scalar (1×1 -> that cell; else #VALUE!). */
export function toScalar(v) {
    if (Array.isArray(v))
        return v.length === 1 && v[0]?.length === 1 ? v[0][0] : err('#VALUE!');
    return v;
}
const numic = (v) => {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    const s = String(v).trim();
    if (s === '')
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
const sval = (v) => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)).toLowerCase();
function compare(l, r, op) {
    const ln = numic(l), rn = numic(r);
    let cmp;
    if (ln !== null && rn !== null)
        cmp = ln < rn ? -1 : ln > rn ? 1 : 0;
    else {
        const a = sval(l), b = sval(r);
        cmp = a < b ? -1 : a > b ? 1 : 0;
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
/** Evaluate a node. Returns a CalcArg (a range node yields a 2D range). */
export function evalNode(node, ctx) {
    switch (node.t) {
        case 'num': return node.v;
        case 'str': return node.v;
        case 'bool': return node.v;
        case 'err': return err(node.code);
        case 'ref': return ctx.cell(node.a1);
        case 'range': return ctx.range(node.a, node.b);
        case 'named': return ctx.named(node.block, node.name);
        case 'qref': return node.b !== undefined ? ctx.qrange(node.sheet, node.a, node.b) : ctx.qcell(node.sheet, node.a);
        case 'call': {
            const fn = FUNCTIONS[node.name];
            if (!fn)
                return err('#NAME?');
            return fn(node.args.map((a) => evalNode(a, ctx)), ctx);
        }
        case 'unary': {
            const x = toScalar(evalNode(node.x, ctx));
            const n = toNum(x);
            if (isErr(n))
                return n;
            if (node.op === '%')
                return n / 100;
            return node.op === '-' ? -n : n;
        }
        case 'binary': {
            const l = toScalar(evalNode(node.l, ctx));
            if (isErr(l))
                return l;
            const r = toScalar(evalNode(node.r, ctx));
            if (isErr(r))
                return r;
            const op = node.op;
            if (op === '&') {
                const a = toStr(l);
                if (isErr(a))
                    return a;
                const b = toStr(r);
                if (isErr(b))
                    return b;
                return a + b;
            }
            if (op === '=' || op === '<>' || op === '<' || op === '<=' || op === '>' || op === '>=')
                return compare(l, r, op);
            const a = toNum(l);
            if (isErr(a))
                return a;
            const b = toNum(r);
            if (isErr(b))
                return b;
            switch (op) {
                case '+': return fin(a + b);
                case '-': return fin(a - b);
                case '*': return fin(a * b);
                case '/': return b === 0 ? err('#DIV/0!') : fin(a / b);
                case '^': return fin(Math.pow(a, b));
            }
            return err('#VALUE!');
        }
    }
}
