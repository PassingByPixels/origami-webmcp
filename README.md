# Origami Folio Web

Open an Origami **Fold** (`.origami.html`) in the browser, hand Origami's authoring tools to an
in-page AI agent over **WebMCP**, and save the result back to disk. No server, no account, no
upload — the Fold is parsed, edited, rendered and saved entirely in the tab.

**An agent can run the whole job unattended.** All 21 tools are on the WebMCP surface: an agent
creates the deck, authors every kind, stages proposals, resolves them, and calls `save_deck`
without a human ever clicking anything. When a human *is* watching, staged proposals also render
as review cards they can Accept or Reject — the same code path, a second front door.

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
   does not. An agent reaches the same two outcomes with `accept_proposal` / `reject_proposal` —
   run `list_proposals`, then `accept_proposal` with the id, and watch the card clear itself.
7. Click **`create_deck`** → Invoke to mint a blank Fold in the tab, then **`add_chunk`**.
   Pass `{"kind":"table"}` and look at the rendered totals: the formulas were baked by the real
   calc engine on write.
8. Click **Save as…** and write the file somewhere. Re-open it with **Open…** — or just drag the
   `.origami.html` onto the page. Now invoke **`save_deck`**: because the page holds a writable
   handle, it writes that file. Invoke it on a Fold you created in the tab instead and it reports
   `saved: false` and tells you to press Save.
9. Reload the page mid-edit. A *Resume* button appears in the status bar with your unsaved work.

Keyboard: **Ctrl/Cmd+Enter** in the arguments box invokes the selected tool.

### Run the tests

```
npm run typecheck     # tsc over src/ and again over tests/ + build scripts
npm test              # vitest — 43 units against the real vendored @origami/format + @origami/calc
npm run test:e2e      # playwright — 17 smokes in real Chromium against the built dist/
```

* `tests/e2e/app.spec.ts` drives the console the way you would by hand.
* `tests/e2e/webmcp-shim.spec.ts` stands a recording `modelContext` up in the page: probe order,
  registration payload, result envelope, and **both** proposal front doors (a human clicking the
  card, and an agent calling `accept_proposal`).
* `tests/e2e/agent-run.spec.ts` is the unattended run — **zero human clicks**, tools only:
  `origami_guide` → `get_kind_schema('venn')` → `create_deck(foldType:'scroll')` → a venn fold →
  a flow fold → `propose_chunk` → `accept_proposal` → `save_deck`, asserting the serialized deck
  carries both data blocks and the accepted change, and that the diagrams actually mounted.

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
   *WebMCP: connected via document.modelContext — 21 tools*.
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
Chromium the app reports *not available (console only)* and all 21 tools still run — asserted by
`tests/e2e/app.spec.ts`. Confirm the Canary path by following steps 1–4 and checking the pill.

---

## Architecture

```
src/core/          the deck + tools; no DOM, so vitest exercises exactly what ships
  deck-store.ts      the ONE in-memory DeckModel; mutate() applies ops and notifies views
  proposal-store.ts  the review queue + accept/reject, shared by the cards and the tools
  tools.ts           the 21 tool defs, ported from vendor/mcp-reference/server.ts
  registry.ts        ToolRegistry + the document/navigator.modelContext feature-detect shim
  guide.ts           origami_guide's payload, built from the live KINDS/FORMAT_VERSION
  blank-deck.ts      create_deck's assembler (dynamic-imports @origami/runtime)
  starters.ts        FREE_STARTER_INNER / TABLE_STARTER_INNER, verbatim from the monorepo
  video-caps.ts      videoCapsNeeded, verbatim from the stdio server
  bake.ts            table formulas -> values on write, via the vendored @origami/calc
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
tests/fixtures.ts  venn + flow slide markup shared by both suites
tests/unit/        vitest, against the real vendored format + calc
tests/e2e/         playwright + a 40-line static server over dist/
vendor/            @origami/format, @origami/runtime and @origami/calc dists,
                   plus the stdio server (read-only reference)
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
| `origami_guide` | Description verbatim. Payload adds `host`, `reviewProtocol` and `notAvailableHere`; `editProtocol` step 1 drops the path handle and step 5 explains `save_deck`'s two outcomes. |
| `get_kind_schema` | None — verbatim. |
| `create_deck` | Mints the deck **into the tab**, not onto disk: no served folder, no filename-collision loop. Adds a guard that refuses when the open Fold has unsaved changes, plus **`discard: true`** to override it (the stdio version creates a new file and can destroy nothing; this one replaces what is on screen, so an unattended agent has to say so out loud). `foldType` deck / scroll / ledger is unchanged. |
| `list_chunks` | “Read fresh from the file every time” → “always reflects what the human is looking at”. |
| `read_chunk` | “the current file on disk” → “the Fold open in this tab”. Adds an explicit unknown-chunk error. |
| `write_chunk` | `force` dropped — there is no second writer to race in a tab. Adds one sentence pointing at `propose_chunk`. Result drops `written`/`bytes`, adds `note`. |
| `add_chunk` | None beyond the two global ones. |
| `add_custom_fold` | Description verbatim bar the write clause. |
| `delete_chunk` | Adds one sentence pointing at `propose_delete`. |
| `define_block` · `list_block_defs` · `delete_block` | Descriptions verbatim bar the write clause. |
| `set_header` · `set_fold_type` | None beyond the two global ones. |
| `save_deck` | **Re-purposed, not just re-worded.** In the stdio server every edit had already written through, so `save_deck` was a re-validate. Here it is the only route to disk: it re-validates, then writes the file if the page holds a writable File System Access handle, and otherwise persists the working copy in the browser and reports that the human must press Save. It never opens a picker (nobody would be there to click it) and **never throws for want of a handle**, so an unattended agent can always finish. |
| `propose_chunk` · `propose_add` · `propose_delete` | “STAGED for a human (or another agent) to review” → “STAGED as a review card in the human's page, which only THEY can accept or reject” **is gone as of round 2**; they now say the change is staged for a human *or* an agent to resolve. |
| `list_proposals` | Adds “The human accepts or rejects them by clicking the cards in the page.” |
| `accept_proposal` | “write the file immediately (no save_deck needed)” → applies to the open Fold; call `save_deck` when done. Adds a sentence on choosing between resolving it yourself and leaving the card for a watching human. |
| `reject_proposal` | Adds “The same action the human takes by clicking Reject”. |

### Two front doors on one code path

A staged proposal can be resolved **either** by a human clicking Accept / Reject on its card
**or** by an agent calling `accept_proposal` / `reject_proposal`. Both routes run the same
`ProposalStore.accept` / `.reject`: the same `applyOp` a direct `write_chunk` uses, the same
conflict gate (a chunk that changed since the proposal refuses with a 3-way view — never a silent
overwrite), and the same `oby` provenance stamp. The direct write tools still apply immediately:
**proposals are the polite path, direct writes the trusted path**, exactly as in the stdio server.

> v1 of this app registered no accept tool, on the theory that a human should always be the one to
> apply a change. That was overturned: a WebMCP host whose loop cannot close without a human is not
> a host an agent can use. The review cards stayed.

### Still not registered

`list_decks`, `open_deck` and `refresh_sources` — all filesystem- or credential-bound. The guide
reports each one back to an agent under `notAvailableHere` with the reason, so a model that knows
the stdio server is told why its tool is missing instead of guessing.

### The content-policy gate

Every inner-content write — direct or accepted proposal — passes `validateSlideContent` from
`@origami/format` before any op is applied. A violation refuses the tool call with the policy's own
error text and leaves the model byte-identical. Active-but-well-formed content (scripts, styles,
remote URLs) is allowed and reported as `activeContent`, exactly as the Studio and the stdio server
do.

---

## Known gaps

* Proposals are per-session and in memory. The stdio server persists them to
  `~/.origami/proposals/` because the proposer and the reviewer are different processes; here they
  are the same page. A refresh keeps the deck (autosave) but drops the queue.
* Autosave uses `localStorage`. Every call is wrapped, so a private window or a full quota degrades
  to “no autosave” rather than a broken page — but a Fold with large embedded assets can exceed the
  ~5 MB origin quota and silently fail to autosave.
* No undo. `@origami/format` ships a `History` class that is not wired up yet.
* `Save as…` needs the File System Access API for a true save; elsewhere (Firefox, Safari) it falls
  back to a download of the same bytes. `save_deck` never falls back to a download — a download is
  a user gesture, and an unattended agent has no gesture to give — so on those browsers an agent
  always ends with “ask the human to press Save”.
* Cross-block `@block.output` table references do not resolve here. `recalc` is within-block, as it
  is in the stdio server; the Studio resolves them when it opens the Fold.

## Vendored code

`vendor/` is built output copied from `C:\Repos\Origami Folio\origami` — see
`vendor/PROVENANCE.md`. `vendor/mcp-reference/server.ts` is Node code kept as a **read-only
reference** for tool names, descriptions and schemas; it is never imported or bundled.
