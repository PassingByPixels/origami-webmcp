# Vendored artifacts - provenance

Source repo: the Origami Folio monorepo (private)
Source state: Folio opt/lean-2026-09 @ f3888a9 (the 2026-09-02 optimize + UAT arcs, merged: format
              complexity batch 1, runtime batches 3+5, runtime fixes, tracker v2 generic columns +
              collapsible options + attached listboxes, ledger sole-sheet tabName rule, ledger
              headroom/fit). Pushed to master the same day.
Previous:     master @ fc7cece (2026-08-30 copy)
Copied: 2026-09-02

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
