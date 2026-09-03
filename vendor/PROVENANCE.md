# Vendored artifacts - provenance

Source repo: the Origami Folio monorepo (private)
Source state: Folio master @ 610e732 (2026-09-03 pm, two runtime CSS fixes on top of 41061b8
              card geometry + the 2026-09-02 optimize + UAT arcs: svg { text-rendering:
              geometricPrecision } - chart/diagram labels were painted at a stale scale under the
              card transform - and figure.o-chartfig reads --obw, so a chart can be narrowed like
              every other data figure). Vendor = the dists of that commit. Only runtime-dist/index.js
              (the stylesheet) and the css .d.ts files moved.
Previous:     master @ 41061b8 (2026-09-02 copy)
Copied: 2026-09-03

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
