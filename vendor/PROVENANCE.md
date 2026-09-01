# Vendored artifacts — provenance

Source repo: the Origami Folio monorepo (private)
Source state: master @ fc7cece — "0.4.3 UAT close-out: origamilabs.nl link sweep, swim-lane
              invariant, Venn label gestures, What's New" (the venn/lane/wrap arc, committed)
Copied: 2026-08-30 (refresh; the first copy was 7b94bad + an uncommitted working tree)

- format-dist/    = packages/format/dist   (built ESM + d.ts; zero deps, browser-safe)
- runtime-dist/   = packages/runtime/dist  (viewer IIFE + assembleDeck ESM; fixtures pruned)
- calc-dist/      = packages/calc/dist     (recalc — the authoring-side formula engine)
- mcp-reference/  = packages/mcp/src/server.ts (READ-ONLY reference: tool names,
                    descriptions, schemas, origami_guide text. Node/stdio code —
                    do NOT import it; port definitions from it.)

Pruned from runtime-dist on copy: the `_grp`, `_ledger` and `_r1` fixture folders.

## What changed at fc7cece (all ADDITIVE — no symbol this app uses moved)

- runtime `venn.d.ts`: + `fitVennLabelSize`. `wrapVennLabel` keeps its signature but no longer
  breaks a word at character boundaries — an over-wide word is shrunk to fit, never cut in half.
- format `venn-data`: + `VENN_SIZE_MIN` / `VENN_SIZE_MAX` / `VENN_NUDGE_MAX`.
- runtime `diagram.d.ts`: + `addDiagramLane` / `removeDiagramLane`.

Refresh procedure: rebuild the source repo (npm run build), re-copy the three dists, prune the
fixture folders, update this file, then re-run BOTH suites before trusting anything.
