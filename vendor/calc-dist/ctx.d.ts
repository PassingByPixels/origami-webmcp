import type { CalcValue } from './types.js';
import type { CalcArg } from './coerce.js';
/** What a function body can reach: resolved cells/ranges/cross-block names + the
    injected clock (for deterministic TODAY()/NOW()). */
export interface EvalCtx {
    cell: (a1: string) => CalcValue;
    /** A range resolves to a 2D block of cell values (rows × cols). */
    range: (a: string, b: string) => CalcValue[][];
    named: (block: string, name: string) => CalcValue;
    /** A qualified cross-SHEET cell ref (`Sheet2!A1`) → its value. */
    qcell: (sheet: string, a1: string) => CalcValue;
    /** A qualified cross-SHEET range (`Sheet2!A1:B5`) → a 2D block of values. */
    qrange: (sheet: string, a: string, b: string) => CalcValue[][];
    /** Injected epoch ms — the engine NEVER reads the platform clock. */
    now: number;
}
/** Sibling-sheet context for qualified cross-sheet refs (`Sheet2!A1`, `'My Sheet'!A1:B5`) within a
    multi-tab ledger block. Injected into recalc via opts.sheets; absent = a stand-alone single sheet
    (any qualified ref then resolves to #NAME?). Qualified refs read BAKED cell values (not formulas). */
export interface SheetsContext {
    /** The name of the sheet being recalced; a qualified ref to THIS name resolves LIVE in-sheet, so a
        self-reference by own name equals the local ref. */
    self?: string;
    /** Sibling sheet name → its baked rows; a qualified ref reads cell values from here (blank off-grid). */
    rows: Record<string, string[][]>;
    /** Sibling sheet names in a dependency cycle with `self` — a qualified ref to one resolves to #CYCLE!. */
    cyclic?: Set<string>;
}
export type CalcFn = (args: CalcArg[], ctx: EvalCtx) => CalcValue;
