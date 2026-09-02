import { recalc } from '../../vendor/calc-dist/index.js';

/* Ported from the Folio monorepo's packages/mcp/src/bake.ts, now that @origami/calc is
   vendored (vendor/calc-dist).

   This app is a trusted authoring host, so (like the Studio and the stdio MCP server) it bakes
   every table block's formulas into values at write time — an agent-authored table is born
   baked. Within-block only (cross-block @block.output refs resolve when the Studio opens the
   Fold). The VIEWER never runs this: @origami/calc lives in authoring hosts only, and the
   .origami.html the human saves carries baked values, not an engine. */

const TABLE_BLOCK_RE = /(<script[^>]*\bdata-odata="table"[^>]*>)([\s\S]*?)(<\/script>)/gi;

/** Recompute the formula cells of EVERY table block in a fold inner into `rows` (`now` injected
    for deterministic dates). A block that is not parseable, or has no rows, is left as it is. A
    fold with no table block comes back unchanged — so the caller need not know the slide kind:
    a ledger is usually a FREE card holding a table figure, and it bakes the same. */
export function bakeTableInner(inner: string, now: number): string {
  return inner.replace(TABLE_BLOCK_RE, (whole: string, open: string, body: string, close: string) => {
    let data: { rows?: unknown; formulas?: Record<string, string>; named?: Record<string, string> };
    try {
      data = JSON.parse(body);
    } catch {
      return whole;
    }
    if (!data || !Array.isArray(data.rows)) return whole;
    try {
      const res = recalc({ rows: data.rows as string[][], formulas: data.formulas, named: data.named }, {}, { now });
      (data as { rows: unknown }).rows = res.values;
    } catch {
      return whole;
    }
    const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
    return open + '\n' + json + '\n' + close;
  });
}
