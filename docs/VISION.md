# Origami Crane — vision and goal

> Working title. The product needs a catchier name than "Web MCP"; **Origami Crane** is the
> current proposal (the brand mark is a folded crane, and a crane is also the machine that
> builds things). The name is one sweep away from changing — nothing structural hangs on it.

## The goal, in one paragraph

Turn **origami.gratis** into a serving station for making Origami files — for agents and
humans alike. It is a second vehicle to experience Origami Folio: open a browser, get the
whole thing. No Chrome extension, no desktop install, no account, no server-side state. A
human gets a page that opens, renders and saves `.origami.html` Folds. An agent that reaches
the same page over **WebMCP** gets the full authoring toolset and can build a complete Fold
unattended. The output is the same single self-contained file either way.

## What this is

- **For all intents and purposes, a fork of Origami Folio** — the same format, the same
  embedded runtime, the same calc engine, a different shell. The Folio monorepo's built
  packages (`@origami/format`, `@origami/runtime`, `@origami/calc`) are vendored as-is
  (`vendor/PROVENANCE.md` pins the source commit); this repo adds the browser shell, the
  WebMCP tool surface, and the agent-experience layer (guide recipes, `inspect_render`,
  dry-run, undo, starters, proposals-with-review).
- **A static site.** `npm run build` → `dist/` → any static host. Zero runtime
  dependencies, nothing fetched from a CDN, nothing leaves the tab.
- **Agent-first, human-friendly.** Every capability is a tool an agent can call; the page
  UI (preview, review cards, test console) is the human's window onto the same registry.

## What this is not

- Not a replacement for the Folio extension or desktop app — they keep the richer editing
  surface (the two-frame Studio, direct manipulation, Go Live, connectors).
- Not a cloud service. The deck lives in the tab; persistence is the user's disk (File
  System Access), a download, or the browser's own private storage as a backstop.
- Not a fork that drifts: format changes land in the Folio monorepo first and flow here by
  refreshing `vendor/` (procedure in `vendor/PROVENANCE.md`).

## Why it matters

The Folio agent story used to require installation: the stdio MCP server in an agent's
config, or the extension plus a native-messaging relay. WebMCP inverts the distribution:
**the page hands the agent its tools**. Any browser-driving agent — ChatGPT's browser,
Chrome with the WebMCP flag, anything that speaks the API — navigates to the site and can
author Origami documents from a cold start (`origami_guide` teaches the whole contract in
one call). Origami stops being a thing you install and becomes a thing an agent can find.

## Where it stands (2026-08-31)

- 29 tools registered. The 24 of them that existed on 2026-08-31 are proven end-to-end on
  the **native** WebMCP surface of installed stable Chrome 151 (no mocks, no Canary —
  `--enable-features=WebMCP` or `chrome://flags/#enable-webmcp-testing`); the five added
  since (`move_chunk`, `set_chunk_meta`, `set_deck_meta`, `list_activity`, `export_deck`)
  are unit-proven only, and the e2e suite's hard-coded tool counts still read 24.
- An unattended agent has authored a 6-fold demo deck (venn, draw, swim-lane flow, chart,
  multi-column scroll) through Chrome's own `executeTool`; the artifact passes a hostile
  standalone audit.
- 125 unit tests, 32 e2e (24 bundled Chromium + 8 installed Chrome), typecheck clean.
- Save semantics measured, not assumed — see "What a page can really save" in the README.

## Roadmap

1. **Deploy to origami.gratis** (the domain is freed by the origamilabs.nl move; serve this
   app as a page/subpath — one domain can carry future sibling tools, each page registering
   its own WebMCP toolset).
2. **Handle persistence** — one manual experiment (Save as… once, reload, read
   `queryPermission`) decides whether silent write-through-handle ships.
3. **Draw primitives** — higher-level sketch tools (shapes, arrows, labels) so agents can
   draw without hand-writing stroke coordinates.
4. **Real-model description audit** — drive the tool surface with an actual model (Tool
   Inspector's model path, or a local model harness) and tune descriptions as prompts.
5. Smaller: OPFS-backed autosave for the resume path, cross-block `@block.output` recalc.
