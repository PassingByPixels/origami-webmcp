import { err, isErr } from '../errors.js';
import { scalar, toNum, toStr } from '../coerce.js';
/* Dates are ISO strings ('YYYY-MM-DD'), not Excel serials — readable + deterministic.
   Date math uses UTC so it's timezone-independent. TODAY()/NOW() read ctx.now (injected). */
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoDateTime = (d) => `${isoDate(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
function parseDate(v) {
    const s = toStr(v);
    if (isErr(s))
        return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
    if (!m)
        return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
}
export const DATE_FNS = {
    TODAY: (_args, ctx) => isoDate(new Date(ctx.now)),
    NOW: (_args, ctx) => isoDateTime(new Date(ctx.now)),
    DATE: (args) => {
        const y = toNum(scalar(args[0]));
        if (isErr(y))
            return y;
        const m = toNum(scalar(args[1]));
        if (isErr(m))
            return m;
        const d = toNum(scalar(args[2]));
        if (isErr(d))
            return d;
        return isoDate(new Date(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d))));
    },
    YEAR: (args) => { const d = parseDate(scalar(args[0])); return d ? d.getUTCFullYear() : err('#VALUE!'); },
    MONTH: (args) => { const d = parseDate(scalar(args[0])); return d ? d.getUTCMonth() + 1 : err('#VALUE!'); },
    DAY: (args) => { const d = parseDate(scalar(args[0])); return d ? d.getUTCDate() : err('#VALUE!'); },
    WEEKDAY: (args) => { const d = parseDate(scalar(args[0])); return d ? d.getUTCDay() + 1 : err('#VALUE!'); }, // 1 = Sunday
    EOMONTH: (args) => {
        const d = parseDate(scalar(args[0]));
        if (!d)
            return err('#VALUE!');
        const m = toNum(scalar(args[1]));
        if (isErr(m))
            return m;
        return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m) + 1, 0)));
    },
    DATEDIF: (args) => {
        const a = parseDate(scalar(args[0]));
        const b = parseDate(scalar(args[1]));
        if (!a || !b)
            return err('#VALUE!');
        const unit = toStr(scalar(args[2]));
        if (isErr(unit))
            return unit;
        const u = unit.trim().toUpperCase();
        if (u === 'D')
            return Math.round((b.getTime() - a.getTime()) / 86400000);
        if (u === 'M')
            return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
        if (u === 'Y')
            return b.getUTCFullYear() - a.getUTCFullYear();
        return err('#VALUE!');
    },
};
