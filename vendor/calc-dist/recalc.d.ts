import type { CalcGrid, CalcResult } from './types.js';
import type { SheetsContext } from './ctx.js';
/** Pure, deterministic recalculation. `now` (epoch ms) is injected so TODAY()/NOW()
    bake reproducibly; the engine never reads the platform clock. Within-Fold only —
    @block.output refs resolve from the `named` map (key "blockId.output"). Qualified cross-SHEET
    refs (`Sheet2!A1`, `'My Sheet'!A1:B5`) resolve from opts.sheets when this sheet is part of a
    multi-tab ledger block; absent → any qualified ref is #NAME?. */
export declare function recalc(grid: CalcGrid, named?: Record<string, string>, opts?: {
    now?: number;
    sheets?: SheetsContext;
}): CalcResult;
