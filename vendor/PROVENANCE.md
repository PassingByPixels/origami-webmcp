# Vendored artifacts — provenance

Source repo: C:\Repos\Origami Folio\origami (gitea GitAdmin/origami)
Source state: master @ 7b94bad + uncommitted diagram-UAT-round-2 working tree
Copied: 2026-08-30

- format-dist/    = packages/format/dist   (built ESM + d.ts; zero deps, browser-safe)
- runtime-dist/   = packages/runtime/dist  (viewer IIFE + assembleDeck ESM; fixtures pruned)
- mcp-reference/  = packages/mcp/src/server.ts (READ-ONLY reference: tool names,
                    descriptions, schemas, origami_guide text. Node/stdio code —
                    do NOT import it; port definitions from it.)

Refresh procedure: rebuild the source repo (npm run build), re-copy, update this file.
