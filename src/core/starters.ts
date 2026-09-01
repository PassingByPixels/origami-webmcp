/* Copied verbatim from the Folio monorepo's packages/mcp/src/starters.ts (read-only reference)
   so a slide the web app adds and one the stdio server adds are identical. Not re-authored.

   Minimal valid inner for an added slide when the caller supplies no html. `free` and `table`
   have built-in starters — other data kinds (gantt, tracker) need their data block, which the
   AI builds from get_kind_schema. */

export const FREE_STARTER_INNER = `
  <div class="slide-inner">
    <h2 data-oedit="title">New fold</h2>
    <p class="lede" data-oedit="text">Write here.</p>
  </div>
`;

/** A starter ledger `table`: a tiny budget with live formulas + a named output. rows
    are pre-baked (the app re-bakes on write anyway — see bake.ts). Same shape as the
    Studio's TABLE_STARTER. No raw "<" inside the JSON block (the carrier invariant). */
export const TABLE_STARTER_INNER = `
  <div class="o-table-shell">
    <header class="o-table-head">
      <p class="eyebrow">Live component</p>
      <h2>Ledger table</h2>
    </header>
<script type="application/json" data-odata="table">
{
  "columns": [
    { "label": "Item", "align": "left" },
    { "label": "Qty", "align": "right" },
    { "label": "Unit", "align": "right" },
    { "label": "Total", "align": "right" }
  ],
  "rows": [
    ["Widgets", "3", "4", "12"],
    ["Gadgets", "2", "5", "10"],
    ["Total", "", "", "22"]
  ],
  "formulas": { "D1": "=B1*C1", "D2": "=B2*C2", "D3": "=SUM(D1:D2)" },
  "named": { "grandTotal": "=D3" }
}
</script>
    <div class="o-table" data-table-mount></div>
  </div>
`;
