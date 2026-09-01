/** Whole-BLOCK bake for a multi-tab ledger (Slice: ledger tabs). A ledger block is one ACTIVE sheet
    plus zero or more inactive sibling sheets; a formula on any sheet may reference another by name via
    a qualified ref (`Sheet2!A1`, `'My Sheet'!A1:B5`). `recalcTabs` bakes ALL sheets of one block
    together, mirroring the archived cross-LEDGER `recalcDeck` (git 06a8393:packages/calc/src/deck.ts)
    — blocks→sheets, `@Name.x`→`Sheet!A1` — with one upgrade: RANGES work from day one.

      1. A sheet depends on every OTHER sheet it references by a qualified ref (a self-reference is NOT
         a cross-sheet dependency — it resolves live in-sheet, `self ≡ local`). Non-cyclic deps bake
         FIRST, so a dependent reads the source's freshly-baked values (stronger than "last-committed",
         and a DAG so it terminates).
      2. A cross-sheet CYCLE (A→B→A) can't be ordered — the participating qualified refs resolve to
         `#CYCLE!` (the engine's existing cycle idiom) and the bake never hangs.
      3. A ref to a MISSING sheet → `#NAME?`; a known sheet with a non-A1 suffix → `#REF!`; a valid A1
         that is empty / off the sibling's grid → blank (Excel).

    Unlike deck.ts's scalar `named`-map hand-in (which can only express single values), each sheet is
    baked by the SAME pure `recalc` with a `sheets` CONTEXT — the evaluator resolves qualified refs AND
    ranges natively against the sibling's baked rows. Authoring-layer only (like the rest of @origami/calc):
    the distributed viewer ships baked values and never runs this. */
import { lex } from './lexer.js';
import { resolveNames } from './names.js';
import { recalc } from './recalc.js';
/** The DISTINCT sibling sheet names a set of formula bodies references via qualified refs, collected
    through the shared lexer so a `!` inside a string literal is never mistaken for a qualifier. */
function qsheetsOf(maps) {
    const out = [];
    for (const map of maps) {
        for (const formula of Object.values(map ?? {})) {
            const body = formula.startsWith('=') ? formula.slice(1) : formula;
            let toks;
            try {
                toks = lex(body);
            }
            catch {
                continue;
            } // a bad formula contributes no edges (recalc flags it)
            for (const t of toks)
                if (t.k === 'qref')
                    out.push(t.sheet);
        }
    }
    return out;
}
/** Invert a sheet's A1->name map to name->A1 for in-sheet reference-by-name (first A1 wins on a dup). */
function nameToA1(cellNames) {
    const out = {};
    if (cellNames)
        for (const [addr, name] of Object.entries(cellNames))
            if (name && !(name in out))
                out[name] = addr;
    return out;
}
/** Bake a whole ledger block of sheets, resolving qualified cross-sheet refs. Returns one result per
    input sheet, in input order. Pure + deterministic (inject `now` for TODAY()/NOW()). */
export function recalcTabs(sheets, opts = {}) {
    const now = opts.now ?? 0;
    // name -> sheet index (first named wins on a duplicate; the editor enforces uniqueness so this is a guard)
    const byName = new Map();
    sheets.forEach((s, i) => { if (s.name && !byName.has(s.name))
        byName.set(s.name, i); });
    // dependency edges: sheet -> the indices of the OTHER named sheets it references (self-refs excluded)
    const deps = sheets.map((s, i) => {
        const set = new Set();
        for (const name of qsheetsOf([s.formulas, s.named])) {
            const j = byName.get(name);
            if (j !== undefined && j !== i)
                set.add(j);
        }
        return set;
    });
    // transitive reachability over dep edges → cross-sheet cycle detection
    const closure = sheets.map((_, i) => {
        const seen = new Set();
        const stack = [...deps[i]];
        while (stack.length) {
            const k = stack.pop();
            if (seen.has(k))
                continue;
            seen.add(k);
            for (const d of deps[k])
                stack.push(d);
        }
        return seen;
    });
    const mutual = (a, b) => a !== b && closure[a].has(b) && closure[b].has(a);
    // evaluation order: a sheet's NON-cyclic deps bake first. The onStack guard makes recursion terminate
    // no matter the graph shape (a cyclic edge never re-enters → never hangs); every sheet is still emitted.
    const order = [];
    const done = new Set();
    const onStack = new Set();
    const emit = (i) => {
        if (done.has(i) || onStack.has(i))
            return;
        onStack.add(i);
        for (const d of deps[i])
            if (!mutual(i, d))
                emit(d);
        onStack.delete(i);
        done.add(i);
        order.push(i);
    };
    sheets.forEach((_, i) => emit(i));
    // bake in order, accumulating each sheet's baked rows for downstream cross-refs
    const baked = new Array(sheets.length);
    for (const i of order) {
        const s = sheets[i];
        // sibling context: every OTHER resolvable sheet's baked (else input) rows, keyed by name; a sheet
        // mutually cyclic with i is withheld from `rows` and named in `cyclic` (→ #CYCLE! at eval).
        const rows = {};
        const cyclic = new Set();
        for (let j = 0; j < sheets.length; j++) {
            if (j === i)
                continue;
            const nm = sheets[j].name;
            if (!nm || byName.get(nm) !== j)
                continue; // unnamed, or a shadowed duplicate name → not resolvable
            if (mutual(i, j))
                cyclic.add(nm);
            else
                rows[nm] = baked[j] ?? sheets[j].rows;
        }
        // resolve THIS sheet's in-block cell names (=price*qty → =C2*B2) before recalc, like the editor
        const n2a = nameToA1(s.cellNames);
        const formulas = {};
        for (const [k, f] of Object.entries(s.formulas ?? {}))
            formulas[k] = resolveNames(f, n2a);
        let res;
        try {
            res = recalc({ rows: s.rows, formulas, named: s.named }, {}, { now, sheets: { self: s.name || undefined, rows, cyclic } });
        }
        catch {
            res = { values: s.rows, errors: [], outputs: {} }; // a recalc failure leaves the sheet as given
        }
        baked[i] = res.values;
    }
    return sheets.map((s, i) => ({ values: baked[i] ?? s.rows }));
}
