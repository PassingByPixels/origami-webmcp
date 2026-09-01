import { err, isErr } from '../errors.js';
import { flatten, scalar, toBool } from '../coerce.js';
export const LOGICAL = {
    TRUE: () => true,
    FALSE: () => false,
    IF: (args) => {
        const c = toBool(scalar(args[0]));
        if (isErr(c))
            return c;
        return c ? scalar(args[1]) : args[2] === undefined ? false : scalar(args[2]);
    },
    NOT: (args) => { const b = toBool(scalar(args[0])); return isErr(b) ? b : !b; },
    AND: (args) => {
        for (const v of flatten(args)) {
            const b = toBool(v);
            if (isErr(b))
                return b;
            if (!b)
                return false;
        }
        return true;
    },
    OR: (args) => {
        for (const v of flatten(args)) {
            const b = toBool(v);
            if (isErr(b))
                return b;
            if (b)
                return true;
        }
        return false;
    },
    XOR: (args) => {
        let count = 0;
        for (const v of flatten(args)) {
            const b = toBool(v);
            if (isErr(b))
                return b;
            if (b)
                count++;
        }
        return count % 2 === 1;
    },
    IFERROR: (args) => { const v = scalar(args[0]); return isErr(v) ? scalar(args[1]) : v; },
    IFS: (args) => {
        for (let i = 0; i + 1 < args.length; i += 2) {
            const c = toBool(scalar(args[i]));
            if (isErr(c))
                return c;
            if (c)
                return scalar(args[i + 1]);
        }
        return err('#N/A');
    },
    ISBLANK: (args) => { const v = scalar(args[0]); return typeof v === 'string' && v.trim() === ''; },
    ISNUMBER: (args) => typeof scalar(args[0]) === 'number',
    ISTEXT: (args) => { const v = scalar(args[0]); return typeof v === 'string' && v.trim() !== ''; },
    ISERROR: (args) => isErr(scalar(args[0])),
};
