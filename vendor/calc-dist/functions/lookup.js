import { err, isErr } from '../errors.js';
import { asRow, formatValue, isRange, scalar, toNum } from '../coerce.js';
const as2D = (a) => (a === undefined ? [] : isRange(a) ? a : [[a]]);
/** Loose lookup equality: numeric when both sides are numeric, else case-insensitive string. */
function eq(a, b) {
    const an = typeof a === 'number' ? a : Number(String(a).trim());
    const bn = typeof b === 'number' ? b : Number(String(b).trim());
    if (Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== '' && String(b).trim() !== '')
        return an === bn;
    return formatValue(a).trim().toLowerCase() === formatValue(b).trim().toLowerCase();
}
export const LOOKUP = {
    // v1: exact match only (range_lookup is treated as exact).
    VLOOKUP: (args) => {
        const key = scalar(args[0]);
        if (isErr(key))
            return key;
        const table = as2D(args[1]);
        const col = toNum(scalar(args[2]));
        if (isErr(col))
            return col;
        const c = Math.trunc(col) - 1;
        for (const row of table) {
            if (row.length && eq(row[0], key)) {
                if (c < 0 || c >= row.length)
                    return err('#REF!');
                return row[c];
            }
        }
        return err('#N/A');
    },
    HLOOKUP: (args) => {
        const key = scalar(args[0]);
        if (isErr(key))
            return key;
        const table = as2D(args[1]);
        const rowN = toNum(scalar(args[2]));
        if (isErr(rowN))
            return rowN;
        if (!table.length)
            return err('#N/A');
        const header = table[0];
        for (let c = 0; c < header.length; c++) {
            if (eq(header[c], key)) {
                const r = Math.trunc(rowN) - 1;
                if (r < 0 || r >= table.length)
                    return err('#REF!');
                return table[r][c] ?? '';
            }
        }
        return err('#N/A');
    },
    INDEX: (args) => {
        const table = as2D(args[0]);
        if (!table.length)
            return err('#REF!');
        const r = toNum(scalar(args[1]));
        if (isErr(r))
            return r;
        const ri = Math.trunc(r);
        if (args[2] === undefined) {
            if (table.length === 1)
                return table[0][ri - 1] ?? err('#REF!'); // single row -> index is column
            const row = table[ri - 1];
            if (!row)
                return err('#REF!');
            return row.length === 1 ? row[0] : err('#REF!'); // single column
        }
        const c = toNum(scalar(args[2]));
        if (isErr(c))
            return c;
        const row = table[ri - 1];
        if (!row)
            return err('#REF!');
        const cell = row[Math.trunc(c) - 1];
        return cell === undefined ? err('#REF!') : cell;
    },
    MATCH: (args) => {
        const key = scalar(args[0]);
        if (isErr(key))
            return key;
        const arr = asRow(args[1]); // exact match (match_type 0)
        for (let i = 0; i < arr.length; i++)
            if (eq(arr[i], key))
                return i + 1;
        return err('#N/A');
    },
    XLOOKUP: (args) => {
        const key = scalar(args[0]);
        if (isErr(key))
            return key;
        const lookup = asRow(args[1]);
        const ret = asRow(args[2]);
        for (let i = 0; i < lookup.length; i++)
            if (eq(lookup[i], key))
                return ret[i] ?? '';
        return args[3] === undefined ? err('#N/A') : scalar(args[3]);
    },
    CHOOSE: (args) => {
        const idx = toNum(scalar(args[0]));
        if (isErr(idx))
            return idx;
        const pick = args[Math.trunc(idx)]; // 1-based: args[1] is choice 1
        return pick === undefined ? err('#VALUE!') : scalar(pick);
    },
};
