import { CALC_ENGINE_SENTINEL, ParseError, err, isErr } from './errors.js';
import { a1ToRC, isA1, normA1, rcToA1 } from './refs.js';
import { parse } from './parser.js';
import { refsOf } from './graph.js';
import { evalNode, toScalar } from './eval.js';
import { formatValue } from './coerce.js';
const ERR_CODE = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|CYCLE!)$/;
/** A baked cell string -> its calc value: number / bool / baked-error / blank / text. */
function bakedToValue(s) {
    if (s === '')
        return '';
    const t = s.trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
        const n = Number(t);
        if (Number.isFinite(n))
            return n;
    }
    const up = t.toUpperCase();
    if (up === 'TRUE')
        return true;
    if (up === 'FALSE')
        return false;
    if (ERR_CODE.test(t))
        return err(t);
    return s;
}
function parseFormula(body) {
    try {
        return parse(body);
    }
    catch (e) {
        return err(e instanceof ParseError && /unknown name/.test(e.message) ? '#NAME?' : '#VALUE!');
    }
}
/** Pure, deterministic recalculation. `now` (epoch ms) is injected so TODAY()/NOW()
    bake reproducibly; the engine never reads the platform clock. Within-Fold only —
    @block.output refs resolve from the `named` map (key "blockId.output"). Qualified cross-SHEET
    refs (`Sheet2!A1`, `'My Sheet'!A1:B5`) resolve from opts.sheets when this sheet is part of a
    multi-tab ledger block; absent → any qualified ref is #NAME?. */
export function recalc(grid, named = {}, opts = {}) {
    void CALC_ENGINE_SENTINEL; // keep the R3 build-guard sentinel reachable
    const now = opts.now ?? 0;
    const sheets = opts.sheets;
    const rows = grid.rows;
    const cellAt = (a1) => {
        const rc = a1ToRC(a1);
        return rc ? rows[rc.r]?.[rc.c] ?? '' : '';
    };
    // 1. parse formulas (A1 keys normalized; leading "=" stripped)
    const asts = new Map();
    const parseErr = new Map();
    for (const [rawKey, formula] of Object.entries(grid.formulas ?? {})) {
        const key = normA1(rawKey);
        const r = parseFormula(formula.startsWith('=') ? formula.slice(1) : formula);
        if (isErr(r))
            parseErr.set(key, r);
        else
            asts.set(key, r);
    }
    const formulaCells = new Set([...asts.keys(), ...parseErr.keys()]);
    // 2. dependency edges (formula cell -> the formula cells it references)
    const deps = new Map();
    for (const [a1, node] of asts) {
        const s = new Set();
        refsOf(node, s);
        deps.set(a1, [...s].map(normA1).filter((d) => formulaCells.has(d)));
    }
    // 3. cycles: a formula cell whose dependency closure reaches itself
    const cyclic = new Set();
    const reaches = (start) => {
        const seen = new Set();
        const stack = [...(deps.get(start) ?? [])];
        while (stack.length) {
            const x = stack.pop();
            if (x === start)
                return true;
            if (seen.has(x))
                continue;
            seen.add(x);
            for (const d of deps.get(x) ?? [])
                stack.push(d);
        }
        return false;
    };
    for (const a1 of asts.keys())
        if (reaches(a1))
            cyclic.add(a1);
    // 4. topological order of the non-cyclic cells (dependencies first)
    const order = [];
    const done = new Set();
    const emit = (a1) => {
        if (done.has(a1) || cyclic.has(a1) || !asts.has(a1))
            return;
        done.add(a1);
        for (const d of deps.get(a1) ?? [])
            emit(d);
        order.push(a1);
    };
    for (const a1 of asts.keys())
        emit(a1);
    // 5. evaluate
    const computed = new Map();
    for (const a1 of cyclic)
        computed.set(a1, err('#CYCLE!'));
    for (const [a1, e] of parseErr)
        computed.set(a1, e);
    const ctx = {
        now,
        cell: (a1) => {
            const k = normA1(a1);
            if (formulaCells.has(k))
                return computed.get(k) ?? err('#CYCLE!');
            return bakedToValue(cellAt(k));
        },
        range: (a, b) => {
            const ra = a1ToRC(a), rb = a1ToRC(b);
            if (!ra || !rb)
                return [[err('#REF!')]];
            const r0 = Math.min(ra.r, rb.r), r1 = Math.max(ra.r, rb.r);
            const c0 = Math.min(ra.c, rb.c), c1 = Math.max(ra.c, rb.c);
            const out = [];
            for (let r = r0; r <= r1; r++) {
                const row = [];
                for (let c = c0; c <= c1; c++)
                    row.push(ctx.cell(rcToA1(r, c)));
                out.push(row);
            }
            return out;
        },
        named: (block, name) => {
            const key = `${block}.${name}`;
            return key in named ? bakedToValue(named[key]) : err('#REF!');
        },
        // Qualified cross-sheet cell: a ref to THIS sheet's own name resolves live in-sheet (self ≡ local);
        // a cyclic sibling → #CYCLE!; an unknown sheet → #NAME?; a known sheet with a non-A1 suffix → #REF!;
        // a valid A1 that's empty or beyond the sibling's grid → blank (Excel, matching local out-of-grid).
        qcell: (sheet, a1) => {
            if (!sheets)
                return err('#NAME?');
            if (sheet === sheets.self)
                return isA1(a1) ? ctx.cell(a1) : err('#REF!');
            if (sheets.cyclic?.has(sheet))
                return err('#CYCLE!');
            const srows = sheets.rows[sheet];
            if (!srows)
                return err('#NAME?');
            const rc = a1ToRC(a1);
            if (!rc)
                return err('#REF!');
            return bakedToValue(srows[rc.r]?.[rc.c] ?? '');
        },
        qrange: (sheet, a, b) => {
            if (!sheets)
                return [[err('#NAME?')]];
            if (sheet === sheets.self)
                return ctx.range(a, b); // live in-sheet; malformed ends → [[#REF!]]
            if (sheets.cyclic?.has(sheet))
                return [[err('#CYCLE!')]];
            const srows = sheets.rows[sheet];
            if (!srows)
                return [[err('#NAME?')]];
            const ra = a1ToRC(a), rb = a1ToRC(b);
            if (!ra || !rb)
                return [[err('#REF!')]];
            const r0 = Math.min(ra.r, rb.r), r1 = Math.max(ra.r, rb.r);
            const c0 = Math.min(ra.c, rb.c), c1 = Math.max(ra.c, rb.c);
            const out = [];
            for (let r = r0; r <= r1; r++) {
                const row = [];
                for (let c = c0; c <= c1; c++)
                    row.push(bakedToValue(srows[r]?.[c] ?? ''));
                out.push(row);
            }
            return out;
        },
    };
    for (const a1 of order)
        computed.set(a1, toScalar(evalNode(asts.get(a1), ctx)));
    // 6. bake computed values back into a clone of rows (only formula cells change)
    const values = rows.map((row) => row.slice());
    const errors = [];
    for (const a1 of formulaCells) {
        const v = computed.get(a1) ?? err('#REF!');
        const rc = a1ToRC(a1);
        if (rc) {
            while (values.length <= rc.r)
                values.push([]);
            const row = values[rc.r];
            while (row.length <= rc.c)
                row.push('');
            row[rc.c] = formatValue(v);
        }
        if (isErr(v))
            errors.push({ at: a1, code: v.code });
    }
    // 7. named outputs (this block's exported @block.output formulas)
    const outputs = {};
    for (const [name, formula] of Object.entries(grid.named ?? {})) {
        const node = parseFormula(formula.startsWith('=') ? formula.slice(1) : formula);
        const v = isErr(node) ? node : toScalar(evalNode(node, ctx));
        outputs[name] = formatValue(v);
        if (isErr(v))
            errors.push({ at: name, code: v.code });
    }
    return { values, errors, outputs };
}
