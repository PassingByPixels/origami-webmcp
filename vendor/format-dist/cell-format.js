/** Display-only formatting of a baked cell value under a user-applied CellFormat. PURE (no calc,
    no DOM) so both the Studio editor and the inert viewer format identically from the same code.
    NEVER changes the stored/baked string — `general` (or no format) returns it verbatim (calc
    already produced its canonical form). Ported from the alpha's applyFmtText/numFmt/dateDisplay;
    "units are permanently off" in the alpha, so there is no unit/dimensional handling here. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMRE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Interpret a baked string as a typed value. Calc bakes numbers as canonical strings, dates as
    ISO (YYYY-MM-DD), booleans as TRUE/FALSE, and errors as `#…`. */
export function typedFromBaked(s) {
    if (s === '')
        return { kind: 'blank' };
    if (s.charCodeAt(0) === 35)
        return { kind: 'err', code: s }; // '#'
    if (s === 'TRUE')
        return { kind: 'bool', b: true };
    if (s === 'FALSE')
        return { kind: 'bool', b: false };
    const iso = ISO.exec(s);
    if (iso)
        return { kind: 'date', y: +iso[1], m: +iso[2], d: +iso[3] };
    if (NUMRE.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n))
            return { kind: 'num', n };
    }
    return { kind: 'text', text: s };
}
const pad = (n) => (n < 10 ? '0' + n : String(n));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateDisplay(y, m, d, df) {
    switch (df) {
        case 'yyyy-mm-dd': return y + '-' + pad(m) + '-' + pad(d);
        case 'dd/mm/yyyy': return pad(d) + '/' + pad(m) + '/' + y;
        case 'mm/dd/yyyy': return pad(m) + '/' + pad(d) + '/' + y;
        case 'd mmmm yyyy': return d + ' ' + MONF[m - 1] + ' ' + y;
        case 'd mmm yyyy':
        default: return d + ' ' + MON[m - 1] + ' ' + y;
    }
}
/** Number with explicit decimals, decimal separator, and optional thousands grouping.
    sep ',' -> European (grouping '.', decimal ','); sep '.' -> US (grouping ',', decimal '.'). */
function numFmt(x, dp, sep, thou) {
    if (!Number.isFinite(x))
        return '';
    const neg = x < 0;
    const [intRaw, frac] = Math.abs(x).toFixed(dp).split('.');
    const intPart = thou ? intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, sep === ',' ? '.' : ',') : intRaw;
    const out = dp > 0 ? intPart + (sep === ',' ? ',' : '.') + frac : intPart;
    return (neg ? '-' : '') + out;
}
const commas = (x, dp) => Number(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** The display string for a baked value under a format. Display-only; non-numeric values ignore
    numeric formats (shown natural), mirroring the alpha. */
export function formatCell(baked, fmt) {
    if (baked === '')
        return '';
    const kind = fmt?.kind;
    if (!kind || kind === 'general')
        return baked; // calc's canonical form
    const v = typedFromBaked(baked);
    if (v.kind === 'err')
        return v.code;
    if (kind === 'text') {
        if (v.kind === 'text')
            return v.text;
        if (v.kind === 'bool')
            return v.b ? 'TRUE' : 'FALSE';
        if (v.kind === 'date')
            return `${v.y}-${pad(v.m)}-${pad(v.d)}`;
        if (v.kind === 'num')
            return String(v.n);
        return baked;
    }
    if (v.kind === 'text')
        return v.text;
    if (v.kind === 'bool')
        return v.b ? 'TRUE' : 'FALSE';
    if (kind === 'date') {
        return v.kind === 'date' ? dateDisplay(v.y, v.m, v.d, fmt?.dateFmt ?? 'd mmm yyyy') : baked;
    }
    if (v.kind !== 'num')
        return baked;
    const n = v.n;
    if (kind === 'number')
        return numFmt(n, fmt?.decimals ?? 2, fmt?.sep ?? '.', fmt?.thou ?? true);
    if (kind === 'currency') {
        const sym = fmt?.currency ?? '$';
        const dp = fmt?.decimals ?? (Math.abs(n) % 1 ? 2 : 0);
        return (n < 0 ? '-' + sym : sym) + commas(Math.abs(n), dp);
    }
    if (kind === 'percent')
        return commas(n * 100, fmt?.decimals ?? 0) + '%';
    return baked;
}
/** The tint-class suffix for a format ('cur'|'pct'|'date'|'num') — the alpha's format-driven
    cell tinting (currency green, percent purple, date amber, else neutral). */
export function formatTone(fmt) {
    const k = fmt?.kind;
    return k === 'currency' ? 'cur' : k === 'percent' ? 'pct' : k === 'date' ? 'date' : 'num';
}
