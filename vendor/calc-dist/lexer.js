import { ParseError } from './errors.js';
const NUM = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?|^\.[0-9]+([eE][+-]?[0-9]+)?/;
const NAME = /^\$?[A-Za-z]+\$?[0-9]*/;
const NAMED = /^@([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/;
// Qualified cross-sheet ref with an UNQUOTED (identifier) sheet name: `Sheet2!A1` or `Data!A1:B5`. The
// `!` disambiguates it from a bare cell ref (a local ref never carries `!`). The A1-shape of the suffix
// is NOT checked here — a non-A1 suffix (e.g. `Sheet2!price`) is captured and rejected as #REF! at eval,
// which is why the suffix charset is the looser [A-Za-z0-9_$] rather than a strict A1 pattern.
const QREF = /^([A-Za-z_][A-Za-z0-9_]*)!([A-Za-z0-9_$]+)(?::([A-Za-z0-9_$]+))?/;
// The A1 (or A1:A1) suffix after a `'quoted name'` + `!`.
const QSUFFIX = /^([A-Za-z0-9_$]+)(?::([A-Za-z0-9_$]+))?/;
// Error literals that may appear in a formula body (e.g. after a fill-drag pushes a ref off the
// grid, yielding #REF!). The internal cycle-error code is engine-only and deliberately NOT lexable.
const ERR = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A)/;
/** Tokenise a formula body (the leading "=" already stripped). Throws ParseError on
    an unknown character — recalc maps that to an error cell, never repairs. */
export function lex(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const ch = src[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        if (ch === '"') {
            let j = i + 1, s = '';
            while (j < n) {
                if (src[j] === '"') {
                    if (src[j + 1] === '"') {
                        s += '"';
                        j += 2;
                        continue;
                    }
                    break;
                }
                s += src[j++];
            }
            if (j >= n)
                throw new ParseError('unterminated string');
            toks.push({ k: 'str', v: s });
            i = j + 1;
            continue;
        }
        if (ch === "'") {
            // A '-quoted sheet name (spaces / other chars), `''` = an escaped quote, followed by `!` + an A1
            // suffix. A quoted name that is NOT a sheet reference is a malformed formula (rejected, never repaired).
            let j = i + 1, name = '';
            while (j < n) {
                if (src[j] === "'") {
                    if (src[j + 1] === "'") {
                        name += "'";
                        j += 2;
                        continue;
                    }
                    break;
                }
                name += src[j++];
            }
            if (j >= n)
                throw new ParseError('unterminated quoted sheet name');
            if (src[j + 1] !== '!')
                throw new ParseError('a quoted sheet name must be a "!ref" reference');
            const sfx = QSUFFIX.exec(src.slice(j + 2));
            if (!sfx)
                throw new ParseError('a quoted sheet reference needs an A1 cell or range');
            const end = j + 2 + sfx[0].length;
            toks.push({ k: 'qref', sheet: name, a: sfx[1], ...(sfx[2] !== undefined ? { b: sfx[2] } : {}), raw: src.slice(i, end) });
            i = end;
            continue;
        }
        if (ch === '(') {
            toks.push({ k: 'lp' });
            i++;
            continue;
        }
        if (ch === ')') {
            toks.push({ k: 'rp' });
            i++;
            continue;
        }
        if (ch === ',') {
            toks.push({ k: 'comma' });
            i++;
            continue;
        }
        if (ch === ':') {
            toks.push({ k: 'colon' });
            i++;
            continue;
        }
        if (ch === '@') {
            const m = NAMED.exec(src.slice(i));
            if (!m)
                throw new ParseError('bad @ reference');
            toks.push({ k: 'named', block: m[1], name: m[2] });
            i += m[0].length;
            continue;
        }
        if (ch === '#') {
            const m = ERR.exec(src.slice(i));
            if (!m)
                throw new ParseError('bad error literal');
            toks.push({ k: 'err', v: m[0] });
            i += m[0].length;
            continue;
        }
        // operators (two-char first)
        const two = src.slice(i, i + 2);
        if (two === '<>' || two === '<=' || two === '>=') {
            toks.push({ k: 'op', v: two });
            i += 2;
            continue;
        }
        if ('+-*/^&=<>%'.includes(ch)) {
            toks.push({ k: 'op', v: ch });
            i++;
            continue;
        }
        // number (must come before name so .5 etc. lex as numbers)
        const num = NUM.exec(src.slice(i));
        if (num && /[0-9.]/.test(ch)) {
            toks.push({ k: 'num', v: Number(num[0]) });
            i += num[0].length;
            continue;
        }
        // qualified cross-sheet ref (unquoted identifier sheet name): Sheet2!A1 or Data!A1:B5. Checked
        // before NAME so `Sheet2` isn't lexed as a bare name and the `!` left dangling.
        const qm = QREF.exec(src.slice(i));
        if (qm) {
            toks.push({ k: 'qref', sheet: qm[1], a: qm[2], ...(qm[3] !== undefined ? { b: qm[3] } : {}), raw: qm[0] });
            i += qm[0].length;
            continue;
        }
        // name (function / cell ref / TRUE / FALSE)
        const name = NAME.exec(src.slice(i));
        if (name) {
            toks.push({ k: 'name', v: name[0] });
            i += name[0].length;
            continue;
        }
        throw new ParseError('unexpected character "' + ch + '"');
    }
    toks.push({ k: 'eof' });
    return toks;
}
