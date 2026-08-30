# Origami Folio Web

Open an Origami **Fold** (`.origami.html`) in the browser, hand Origami's authoring tools to an
in-page AI agent over **WebMCP**, review what the agent proposes, and save the result back to
disk. No server, no account, no upload — the Fold is parsed, edited, rendered and saved entirely
in the tab.

It is a static site: `npm run build` produces a `dist/` you can drop on any static host
(origami.gratis included). Zero runtime npm dependencies, zero CDN references, no framework.

---

## Try it in five minutes (no agent needed)

```
npm install
npm run build
npm run serve
```

Then open **http://127.0.0.1:5173** in any modern browser. `npm run serve` rebuilds on save and
serves `dist/`; if you only want to serve an existing build, `node tests/e2e/static-server.mjs 5174`
does that with no watcher.

### Exercise everything from the test console

The **Test console** at the bottom of the page is the point of the build, not a debug hatch. It
drives the exact same tool registry the WebMCP shim hands to an agent, so plain Chrome with no
flags and nothing connected exercises the whole app.

A walk-through that touches every moving part:

1. Click **Sample Fold**. The deck renders in the preview — that is the real file playing on its
   own embedded runtime inside a sandboxed iframe.
2. In the console, click **`list_chunks`** → **Invoke**. Copy an `id` out of the result.
3. Click **`write_chunk`**, paste into the arguments box, and Invoke:
   ```json
   { "chunkId": "PASTE_ID_HERE",
     "html": "<div class=\"slide-inner\"><h2>Written by hand</h2><p class=\"lede\">No agent involved.</p></div>" }
   ```
   The preview re-renders immediately and the status bar turns to *Unsaved changes*.
4. Try to smuggle a `<template>` in — the content policy must refuse it:
   ```json
   { "chunkId": "PASTE_ID_HERE",
     "html": "<div class=\"slide-inner\"><template>nope</template></div>" }
   ```
   Expect `error` and a `violations` list; the deck does not change.
5. Click **`propose_chunk`** and Invoke:
   ```json
   { "chunkId": "PASTE_ID_HERE",
     "html": "<div class=\"slide-inner\"><h2>A tighter opening</h2></div>",
     "title": "Tighten the opening fold",
     "author": "agent:you" }
   ```
   Nothing changes in the deck. A card appears in the **Review queue** on the right.
6. Click **Accept** on that card. *Now* the deck changes. Click **Reject** on the next one and it
   does not. **There is no accept tool** — that is the deliberate design change (see below).
7. Click **`create_deck`** → Invoke to mint a blank Fold in the tab, then **`add_chunk`**.
8. Click **Save as…** and write the file somewhere. Re-open it with **Open…** — or just drag the
   `.origami.html` onto the page.
9. Reload the page mid-edit. A *Resume* button appears in the status bar with your unsaved work.

Keyboard: **Ctrl/Cmd+Enter** in the arguments box invokes the selected tool.

### Run the tests

```
npm run typecheck     # tsc over src/ and again over tests/ + build scripts
npm test              # vitest — 23 units against the real vendored @origami/format
npm run test:e2e      # playwright — 13 smokes in real Chromium against the built dist/
```

`tests/e2e/app.spec.ts` drives the console the way you would by hand.
`tests/e2e/webmcp-shim.spec.ts` stands a recording `modelContext` up in the page and calls the
tools the way an agent would — it covers the shim's probe order and result envelope, not Chrome's
implementation of WebMCP.

`npm run test:e2e` needs `npx playwright install chromium` once, and a current `dist/`
(`npm run build`).

---

## Trying it with a real WebMCP agent

The app registers its tools on whichever WebMCP surface the browser exposes. It probes
`document.modelContext` first (the surface in the [W3C
proposal](https://github.com/webmachinelearning/webmcp)), then `navigator.modelContext` (what much
of the ecosystem and the earlier Chrome previews expose). The status bar says which one it found,
or *not available (console only)* — it never claims a connection it does not have.

To get a real one, **verified against Chrome's own docs, not from memory**:

1. Install **Chrome Canary** (WebMCP landed as a flagged preview in Chrome 146; the Model Context
   Tool Inspector's own prerequisites ask for **150.0.7861.0 or higher**, so take a recent Canary).
2. Go to **`chrome://flags/#enable-webmcp-testing`**, set **“WebMCP for testing”** to **Enabled**,
   and relaunch. (Flag name confirmed at
   [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp).)
3. Load `http://127.0.0.1:5173`. The status pill should now read
   *WebMCP: connected via document.modelContext — 14 tools*.
4. To call the tools, install the **WebMCP – Model Context Tool Inspector** extension
   ([Chrome Web Store](https://chromewebstore.google.com/detail/gbpdfapgefenggkahomfgkhfehlcenpd),
   [source](https://github.com/beaufortfrancois/model-context-tool-inspector)). Its side panel lists
   every tool registered on the page, shows the input schema, and runs tools manually or through
   Gemini. It is written by a Chrome DevRel engineer but is **not** an officially supported Google
   product.
5. Or drive them straight from DevTools:
   ```js
   const tools = await document.modelContext.getTools?.();
   await document.modelContext.executeTool(tools[0], JSON.stringify({}));
   ```

Chrome's WebMCP origin trial runs from Chrome 149; until then the flag is the only way in. If none
of that is available on your machine, nothing is lost — the test console does everything.

**Untested claim, stated as such:** the Canary + flag + Inspector path above has *not* been run on
this machine (no Canary installed here). What IS verified is the shim's fallback: in stock
Chromium the app reports *not available (console only)* and all 14 tools still run — asserted by
`tests/e2e/app.spec.ts`. Confirm the Canary path by following steps 1–4 and checking the pill.

---

## Architecture

```
src/core/          the deck + tools; no DOM, so vitest exercises exactly what ships
  deck-store.ts      the ONE in-memory DeckModel; mutate() applies ops and notifies views
  proposal-store.ts  the review queue + accept/reject — NOT tools, the human's half
  tools.ts           the 14 tool defs, ported from vendor/mcp-reference/server.ts
  registry.ts        ToolRegistry + the document/navigator.modelContext feature-detect shim
  guide.ts           origami_guide's payload, built from the live KINDS/FORMAT_VERSION
  blank-deck.ts      create_deck's assembler (dynamic-imports @origami/runtime)
  starters.ts        FREE_STARTER_INNER / TABLE_STARTER_INNER, verbatim from the monorepo
  video-caps.ts      videoCapsNeeded, verbatim from the stdio server
  bake.ts            the table-baking NO-OP — see Known gaps
  ids.ts             Web Crypto ids + sha256 (the stdio server's node:crypto equivalents)
  result.ts          the {content:[{type:'text',text}]} envelope + guard/refuse

src/app/           the page
  main.ts            wiring: store, registry, WebMCP connect, toolbar, drag-drop, autosave
  preview.ts         serializeModel -> iframe srcdoc (sandbox=allow-scripts, never same-origin)
  review.ts          the proposal cards and their Accept / Reject buttons
  console.ts         the test console
  files.ts           File System Access open/save, download fallback, localStorage autosave
  index.html         the shell
  styles.css         the brand

build.mjs          esbuild -> dist/ (+ a dist size and external-URL report)
tests/unit/        vitest, against the real vendored format
tests/e2e/         playwright + a 40-line static server over dist/
vendor/            @origami/format dist, @origami/runtime dist, the stdio server (reference)
```

### How rendering works

There is no second renderer. `serializeModel(model)` produces the complete `.origami.html` — the
same bytes Save writes — and that string goes into an `<iframe srcdoc>`. The Fold carries its own
engine, so it renders itself. The frame gets `sandbox="allow-scripts"` and **never**
`allow-same-origin`: the deck's runtime may execute, but on an opaque origin with no reach into
this page, no storage, and no way to read the file you opened.

---

## The tools

Every name, description and schema is ported from `vendor/mcp-reference/server.ts`. Two deviations
apply to **all** of them:

* **No `deck` path argument.** One Fold is open in the tab. There is no served folder and no path
  handle, so the parameter would be unanswerable.
* **No file write.** “this WRITES THE FILE (atomic)” becomes “changes the open Fold and re-renders
  it”. You save with the Save button.

| Tool | Further deviation from the stdio server |
|---|---|
| `origami_guide` | Description verbatim. Payload adds `host`, `reviewProtocol`, `knownGaps` and `notAvailableHere`; `editProtocol` step 1 drops the path handle and step 5 (`save_deck`) becomes “the human saves”. |
| `get_kind_schema` | None — verbatim. |
| `create_deck` | Mints the deck **into the tab**, not onto disk: no served folder, no filename-collision loop, no `validateDeck`-on-write. Adds a guard that refuses when the open Fold has unsaved changes (the stdio version creates a new file and can destroy nothing; this one replaces what is on screen). |
| `list_chunks` | “Read fresh from the file every time” → “always reflects what the human is looking at”. |
| `read_chunk` | “the current file on disk” → “the Fold open in this tab”. Adds an explicit unknown-chunk error. |
| `write_chunk` | `force` dropped — there is no second writer to race in a tab. Adds one sentence pointing at `propose_chunk`. Result drops `written`/`bytes`, adds `note`. |
| `add_chunk` | `block` wording: “from define_block / list_block_defs” → “already defined in this Fold” (there is no `define_block` here). |
| `delete_chunk` | Adds one sentence pointing at `propose_delete`. |
| `set_header` | None beyond the two global ones. |
| `set_fold_type` | None beyond the two global ones. |
| `propose_chunk` | “STAGED for a human (or another agent) to review” → “STAGED as a review card in the human's page, which only THEY can accept or reject”. Ends with “there is deliberately no accept tool” instead of naming `accept_proposal` / `reject_proposal`. |
| `propose_add` | Same substitution as above. |
| `propose_delete` | Same substitution as above. |
| `list_proposals` | Adds “The human accepts or rejects them by clicking the cards in the page.” |

### Not registered, on purpose

`accept_proposal` and `reject_proposal` exist in the stdio server. **They are deliberately not
tools here.** A proposal renders as a card — kind, target, before/after, conflict flag — and only a
human click applies it. Accept runs through the same `applyOp` path a direct `write_chunk` uses, so
a reviewed change and a trusted change land identically; it keeps the stdio conflict gate (a chunk
that changed since the proposal refuses, never a silent overwrite) and the same `oby` provenance
stamp. The direct write tools still apply immediately: **proposals are the polite path, direct
writes the trusted path**, exactly as in the stdio server.

Also absent, with reasons the guide reports back to an agent: `save_deck`, `list_decks`,
`open_deck` (no filesystem), `define_block` / `list_block_defs` / `delete_block`,
`add_custom_fold`, `refresh_sources`.

### The content-policy gate

Every inner-content write — direct or accepted proposal — passes `validateSlideContent` from
`@origami/format` before any op is applied. A violation refuses the tool call with the policy's own
error text and leaves the model byte-identical. Active-but-well-formed content (scripts, styles,
remote URLs) is allowed and reported as `activeContent`, exactly as the Studio and the stdio server
do.

---

## Known gaps

* **Table formulas are not re-baked on write.** The stdio server calls `bakeTableInner`, which
  needs `@origami/calc`'s `recalc`. Only `@origami/format` and `@origami/runtime` are vendored, so
  there is no calc engine in the browser and `src/core/bake.ts` is an honest no-op. A `table` chunk
  keeps whatever `rows` the author supplied; `formulas` ride through untouched. The Fold stays
  valid, and the Studio re-bakes when it opens it. `origami_guide` reports this to agents under
  `knownGaps`. **To close it, `@origami/calc`'s `recalc` must be vendored into `vendor/`.**
* Proposals are per-session and in memory. The stdio server persists them to
  `~/.origami/proposals/` because the proposer and the reviewer are different processes; here they
  are the same page. A refresh keeps the deck (autosave) but drops the queue.
* Autosave uses `localStorage`. Every call is wrapped, so a private window or a full quota degrades
  to “no autosave” rather than a broken page — but a Fold with large embedded assets can exceed the
  ~5 MB origin quota and silently fail to autosave.
* No undo. `@origami/format` ships a `History` class that is not wired up yet.
* `Save as…` needs the File System Access API for a true save; elsewhere (Firefox, Safari) it falls
  back to a download of the same bytes.

## Vendored code

`vendor/` is built output copied from `C:\Repos\Origami Folio\origami` — see
`vendor/PROVENANCE.md`. `vendor/mcp-reference/server.ts` is Node code kept as a **read-only
reference** for tool names, descriptions and schemas; it is never imported or bundled.
