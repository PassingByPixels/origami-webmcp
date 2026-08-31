# Folio Web — shell design spec

> Written 2026-08-31 by the lead session, after a visual audit of the shipped shell.
> This is the binding spec for the app chrome (`src/app/`). The deck itself (the Folio
> runtime inside the preview) is out of scope — it is already the best thing on the page,
> and the shell's job is to frame it, not compete with it.

## Principles

1. **The deck is the object; the shell is the desk.** Warm paper ground, hairline rules,
   one green accent. The shell recedes; identity moments (brand, section heads, landing
   headline) get the serif. No new colours, no shadows heavier than a whisper, no icon
   fonts, no CSS framework, no new dependencies.
2. **The activity feed is the product's story.** An agent authoring a deck while the human
   watches IS the pitch. The feed narrates it; the preview follows it.
3. **Human surface speaks human.** "WebMCP", tool names and JSON live in the console and
   the agent-access popover. Everything else is plain language.
4. **Every state is honest.** No control that silently loses work; no status line that
   claims more than was measured. (House rule inherited from the tool layer.)

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ topbar: brand · deck title (center) · status dot · buttons     │ 60px
├──────────────────────────────────────────────┬─────────────────┤
│ stage: framed preview                        │ activity rail   │
│   (16px gutter, 1px rule, 8px radius,        │ 320px, paper    │
│    shadow ≤ rgba(26,26,26,.05))              │                 │
│   toasts bottom-left over the stage          │                 │
├──────────────────────────────────────────────┴─────────────────┤
│ tool console (collapsed by default)                            │
└────────────────────────────────────────────────────────────────┘
```

The old 34px status bar row is gone. Its tenants move:
- WebMCP status → the **status dot** in the topbar (popover on click).
- Save state → the **Save button** (state dot + its menu).
- `say()` messages → **toasts**, bottom-left, stack of ≤3, 5s auto-dismiss, errors sticky
  with a close ×.
- Resume-last-session → a **card on the landing** (empty state).

## Topbar

- Left: crane mark 26px · "Origami" (serif 20px) · "FOLIO WEB" small-caps tag (the tag is
  one string — swap when the product name lands).
- Center: deck title only (serif 15px, ink-soft, ellipsis). No filename here.
- Right: status dot · `New` · `Open…` · `Save` (primary, with a chevron menu).
  - **Status dot**: 8px circle. Green = agent access on (popover: "Agent access is on —
    29 tools registered. An agent in this browser can author this Fold."), grey = off
    (popover: what WebMCP is in one line + how to enable: `chrome://flags/#enable-webmcp-testing`
    or `--enable-features=WebMCP`, then reload), amber = partial (some tools refused).
  - **Save menu** (chevron on the Save button): filename + save-state line ("Unsaved
    changes" / "Saved to …" / "Not on disk yet"), `Save as…`, and `Download last save
    (N KB)` when browser storage holds one.
  - Save button carries a small state dot: amber when dirty, green just after a save.
- `Sample Fold` leaves the toolbar → landing.

One popover primitive serves both (status dot + save menu): absolutely positioned card,
1px rule border, 8px radius, closes on outside click and Escape. No library.

## Activity rail (replaces the Review queue)

- Width 320px, paper white, hairline left rule.
- Header: "Activity" (serif 16px) + live indicator: while a tool call is in flight, a
  pulsing green dot + the tool name (mono 11px). Idle = nothing.
- Entries newest-first, quiet rows (not cards): chip (ADD / EDIT / MOVE / META / HIDE /
  DELETE / SAVE / EXPORT / UNDO / OPEN — 9.5px caps, bordered like the old `.card-action`)
  · one-line summary (12px, ink-soft) · relative time (10.5px, ink-faint, right-aligned).
  Errors take the warn palette. Human/console/agent/replay actions all land in the same
  feed (source field from core ActivityLog).
- The newest *undoable* entry shows a small ghost `Undo` button. Undo is a stack — only
  the top is safely reversible, so exactly one entry ever offers it. The button calls the
  `undo` tool through the registry (so the undo logs itself).
- Proposal cards render inline in the feed (existing card component, restyled to the row
  rhythm). The propose/review machinery is unchanged.
- Clicking an entry that targets a fold navigates the preview to that fold (bridge below).
- Empty feed: "Agent activity lands here." + when agent access is off, one quiet line
  linking the status popover.

## Preview bridge

`Preview` appends a small marked `<script>` to the srcdoc copy ONLY (the save path
serializes separately and stays byte-honest). The bridge:

1. Listens for `{type:'origami-goto', index}` postMessage and drives the runtime's own
   navigation (read `vendor/runtime-dist` for the cleanest hook; cite it in a comment).
2. Reports the current fold index to the parent on change, so re-renders restore position
   instead of yanking the viewer back to fold 1 — and agent writes can follow the newest
   change.
3. Hides the runtime's **Edit** affordance inside the preview — but FIRST verify the trap
   live (click Edit in the preview, type, invoke any write tool, observe whether the edit
   survives) and record what was observed. If edits somehow persist, leave Edit alone and
   report.

The frame is an opaque origin, so `targetOrigin:'*'` is unavoidable; the bridge must
ignore any message that does not match its exact shape.

## Landing (the empty state is the product page)

Centered column, max-width 560px:
- Crane mark 56px.
- H1 (serif 34px): **"Open a Fold."**
- Lede: "Origami decks and documents are single `.origami.html` files that play anywhere.
  Drop one here to read or edit it — or connect an agent and watch it author one for you.
  Nothing leaves this machine."
- Action row: `▶ Watch an agent build a deck` (primary) · `Sample Fold` · `New blank Fold`.
- Quiet link below: "Connect your agent" → opens the status popover.
- Resume card when browser storage holds unsaved work: "Unsaved work from {date} —
  {name}" `Resume` `Discard`.
- Drop veil unchanged.

## Demo replay

- The 6-fold demo build's tool-call sequence moves to a shared data module
  (`src/app/demo-script.ts`, ordered `{tool, args}[]`), sourced from
  `demo/author-demo.mjs`. `npm run demo` must keep working — single-source it if node can
  import the module trivially, otherwise duplicate WITH header comments naming the twin.
- The landing button replays the calls through `registry.invoke` with `source:'replay'`,
  ~900ms apart. The rail narrates; the preview follows the newest fold. A `Stop` control
  shows during replay (stops cleanly, keeps what was built). No `save_deck` at the end —
  no surprise downloads. Finish toast: "Built by replaying N recorded tool calls — every
  step is in the Activity feed."
- A dirty open Fold → the usual confirm-discard before starting.

## Tool console

- Visible label: **"Tool console"** (testids unchanged).
- Collapsed by default.
- The flat 24→29 tool list gains small-caps group headers: **Learn** (origami_guide,
  get_kind_schema, list_starters, list_block_defs, list_chunks, read_chunk,
  inspect_render, list_proposals, list_activity) · **Author** (create_deck, add_chunk,
  add_custom_fold, write_chunk, move_chunk, set_chunk_meta, delete_chunk, define_block,
  delete_block, set_header, set_deck_meta, set_fold_type, undo) · **Review** (propose_*,
  accept_proposal, reject_proposal) · **File** (save_deck, export_deck).
- Args: a form generated from each tool's inputSchema (string→input, or textarea when the
  property is `html` or maxLength>200; integer→number; boolean→checkbox; enum→select;
  object/array→JSON textarea), with a Form | JSON mode toggle. Switching form→JSON
  serializes; JSON→form parses when possible. The JSON sent is always what the box shows.

## Type & rhythm

Serif (Georgia stack) only for: brand, deck title, landing H1, rail header, proposal
titles. Everything else system sans. Mono for tool names/code. Sizes: 34 landing / 20
brand / 16 rail header / 15 title / 13 UI / 12 secondary / 11–11.5 mono. 8px spacing grid.
Existing tokens in `styles.css` stay; add nothing outside them.

## Out of scope (this round)

Dark mode; mobile-specific layout beyond the existing 900px stack; rail collapse; the
product rename (one string swap when decided).
