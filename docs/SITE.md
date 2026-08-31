# origami.gratis — site spec

> Written 2026-09-01 by the lead session. Binding, like `docs/DESIGN.md` (which still governs
> the tool-shell chrome). This repo now builds the WHOLE origami.gratis site: the home page,
> the tool pages, and the static pages. One `npm run build` → one `dist/` → one zip → any
> static host. The rules of the house hold everywhere: no CDN code, no analytics, nothing
> leaves the tab, honest copy.

## Routes (all relative — the zip must host at a domain root or a subpath unchanged)

```
dist/
  index.html            home — the flower
  privacy/index.html    privacy page
  design/index.html     Origami Design — coming soon
  folio/                the full Folio Web app (today's app, moved intact)
  draw/                 mini tool: one draw block
  charts/               mini tool: one chart OR venn block
  gantt/                mini tool: one roadmap (gantt) block
```

Every page links home via the brand wordmark. Tool pages keep their shell; the subbrand tag
becomes the tool name (FOLIO · DRAW · CHARTS · GANTT).

## Home

Paper ground, same tokens as the tools. Sections top to bottom:

1. **Header**: crane mark · "Origami" (serif) · "GRATIS" small-caps tag.
2. **Hero — the flower.** An inline SVG, ~520px desktop, scaling by viewBox on mobile.
   Eight petals around a small center disc (the crane mark sits in the center). Petal =
   a kite (long diamond) pointing outward, drawn as TWO facet polygons split along its
   spine — the left facet a darker shade of the petal colour, the right lighter — plus a
   hairline crease down the spine, so it reads as folded paper (reference: the photo's
   copper/black kusudama, simplified). Petals at i×45°. Assignment:
   - Folio — green pair (accent family). Links `folio/`.
   - Draw — copper pair (warm, from the warn/copper family). Links `draw/`.
   - Charts — ink pair (near-black facets). Links `charts/`.
   - Gantt — sage pair (lighter green). Links `gantt/`.
   - Design — OUTLINED petal, dashed crease, tiny "soon" chip near its tip. Links `design/`.
   - Three remaining — pale rule-grey fills, low opacity, no label, not links. They are the
     room to grow; un-greying one later = one config row.
   Hover on an active petal: lift 4px along its own axis + show its name label beyond the
   tip. Whole petal is an `<a>`. Petal data lives in ONE config array (name, href, colour
   pair, active flag) — the flower renders from it.
3. **Tool cards** (the accessible nav — petals alone are hostile): one row (wraps on
   mobile), a card per tool: name, one-liner, status. Same order as petals. One-liners:
   - Folio: "Decks and documents. The whole editor, in the tab."
   - Draw: "Hand-drawn sketches and diagrams."
   - Charts: "Twelve chart types and a Venn."
   - Gantt: "Roadmaps on a real calendar."
   - Design: "Pages and posters. Coming soon."
4. **What is this** — three short paragraphs, ASD-STE register:
   - One file: every tool ends in a single `.origami.html` that plays on double-click,
     renderer inside, nothing to install.
   - Agents included: every page hands its tools to an agent over WebMCP; a human can drive
     every tool by hand in the same page. Link "connect your agent" → the enable steps
     (reuse the popover copy, inline here).
   - Private by construction: static site, no accounts, no analytics; documents are made
     and saved on your machine.
5. **Footer**: ☕ "Buy me a coffee" → `https://buymeacoffee.com/passingbypixels`
   (`target="_blank" rel="noopener"`, plain link, NEVER the BMC script/widget) ·
   Privacy · "Origami Labs · support@origami.gratis".

## Privacy page

Fresh copy for THIS site (the old privacy.html is Coder's — do not reuse). Plain page,
same header/footer. The whole truth in sections: static site (no analytics, no cookies of
ours, no accounts); documents live in the tab and save to your disk or your browser's own
storage, never uploaded; connecting an agent is between you and your agent host (WebMCP
runs in your browser — we never see the traffic); external links (Buy me a coffee) apply
their own policies after the click; contact support@origami.gratis. Effective date
2026-09-01.

## Design (coming soon) page

Minimal: header, one outlined petal motif, "Origami Design — a canvas for pages and
posters. One file, like everything here. Coming soon.", link home. No fake UI.

## Mini tools (draw / charts / gantt)

The Folio Web shell, mode-scoped. Each page:

- Auto-creates on load a single-fold Fold seeded with that tool's block (no landing — the
  canvas IS the landing; the replay button and Sample Fold do not exist here). Deck title
  defaults "Untitled drawing / chart / roadmap"; suggested filename follows.
- Registers a SCOPED registry (its own WebMCP toolset, per the VISION line "each page
  registering its own toolset"):
  - Common: `origami_guide` (a page-scoped guide: what this page is, the block's JSON
    schema from the format's own kindSchemaComment, the tool list, and a notAvailableHere
    pointing multi-fold work at /folio), `read_chunk`, `write_chunk` (raw escape hatch),
    `inspect_render`, `undo`, `save_deck`, `export_deck`, `list_activity`.
  - draw/ adds: `list_elements`, `add_element` (typed per the draw JSON schema; id/seed
    minted when absent), `update_element` (patch by id, unknown id refused),
    `remove_element`, `set_caption`.
  - charts/ adds: `get_data`, `set_chart` (full chart JSON, schema-validated),
    `set_venn` (the fold's figure becomes a venn), `set_caption`.
  - gantt/ adds: `get_roadmap`, `set_roadmap` (schema-validated), `set_caption`.
- Block tools build the figure markup EXACTLY per the kind schema and write through the
  same gate `write_chunk` uses — one code path, one validator. Bad data (hex, counts,
  ranges, unknown ids) is refused with the violation named, nothing applied.
- The rail, console (grouped), toasts, save semantics, status dot: unchanged.

## The support slot

At the BOTTOM of the Activity rail on every tool page: one quiet line, pinned under the
feed (`margin-top:auto`): ☕ "Free forever. Coffee helps." → the BMC link. One component,
one config const (`SUPPORT_SLOT`), so a different sponsor unit can replace it later
without touching the rail. It never pushes the feed and never animates.

## Build & guards

- `build.mjs` grows entry points per tool page and copies the static pages; each tool page
  is self-contained under its directory (relative `./` assets, as today).
- The no-external-URL guard changes meaning, not strength: in APP CODE (js/css) any
  `https?://` still fails the build; in the static html pages an `https://` is allowed
  ONLY inside an `<a href>` (the BMC link) — a `src=`, `@import`, or `<link href>` to the
  network anywhere is still a build failure.
- Deliverable: `dist/` zips as-is (the lead cuts the zip).

## Out of scope (this round)

Real ad serving (the slot is a link), tool-to-tool document handoff, /design beyond the
coming-soon page, dark mode (unchanged from DESIGN.md).
