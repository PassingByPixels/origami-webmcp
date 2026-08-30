import { ParseError } from './errors.js';
import { lex } from './lexer.js';
import { isA1, normA1 } from './refs.js';
/* Pratt parser. Binding powers (higher binds tighter):
     colon (range)        8
     %  (postfix)         7
     unary +/-            7  (prefix rbp — binds tighter than ^, so -2^2 = (-2)^2 = 4, Excel)
     ^  (right-assoc)     6
     * /                  4
     + -                  3
     &  (concat)          2
     = <> < <= > >=       1
   Reject, never repair — any malformed input throws ParseError. */
const UNARY_RBP = 7;
function lbp(t) {
    if (t.k === 'colon')
        return 8;
    if (t.k === 'op') {
        switch (t.v) {
            case '%': return 7;
            case '^': return 6;
            case '*':
            case '/': return 4;
            case '+':
            case '-': return 3;
            case '&': return 2;
            case '=':
            case '<>':
            case '<':
            case '<=':
            case '>':
            case '>=': return 1;
        }
    }
    return 0;
}
class Parser {
    toks;
    i = 0;
    constructor(toks) {
        this.toks = toks;
    }
    peek() { return this.toks[this.i]; }
    next() { return this.toks[this.i++]; }
    expect(k) {
        if (this.peek().k !== k)
            throw new ParseError('expected ' + k);
        this.i++;
    }
    parse() {
        const n = this.expr(0);
        if (this.peek().k !== 'eof')
            throw new ParseError('trailing tokens');
        return n;
    }
    expr(rbp) {
        let left = this.nud(this.next());
        while (lbp(this.peek()) > rbp)
            left = this.led(this.next(), left);
        return left;
    }
    nud(t) {
        switch (t.k) {
            case 'num': return { t: 'num', v: t.v };
            case 'str': return { t: 'str', v: t.v };
            case 'err': return { t: 'err', code: t.v };
            case 'named': return { t: 'named', block: t.block, name: t.name };
            case 'qref': return t.b !== undefined
                ? { t: 'qref', sheet: t.sheet, a: t.a, b: t.b }
                : { t: 'qref', sheet: t.sheet, a: t.a };
            case 'name': {
                if (this.peek().k === 'lp')
                    return this.call(t.v);
                const up = t.v.toUpperCase();
                if (up === 'TRUE')
                    return { t: 'bool', v: true };
                if (up === 'FALSE')
                    return { t: 'bool', v: false };
                if (isA1(t.v))
                    return { t: 'ref', a1: normA1(t.v) };
                throw new ParseError('unknown name "' + t.v + '"');
            }
            case 'op':
                if (t.v === '-')
                    return { t: 'unary', op: '-', x: this.expr(UNARY_RBP) };
                if (t.v === '+')
                    return { t: 'unary', op: '+', x: this.expr(UNARY_RBP) };
                throw new ParseError('unexpected operator "' + t.v + '"');
            case 'lp': {
                const e = this.expr(0);
                this.expect('rp');
                return e;
            }
            default:
                throw new ParseError('unexpected token');
        }
    }
    led(t, left) {
        if (t.k === 'colon') {
            const right = this.expr(7); // bind tightly so a range grabs exactly one ref
            if (left.t === 'ref' && right.t === 'ref')
                return { t: 'range', a: left.a1, b: right.a1 };
            throw new ParseError('a range needs a cell reference on both sides of ":"');
        }
        if (t.k === 'op') {
            if (t.v === '%')
                return { t: 'unary', op: '%', x: left };
            const bp = lbp(t);
            const right = this.expr(t.v === '^' ? bp - 1 : bp); // right-assoc for ^
            return { t: 'binary', op: t.v, l: left, r: right };
        }
        throw new ParseError('unexpected token in expression');
    }
    call(name) {
        this.expect('lp');
        const args = [];
        if (this.peek().k !== 'rp') {
            args.push(this.expr(0));
            while (this.peek().k === 'comma') {
                this.next();
                args.push(this.expr(0));
            }
        }
        this.expect('rp');
        return { t: 'call', name: name.toUpperCase(), args };
    }
}
/** Parse a formula body (NO leading "="). Throws ParseError on malformed input. */
export function parse(body) {
    return new Parser(lex(body)).parse();
}
