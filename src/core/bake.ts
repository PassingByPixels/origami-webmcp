import { recalc } from '../../vendor/calc-dist/index.js';

/* Ported verbatim from the Folio monorepo's packages/mcp/src/bake.ts, now that @origami/calc
   is vendored (vendor/calc-dist).

   This app is a trusted authoring host, so (like the Studio and the stdio MCP server) it bakes a
   `table` chunk's formulas into values at write time — an agent-authored table is born baked.
   Within-block only (cross-block @block.output refs resolve when the Studio opens the Fold). The
   VIEWER never runs this: @origami/calc lives in authoring hosts only, and the .origami.html the
   human saves carries baked values, not an engine. */

const TABLE_BLOCK_RE = /(<script[^>]*\bdata-odata="table"[^>]*>)([\s\S]*?)(<\/script>)/i;

/** Recompute a table chunk's formula cells into `rows` (`now` injected for deterministic
    dates). Returns the inner unchanged if there is no table block or it cannot be parsed. */
export function bakeTableInner(inner: string, now: number): string {
  const m = TABLE_BLOCK_RE.exec(inner);
  if (!m) return inner;
  let data: { rows?: unknown; formulas?: Record<string, string>; named?: Record<string, string> };
  try {
    data = JSON.parse(m[2]!);
  } catch {
    return inner;
  }
  if (!data || !Array.isArray(data.rows)) return inner;
  try {
    const res = recalc({ rows: data.rows as string[][], formulas: data.formulas, named: data.named }, {}, { now });
    (data as { rows: unknown }).rows = res.values;
  } catch {
    return inner;
  }
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return inner.slice(0, m.index) + m[1] + '\n' + json + '\n' + m[3] + inner.slice(m.index + m[0]!.length);
}
