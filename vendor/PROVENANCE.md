# Vendored artifacts - provenance

Source repo: the Origami Folio monorepo (private)
Source state: Folio tag v0.4.9 @ b0c2805 (2026-09-23: calendar rail + notes popup,
              table in-block grow, tracker chrome + top-pin, Ledger first in Data). Vendor =
              the dists of that commit. The _grp/_ledger/_r1 fixture folders no longer exist
              at source - nothing pruned on this copy.
Previous:     master @ 610e732 (2026-09-03 copy)
Copied: 2026-09-24

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

## EOL trap when building on Windows (hit 2026-09-24)

A checkout with core.autocrlf=true gives CRLF sources, and the built runtime IIFE then carries
real CRLF line breaks. The 0.4.6+ format preserves a deck's EOL and detects it with a blunt
`text.includes('\r\n')` — so an embedded CRLF runtime flips the whole deck's eol and every
replaced slide inner is normalized to CRLF, breaking the byte-exact undo tests. Before copying:
set core.autocrlf=false in the build worktree, `git checkout -- .`, rebuild, and verify the
IIFE has 0 CR bytes (this copy: verified 0).
