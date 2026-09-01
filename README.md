# Origami Crane (working title) — Origami Folio for the open web

> **Goal:** turn **origami.gratis** into a serving station for making Origami files — for
> agents and humans alike — a second vehicle to experience Origami Folio with no Chrome
> extension and no install. For all intents and purposes a fork of Folio: same format, same
> embedded runtime, same calc engine, different shell. The full story: [docs/VISION.md](docs/VISION.md).

Open an Origami **Fold** (`.origami.html`) in the browser, hand Origami's authoring tools to an
in-page AI agent over **WebMCP**, and save the result back to disk. No server, no account, no
upload — the Fold is parsed, edited, rendered and saved entirely in the tab.

Every tool is registered the way the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) specifies — the page hands the agent its tools:

```js
document.modelContext.registerTool({
  name: "add_chunk",
  description: "Add a new fold to the open document",
  inputSchema: { type: "object", properties: { /* ... */ }, additionalProperties: false },
  execute: async (input) => { /* one validated write gate */ },
});
```

**An agent can run the whole job unattended.** All 29 tools are on the WebMCP surface: an agent
creates the deck, authors every kind, stages proposals, resolves them, and calls `save_deck`
without a human ever clicking anything. When a human *is* watching, staged proposals also render
as review cards they can Accept or Reject — the same code path, a second front door.

It is a static site: `npm run build` produces the whole of **origami.gratis** in one `dist/` you
can drop on any static host — the flower home page at the root, `privacy/`, `design/`, and the
Folio app under `folio/` ([docs/SITE.md](docs/SITE.md)). Every path is relative, so the same zip
hosts at a domain root or a subpath.

Zero runtime npm dependencies, no framework, and nothing is fetched from a CDN — the build FAILS
if that changes. `src/site/guard.mjs` holds the rule: in app code (`.js`/`.css`) any `https://` is
an offence; on a page an external URL is allowed only as an `<a href>` a human clicks, and a
`src=`, `<link href>` or `@import` to the network is an offence wherever it appears. The only
exceptions are an exact allowlist of strings that arrive inside the vendored `@origami` bundles:
the SVG namespace (`http://www.w3.org/2000/svg`), the video-embed URL TEMPLATES the deck runtime
builds when a Fold carries a video block, and one `origamilabs.nl` link. None of them loads app
code, and none is fetched unless a deck asks for it.

---

## Try it in five minutes (no agent needed)

```
npm install
npm run build
npm run serve
```

Then open **http://127.0.0.1:5173** in any modern browser for the site, or
**http://127.0.0.1:5173/folio/** to go straight to the app. `npm run serve` rebuilds on save and
serves `dist/`; if you only want to serve an existing build, `node tests/e2e/static-server.mjs 5174`
does that with no watcher.

### Exercise everything from the test console

The **Test console** at the bottom of the page is the point of the build, not a debug hatch. It
drives the exact same tool registry the WebMCP shim hands to an agent, so plain Chrome with no
flags and nothing connected exercises the whole app.

The tool list is grouped (Learn / Author / Review / File) and the arguments have two modes:
**Form**, generated from the tool's own inputSchema, and **JSON**. The form writes into the JSON
box, and the JSON box is what gets sent — so switch to **JSON** for the pasted calls below.

A walk-through that touches every moving part:

1. Click **Sample Fold**. The deck renders in the preview — that is the real file playing on its
   own embedded runtime inside a sandboxed iframe.
2. In the console, click **`list_chunks`** → **Invoke**. Copy an `id` out of the result.
3. Click **`write_chunk`**, paste into the arguments box, and Invoke:
   ```json
   { "chunkId": "PASTE_ID_HERE",
     "html": "<div class=\"slide-inner\"><h2>Written by hand</h2><p class=\"lede\">No agent involved.</p></div>" }
   ```
   The preview re-renders immediately, the change lands in the Activity rail, and the Save button picks up its unsaved-changes pip.
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
   Nothing changes in the deck. A card appears at the top of the **Activity rail** on the right.
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
9. Reload the page mid-edit. A resume card appears on the landing with your unsaved work.

Keyboard: **Ctrl/Cmd+Enter** in the arguments box invokes the selected tool.

### Run the tests

```
npm run typecheck     # tsc over src/ and again over tests/ + build scripts
npm test              # vitest — 95 units against the real vendored @origami/format + @origami/calc
npm run test:e2e      # playwright — 32 smokes: 24 in bundled Chromium, 8 in your installed Chrome
```

* `tests/e2e/app.spec.ts` drives the console the way you would by hand.
* `tests/e2e/webmcp-shim.spec.ts` stands a recording `modelContext` up in the page: probe order,
  registration payload, result envelope, and **both** proposal front doors (a human clicking the
  card, and an agent calling `accept_proposal`).
* `tests/e2e/agent-run.spec.ts` is the unattended run — **zero human clicks**, tools only:
  `origami_guide` → `get_kind_schema('venn')` → `create_deck(foldType:'scroll')` → a venn fold →
  a flow fold → `propose_chunk` → `accept_proposal` → `save_deck`, asserting the serialized deck
  carries both data blocks and the accepted change, and that the diagrams actually mounted.
* `tests/e2e/webmcp-native.spec.ts` runs that same unattended flow through the **real** WebMCP API
  in your **installed stable Chrome** — see “This is verified, not assumed” below. It skips loudly
  if you have no Chrome ≥ 146, and never touches your own Chrome profile. It also carries the
  measurements the rest of this README quotes: what Chrome does with tool annotations, and the
  three `SAVE (a|b|c)` tests behind “What a page can really save”.
* The units cover `inspect_render`'s rules as arithmetic (no browser needed), every guide recipe
  added to a real deck and re-validated, every fold starter, undo byte-compared against the Fold
  before and after, and each `save_deck` outcome shape. `app.spec.ts` is where the claims that
  need a real layout live: a recipe mounting and counting up, `inspect_render` finding a real
  overflow and a real blank fold, and a staged proposal surviving an actual page reload.

`npm run test:e2e` needs `npx playwright install chromium` once, and a current `dist/`
(`npm run build`).

---

## Trying it with a real WebMCP agent

The app registers its tools on whichever WebMCP surface the browser exposes. It probes
`document.modelContext` first (the surface in the [W3C
proposal](https://github.com/webmachinelearning/webmcp)), then `navigator.modelContext` (what much
of the ecosystem and the earlier Chrome previews expose). The status dot's popover says which one it found,
or *not available (console only)* — it never claims a connection it does not have.

**No Canary needed.** WebMCP ships behind a flag in **ordinary stable Chrome from version 146**
(minimum 146.0.7672.0). Four steps:

1. Use the Chrome you already have, as long as it is **146 or newer** — check at `chrome://version`.
2. Go to **`chrome://flags/#enable-webmcp-testing`**, set **“WebMCP for testing”** to **Enabled**,
   and relaunch. (Flag confirmed at
   [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp).)
3. Load `http://127.0.0.1:5173`. The status pill now reads
   **“WebMCP: connected via document.modelContext — 29 tools”**.
4. To call the tools, install the **WebMCP – Model Context Tool Inspector** extension
   ([Chrome Web Store](https://chromewebstore.google.com/detail/gbpdfapgefenggkahomfgkhfehlcenpd),
   [source](https://github.com/beaufortfrancois/model-context-tool-inspector)). Its side panel lists
   every tool registered on the page, shows the input schema, and runs tools manually or through
   Gemini. It is written by a Chrome DevRel engineer but is **not** an officially supported Google
   product.

Or drive them straight from DevTools — this is the real API, no extension required:

```js
const tools = await document.modelContext.getTools();          // 29 of them
const t = tools.find((x) => x.name === 'create_deck');
await document.modelContext.executeTool(t, JSON.stringify({ title: 'Hello' }));
```

`localhost` counts as a secure context, so the plain `http://127.0.0.1:5173` dev server is fine —
you do not need HTTPS.

### This is verified, not assumed

`tests/e2e/webmcp-native.spec.ts` proves it on a real browser: it launches the **installed stable
Chrome** (`channel: 'chrome'`) in a throwaway profile with WebMCP enabled from the command line,
and drives the app through Chrome's own `document.modelContext.getTools()` / `.executeTool()` —
no mock host anywhere in that file. Last run, on **Chrome 151.0.7922.174** — taken before
`move_chunk`, `set_chunk_meta`, `set_deck_meta`, `list_activity` and `export_deck` were added, so
the tool count below reads 24 and not 29; it is left as measured rather than edited to match:

```
  no flags                  -> {"document":false,"navigator":false,"secureContext":true}
  --enable-features=WebMCP  -> {"document":true,"navigator":true,"secureContext":true}
  Chrome 151.0.7922.174 getTools() -> 24 tools; inputSchema arrives as "string"
  annotations survive registration? YES
    origami_guide.annotations -> {"readOnlyHint":true,"untrustedContentHint":false}
    delete_chunk.annotations  -> {"readOnlyHint":false,"untrustedContentHint":false}
  drove 8 native executeTool calls on Chrome 151.0.7922.174; final Fold 391881 bytes
  SAVE (b) userActivation at the call -> {"isActive":false,"hasBeenActive":true}
  SAVE (b) downloads the browser actually STARTED -> 2
  SAVE (c) OPFS read-back -> {"size":391251,"hasVenn":true,"hasManifest":true}
  SAVE (a) {"quotaMB":10240,"storagePersisted":false,"handleIsStructuredCloneable":true}
```

**The command-line equivalent of the flag is `--enable-features=WebMCP`** — undocumented, found by
reading candidate feature names out of `chrome.dll` and testing them. Use it to script a browser;
use the `chrome://flags` toggle for everyday browsing. (`--enable-features=WebMCPTesting` also
works and additionally exposes `navigator.modelContextTesting`, a separate test-harness surface
this app does not use.) One trap worth knowing: the API is **not** present on `about:blank`, so
probe it on a real page or you will conclude the flag did nothing.

The spec skips loudly, with a banner explaining why, on any machine without Chrome ≥ 146 — a
skipped native proof must never read as a passing one. And if none of this is available to you,
nothing is lost: the test console does everything.

---

## Architecture

```
src/core/          the deck + tools; no DOM, so vitest exercises exactly what ships
  deck-store.ts      the ONE in-memory DeckModel; mutate() applies ops and notifies views
  proposal-store.ts  the review queue + accept/reject, shared by the cards and the tools
  tools.ts           the 29 tool defs: 21 ported from vendor/mcp-reference/server.ts, 8 web-only
  registry.ts        ToolRegistry + the document/navigator.modelContext feature-detect shim
  activity.ts        the ActivityLog every registry.invoke writes one entry into
  guide.ts           origami_guide's payload, built from the live KINDS/FORMAT_VERSION
  blank-deck.ts      create_deck's assembler (dynamic-imports @origami/runtime)
  starters.ts        FREE_STARTER_INNER / TABLE_STARTER_INNER, verbatim from the monorepo
  inspect.ts         inspect_render's rules — pure arithmetic over measured geometry
  recipes.ts         copy-paste free-card idioms for the guide, verbatim from the block palette
  fold-starters.ts   whole-fold starters, verbatim from the Studio palette's rail builders
  video-caps.ts      videoCapsNeeded, verbatim from the stdio server
  bake.ts            table formulas -> values on write, via the vendored @origami/calc
  ids.ts             Web Crypto ids + sha256 (the stdio server's node:crypto equivalents)
  result.ts          the {content:[{type:'text',text}]} envelope + guard/refuse

src/app/           the page
  main.ts            wiring: store, registry, WebMCP connect, toolbar, drag-drop, autosave
  preview.ts         serializeModel -> iframe srcdoc (sandbox=allow-scripts, never same-origin)
  measure.ts         inspect_render's off-screen measuring frame + injected measurer
  review.ts          the proposal cards and their Accept / Reject buttons
  console.ts         the test console
  files.ts           File System Access open/save (permission-checked, byte-verified), autosave
  opfs.ts            the Origin Private File System backstop + the "Download last save" pointer
  index.html         the shell
  styles.css         the brand

src/site/          the site around the tools (docs/SITE.md) — build-time only, never shipped
  parts.mjs          the ONE petal config + the flower SVG, the tool cards, header, footer
  guard.mjs          the no-external-URL rule, shared by build.mjs and its unit test
  index.html         home; privacy.html; design.html — markers filled by parts.mjs
  site.css           the site's own sheet (the :root tokens are spliced in from styles.css)

build.mjs          esbuild -> dist/folio/ + the static pages -> dist/
                   (dist size report; FAILS the build on an external URL reference)
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

Every name, description and schema is ported from `vendor/mcp-reference/server.ts`, bar the eight
web-only tools marked below. Two deviations apply to **all** of them:

* **No `deck` path argument.** One Fold is open in the tab. There is no served folder and no path
  handle, so the parameter would be unanswerable.
* **No file write.** “this WRITES THE FILE (atomic)” becomes “changes the open Fold and re-renders
  it”. You save with the Save button.

| Tool | Further deviation from the stdio server |
|---|---|
| `origami_guide` | Description verbatim. Payload adds `host`, `reviewProtocol`, `notAvailableHere` and **`recipes`**; `editProtocol` step 1 drops the path handle, step 4b covers `dryRun`, and step 5 explains `save_deck`'s two outcomes. Adds a **`topic`** argument (`contract` \| `kinds` \| `recipes` \| `starters` \| `issues` \| `tools`) that returns one section on its own. The default answer is the whole guide with three abridgements: `kinds` becomes an INDEX (name + placement per kind, no schemas) with `kindsHowTo` stating the free-card steer **once** instead of once per kind and naming the two routes to a schema, and the recipe cards' html and the starter catalog become one-line pointers. Nothing is dropped — each comes back in full from its own topic — and the default costs **15,310 bytes against 56,265** for everything inlined (measured by a unit test, which prints all eight figures on every run). |
| `get_kind_schema` | None — verbatim. |
| `create_deck` | Mints the deck **into the tab**, not onto disk: no served folder, no filename-collision loop. Adds a guard that refuses when the open Fold has unsaved changes, plus **`discard: true`** to override it (the stdio version creates a new file and can destroy nothing; this one replaces what is on screen, so an unattended agent has to say so out loud). `foldType` deck / scroll / ledger is unchanged. |
| `list_chunks` | “Read fresh from the file every time” → “always reflects what the human is looking at”. |
| `read_chunk` | “the current file on disk” → “the Fold open in this tab”. Adds an explicit unknown-chunk error. |
| `write_chunk` | `force` dropped — there is no second writer to race in a tab. Adds one sentence pointing at `propose_chunk`. Result drops `written`/`bytes`, adds `note`. |
| `add_chunk` | None beyond the two global ones. |
| `add_custom_fold` | Description verbatim bar the write clause. |
| `delete_chunk` | Adds one sentence pointing at `propose_delete`, and one naming `set_chunk_meta({hidden:false})` as the way back from a hide. |
| `move_chunk` | **Not in the stdio server at all.** Its op set carries no reorder, so a deck's order was whatever the inserts made it. `slide.move` is in `@origami/format` and `History` inverts it, so a page can offer the reorder a human gets by dragging the rail. `applyOp` **clamps** an out-of-range index; this refuses instead, because "moved to 9" on a 3-fold deck is an answer that lies. A move to the index the chunk is already at is reported, not applied — no dirty flag, no phantom undo step. |
| `set_chunk_meta` | **Not in the stdio server at all.** It reaches `slide.meta` only through `delete_chunk`'s hide. This is the rest of that op — label, notes, hidden — and `hidden:false` is the **only** route back from a hidden fold on this surface. Content and kind stay `write_chunk`'s job. |
| `set_deck_meta` | **Not in the stdio server at all.** Title (after creation) and theme. The trap it exists to avoid: `deck.theme` carries name **and** tokens together, `serializeModel` re-projects `<style id="origami-theme-css">` from those tokens **alone**, and both a Fold this app mints and the shipped sample carry `manifest.theme.tokens = {}` while their `:root` block holds the full set — so a naive patch (or even a bare rename) would strip every custom property out of the file. The tool reads the tokens actually in force out of that block and merges onto them. Token names are read from the vendored runtime, never invented: the four presets in `vendor/runtime-dist/themes.d.ts` set `bg`, `paper`, `ink`, `ink-soft`, `rule`, `rule-soft`, `accent`, `tint-a`, `tint-b`, `chrome`, `chrome-ink`, `chrome-soft`, `font-display`, `font-body`, and the deck CSS additionally reads `--chrome-mark`, `--chrome-mark-h` and `--chrome-pad`. |
| `list_activity` | **Not in the stdio server at all.** A process that exits between calls has no session to keep a feed for. `ToolRegistry.invoke` records one entry per call — so the console, the WebMCP shim and a replay all land in one list — with `seq`, `at`, `source` (`agent` \| `human` \| `console` \| `replay`), `tool`, `ok`/`error`, `targetId`, `ms` and a one-line summary built from the **scalar arguments only**: no slide html ever reaches the feed. 500 entries, oldest dropped; a gap in `seq` says so. Not persisted, and not the undo stack. |
| `export_deck` | **Not in the stdio server at all.** There the file on disk *was* the deck, so an agent could read it back itself; in a tab the bytes exist nowhere it can reach, and `save_deck` reports an outcome rather than content. Returns the complete `.origami.html` text — byte-identical to what the page renders — plus its size. It is the **agent's** copy and saves nothing: `save_deck` is still the only route to the human's disk, and the description says so, because an agent that ended on this one would leave the work stranded in its own context. Over 4 MB it refuses with the size instead of returning the payload. |
| `define_block` · `list_block_defs` · `delete_block` | Descriptions verbatim bar the write clause. |
| `set_header` · `set_fold_type` | None beyond the two global ones. |
| `list_starters` + `add_chunk(starter)` | **Not in the stdio server at all.** Its starters are two inner strings picked by `kind`, with no catalog. These are the Studio rail's whole-fold starters — roadmap, flowchart, node graph, drawing, venn, ledger — each a free card holding one seeded data block, ported verbatim from `packages/studio-core/src/lib/palette.ts`. `starter` also works on `propose_add`, and is refused alongside `html`/`block` rather than silently winning. |
| `inspect_render` | **Not in the stdio server at all.** It has no browser, so it cannot lay a deck out; this is the one thing a page can tell an agent that a file-writing process cannot. It renders the serialized Fold in a hidden, off-screen `sandbox="allow-scripts"` iframe with a measuring script appended after the deck's LAST `</body>`, walks every fold, and posts the geometry back by `postMessage` (matched on a nonce — a sandboxed frame's `event.origin` is the string `"null"`). Reports overflow, masthead clip, blank folds and colliding SVG labels. A fold it cannot put on screen comes back `measured:false` with the reason; a host with no layout says so for the whole deck. |
| `undo` | **Not in the stdio server at all.** A stdio call has no session, so it has no stack to unwind; a page does. Built on `@origami/format`'s `History`: `DeckStore.apply` records each op's inverse, one entry per tool call. Scope is stated in the description — it cannot cross a `create_deck` or a newly opened Fold (both reset the stack), it never touches bytes already written to disk, 50 steps deep, no redo. |
| `save_deck` | **Re-purposed, not just re-worded.** In the stdio server every edit had already written through, so `save_deck` was a re-validate. Here it is the only route out of the tab, and it reports three separate outcomes rather than one boolean: a verified handle write (`saved`), the OPFS backstop (`opfs.written`), and a fired download (`downloadStarted`). See **What a page can really save** for the measurements that shaped it. It never opens a picker (nobody would be there to click it) and **never throws for want of a handle**, so an unattended agent can always finish. |
| `propose_chunk` · `propose_add` · `propose_delete` | “STAGED for a human (or another agent) to review” → “STAGED as a review card in the human's page, which only THEY can accept or reject” **is gone as of round 2**; they now say the change is staged for a human *or* an agent to resolve. |
| `list_proposals` | Adds “The human accepts or rejects them by clicking the cards in the page.” |
| `accept_proposal` | “write the file immediately (no save_deck needed)” → applies to the open Fold; call `save_deck` when done. Adds a sentence on choosing between resolving it yourself and leaving the card for a watching human. |
| `reject_proposal` | Adds “The same action the human takes by clicking Reject”. |

### Tool annotations, and what Chrome does with them

Ten tools carry `readOnlyHint` (`origami_guide`, `get_kind_schema`, `list_chunks`, `read_chunk`,
`list_block_defs`, `list_starters`, `list_proposals`, `list_activity`, `inspect_render`,
`export_deck`) and three carry
`destructiveHint` (`create_deck`, `delete_chunk`, `delete_block`). A unit test calls every
read-only tool against a real deck and byte-compares the Fold before and after, so the hint has
to be true rather than merely declared.

**Measured on Chrome 151.0.7922.174**, annotations survive registration but are normalised into
Chrome's own vocabulary:

```
  getTools() per-tool keys: ["annotations","description","inputSchema","name","origin","title","window"]
  origami_guide.annotations -> {"readOnlyHint":true,"untrustedContentHint":false}
  delete_chunk.annotations  -> {"readOnlyHint":false,"untrustedContentHint":false}
```

`readOnlyHint` comes back. **`destructiveHint` is discarded outright**, and an
`untrustedContentHint` this app never sent is added. So a Chrome-hosted agent is never told by an
annotation that a tool is destructive — which is why every destructive tool says so in its
description, and why a unit test asserts that it does. They are still registered as written, for
hosts with a fuller vocabulary.

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

## What a page can really save

The demo writes a finished `.origami.html` into your Downloads folder with nobody clicking
anything, which raises a fair question: if that is possible, why does `save_deck` ever say the
human has to press Save?

**Because the demo does not save from the page.** `demo/author-demo.mjs` is a Node script. It
drives the browser, reads the finished deck out of the preview's `srcdoc`, and then calls
`writeFile` *itself*, as a process on your machine. Those bytes are written outside the sandbox.
Nothing the page can reach got a new power, and no amount of tool design inside the tab reproduces
it.

So the question was put to the browser instead. Everything below was measured on the installed
stable **Chrome 151.0.7922.174**, in a throwaway profile, by
`tests/e2e/webmcp-native.spec.ts` — the three `SAVE (a|b|c)` tests. Re-run them and the numbers
print themselves.

### (b) Can a tool call start a download with no user gesture?

**Yes — Chrome starts it.** The first attempt at this measurement was worthless and worth
recording: `page.evaluate()` runs *with* transient user activation, so a download fired from it
proves nothing. The real test schedules everything from a timer at page load, 6.5 s after
navigation, and records the activation state at the moment of the call:

```
  userActivation at the call -> {"isActive":false,"hasBeenActive":true}
  attempt 1 -> no throw;  attempt 2 -> no throw
  downloads the browser actually STARTED -> 2 ["gestureless-1.origami.html","gestureless-2.origami.html"]
```

Both downloads, not just the first — the second is where multiple-download gating would bite.

**The caveat is load-bearing.** Playwright runs with `acceptDownloads`, so a *"Download multiple
files?"* prompt that a default profile might raise is auto-accepted here. This proves Chrome
**starts** the download without a gesture; it does not prove an un-automated profile never asks.
And the page cannot observe where the file went in either case. So `save_deck` reports
`downloadStarted: true` and **never** counts it as a save.

### (c) The OPFS backstop

`save_deck` now always writes the complete Fold into the Origin Private File System — a real file
system, private to this origin, needing no permission and no gesture. Measured:

```
  save_deck -> {"saved":false,
                "opfs":{"written":true,"path":"saves/save-investigation.origami.html","bytes":391251},
                "downloadStarted":true,
                "durability":"in this browser only — retrievable by the human, but evictable and not on their disk"}
  OPFS read-back -> {"size":391251,"hasVenn":true,"hasManifest":true}
```

The file is read back and its size compared before the write is reported, so a truncated or
quota-failed write cannot pass as success. This replaces the old `localStorage` autosave as the
durable path: the origin quota measured **10240 MB** against localStorage's ~5 MB, which is the
gap a Fold with embedded images used to fall through *silently*.

Two things follow, and both are in the tool's own result. OPFS is **invisible** — nothing outside
this origin can read it — so the page grows a **Download last save** button, the human's route
back to those bytes. And `navigator.storage.persisted()` measured **false**, so the browser may
evict it: it is a backstop against a refresh or a crash, not a substitute for the human's disk.

### (a) Does a granted file handle survive to the next visit?

**Measured, and partly unmeasurable here.** What is true without a human:

```
  {"showSaveFilePicker":"function","showOpenFilePicker":"function",
   "queryPermissionOnHandle":"function","requestPermissionOnHandle":"function",
   "permissionOfAnOpfsHandle":"granted","handleIsStructuredCloneable":true,
   "quotaMB":10240,"storagePersisted":false}
```

A `FileSystemFileHandle` is structured-cloneable, so it **can** be kept in IndexedDB between
visits, and handles do expose `queryPermission` / `requestPermission`.

**What is NOT measured: whether a handle a human granted through `showSaveFilePicker` still
reports `granted` on a later visit.** Getting one requires a real click on a native OS dialog,
which no automated browser can drive, so this repo does not claim an answer. To settle it: press
**Save as…** once, reload, and read `handle.queryPermission({mode:'readwrite'})` before touching
anything. Persisting handles in IndexedDB is deliberately **not** implemented until that returns
`granted` — shipping it on an assumption would put an unverified promise in front of the human's
files.

What *is* implemented is the half that could be verified: `saveToHandle` checks
`queryPermission` **before** writing and reports a lapsed permission in words an agent can act on,
instead of throwing an opaque error, and it reads the file size back before reporting `saved:true`.

### So what does `save_deck` claim?

| Field | Means |
|---|---|
| `saved: true` | Bytes were written to a real file through a File System Access handle **and read back to confirm it**. The only outcome that is a save. |
| `opfs.written` | The complete Fold is in this browser's private file system. Real, retrievable via **Download last save**, evictable, not on the human's disk. |
| `downloadStarted` | A download was fired at the browser. Where it landed is unobservable from the page. Never counted as a save. |
| `durability` | One sentence covering all three, so an agent does not have to infer it from booleans and get it wrong. |

## Known gaps

* Proposals live in memory, and ride along in the autosave record so a refresh keeps them with
  the deck. They are still per-origin, not per-file: the queue is restored by the **Resume**
  button next to the deck it was saved with, and a proposal restored against a chunk that changed
  in the meantime still refuses with `conflicted` rather than overwriting. The stdio server
  persists to `~/.origami/proposals/` because its proposer and reviewer are different processes;
  here they are the same page.
* The *resume-after-refresh* autosave still uses `localStorage` (~5 MB), so a very large Fold can
  exceed it and fail to autosave. The **save** path no longer depends on it: `save_deck` writes the
  full Fold to OPFS, measured at a 10240 MB quota. Every storage call is wrapped, so a private
  window or a full quota degrades to “no autosave” rather than a broken page.
* `Save as…` needs the File System Access API for a true save; elsewhere (Firefox, Safari) it falls
  back to a download of the same bytes. `save_deck` DOES now attempt a gesture-less download when it
  holds no handle — measured to start on Chrome 151 with `userActivation.isActive === false` — but
  reports it as `downloadStarted`, never as saved, because the page cannot see where it landed. The
  OPFS copy is what makes the work safe either way. See “What a page can really save”.
* Cross-block `@block.output` table references do not resolve here. `recalc` is within-block, as it
  is in the stdio server; the Studio resolves them when it opens the Fold.

## Vendored code

`vendor/` is built output copied from `C:\Repos\Origami Folio\origami` — see
`vendor/PROVENANCE.md`. `vendor/mcp-reference/server.ts` is Node code kept as a **read-only
reference** for tool names, descriptions and schemas; it is never imported or bundled.
