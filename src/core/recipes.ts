/* Copy-paste inners for the free-card idioms an agent cannot guess.
   ------------------------------------------------------------------------------------------
   The `free` kind schema names its vocabulary in one line — ".eyebrow · h1/h2 · .lede · p ·
   ul>li · .cols>.col · .card-grid>.stat-card · table.o-table · blockquote.o-quote · a.o-btn ·
   span.o-pill · hr.rule" — and then stops. A model that has never seen a Fold can read that and
   still not know that a stat card's number lives in a `.big` with `data-count-to`, or that the
   column count is an ATTRIBUTE rather than a class. These are the missing examples.

   PROVENANCE. Block markup is copied VERBATIM out of the Folio monorepo at
   C:\Repos\Origami Folio\origami (read-only reference), same discipline as starters.ts — cited
   per recipe. What is NOT verbatim, and is marked as such: the `<div class="slide-inner">`
   wrapper (the palette inserts blocks INTO a fold, so no palette entry carries one), and the
   two multi-column recipes, which the monorepo has no rendered example of at all.

   TWO THINGS DELIBERATELY CHANGED from the monorepo markup, both because this host lacks a
   tool the Studio has:
     1. The cover template's `<img class="o-cover-mark" data-oasset="brand-logo">` is dropped.
        No tool here writes the deck's asset table, so that reference would resolve to nothing
        and validateDeck would fail the whole Fold with `assets.ref` — save_deck would refuse it.
     2. image-figure uses an inline `data:` URI, which the free schema tells you never to do.
        Same reason, and the trade is spelled out in that recipe's caveat.

   Every recipe is asserted end to end in tests/unit/tools.test.ts: added through add_chunk to a
   real deck, then validateDeck must return [] and activeContentFlags must be empty (a recipe
   that put the deck behind the padlock would be a trap, not a help). */

export interface Recipe {
  key: string;
  /** What it is, in the agent's own terms. */
  title: string;
  /** When to reach for it rather than another block. */
  use: string;
  /** A complete slide inner: pass it straight to add_chunk({ kind: 'free', html }). */
  inner: string;
  /** Where the markup came from in the monorepo, so it can be re-checked. */
  source: string;
  caveat?: string;
}

/** The `free` kind's own schema line, restated where a recipe departs from it. */
const ASSET_RULE = 'the free schema says images "come from the asset table, never inline src"';

export const RECIPES: Recipe[] = [
  {
    key: 'cover',
    title: 'Cover — eyebrow, title, lede, status pills',
    use: 'The opening fold of a deck. Also the shape to use for any full-stage statement fold.',
    inner: `<div class="slide-inner">
  <p class="eyebrow anim" style="--i:0">One HTML file</p>
  <h1 class="anim" style="--i:1">This is Origami.</h1>
  <p class="lede anim" style="--i:2">A whole deck in a single file you can email, open offline, and edit in the browser.</p>
  <p class="anim" style="--i:3"><span class="o-pill">No install</span><span class="o-pill">Works offline</span><span class="o-pill">Yours forever</span></p>
</div>`,
    source:
      'examples/dist/meet-origami.origami.html (the shipped "Meet Origami" deck, cover fold) — verbatim except the o-cover-mark <img data-oasset="brand-logo">, dropped because nothing here writes the asset table. The stagger convention is class="anim" style="--i:N", N counting from 0 down the fold.',
  },

  {
    key: 'section',
    title: 'Section header — eyebrow, h2, lede',
    use: 'The top of any content fold. Put a block (chart, venn, flow, table) under it.',
    inner: `<div class="slide-inner">
  <p class="eyebrow anim" style="--i:0">Section label</p>
  <h2 class="anim" style="--i:1">Heading</h2>
  <p class="lede anim" style="--i:2">A short line to set up this section.</p>
</div>`,
    source:
      'packages/studio-core/src/lib/palette.ts — the eyebrow / heading / lede palette atoms, in the order palette.ts\'s own fold builders (e.g. ganttFoldInner) put them.',
  },

  {
    key: 'stat-cards',
    title: 'Stat cards — a row of big numbers',
    use: 'Three or four headline metrics. The runtime counts each number up on fold enter.',
    inner: `<div class="slide-inner">
  <p class="eyebrow anim" style="--i:0">The bet</p>
  <h2 class="anim" style="--i:1">What success measures</h2>
  <div class="card-grid anim"><div class="stat-card"><div class="big" data-count-to="42">0</div><div class="lbl">What it measures</div></div><div class="stat-card"><div class="big" data-count-to="7">0</div><div class="lbl">What it measures</div></div></div>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Stat cards" palette entry, verbatim.',
    caveat:
      'The literal text inside .big is "0" and the real value goes in data-count-to — the runtime animates from one to the other. Write the number in the text node instead and it will be overwritten on first play. Put data-ocols="2|3|4" on .card-grid to pin the cards per row, and data-ofill="green|amber|red|ink" on a .stat-card to tint it.',
  },

  {
    key: 'text-columns-2',
    title: 'Two columns of prose',
    use: 'Long copy that would run too wide across a fold. Each column is independent — text does NOT flow from one into the next.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <div class="o-tcols anim" data-ocols="2">
    <div class="o-text"><p>Left column prose.</p></div>
    <div class="o-text"><p>Right column prose.</p></div>
  </div>
</div>`,
    source:
      'RECONSTRUCTED, not copied — the monorepo has no rendered .o-tcols example. Built from packages/studio-core/src/lib/blocks.ts (setTextColumns, which creates div.o-tcols[data-ocols] holding div.o-text children), the .o-tcols CSS in packages/runtime/src/css.ts, and the monorepo\'s own e2e locator `.o-tcols[data-ocols="3"] > .o-text` in packages/extension/e2e/editor.spec.ts.',
    caveat:
      'The column count is the ATTRIBUTE data-ocols (1-4), not a class — there is no .o-tcols-2. Children MUST be div.o-text elements holding the paragraphs: the CSS grid targets `.o-tcols > .o-text`, and a child that is not one is not laid out as a column. Do not confuse this with .cols > .col, which is a two-panel decorative layout (see the panel-columns recipe).',
  },

  {
    key: 'text-columns-3',
    title: 'Three columns of prose',
    use: 'The same block at three tracks. Falls back to one column under 760px.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <div class="o-tcols anim" data-ocols="3">
    <div class="o-text"><p>Column one.</p></div>
    <div class="o-text"><p>Column two.</p></div>
    <div class="o-text"><p>Column three.</p></div>
  </div>
</div>`,
    source:
      'RECONSTRUCTED, as text-columns-2 — from packages/studio-core/src/lib/blocks.ts (setTextColumns), the .o-tcols CSS in packages/runtime/src/css.ts, and the `.o-tcols[data-ocols="3"] > .o-text` locator in packages/extension/e2e/editor.spec.ts.',
  },

  {
    key: 'panel-columns',
    title: 'Two decorative panels side by side',
    use: 'Two blocks compared next to each other — a quote beside an image, before beside after. Use .o-tcols instead when it is only prose.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <div class="cols anim"><div class="col"><div class="o-text"><p>Left column.</p></div></div><div class="col"><div class="o-text"><p>Right column.</p></div></div></div>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Two columns" palette entry, verbatim.',
  },

  {
    key: 'quote',
    title: 'Pull quote with attribution',
    use: 'A line someone actually said. The footer is the attribution and is optional.',
    inner: `<div class="slide-inner">
  <blockquote class="o-quote anim"><p>Something worth quoting.</p><footer>Attribution</footer></blockquote>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Quote" palette entry, verbatim.',
    caveat: 'Wrap the quote text in a <p>. A bare text node works but the editor treats the <p> and the <footer> as the two editable leaves.',
  },

  {
    key: 'code',
    title: 'Code block',
    use: 'A snippet shown as code. white-space is preserved, so newlines in the source are real line breaks.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <pre class="o-code anim"><code>const answer = 42;</code></pre>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Code" palette entry, verbatim.',
    caveat:
      'Escape "<" as &lt; inside the <code>. A raw "<" that happens to open a <template> or an unbalanced <script> is refused by the content policy, and even where it is not it will be parsed as markup rather than shown.',
  },

  {
    key: 'callout',
    title: 'Callout — a note, tip or warning',
    use: 'One point pulled out of the flow.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <div class="o-callout anim" data-otone="accent"><p>A note worth pulling out of the flow. The tone dots switch note / tip / warning.</p></div>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Callout" palette entry, verbatim.',
    caveat: 'data-otone takes accent | green | amber | red. Omit it for the neutral note.',
  },

  {
    key: 'footnote',
    title: 'Footnote',
    use: 'An aside that would break the sentence. It is an inline span INSIDE the paragraph, not a block after it.',
    inner: `<div class="slide-inner">
  <p>This is a document fold: a continuous A4 report that lives in the same file as the slides before it.<span class="o-footnote">Slides export as images; this report exports as text. One file, two surfaces.</span></p>
</div>`,
    source: 'examples/build-examples.mjs — the flagship example\'s document fold, verbatim.',
    caveat: 'The marker number is generated by a CSS counter, so never type "[1]" yourself. Numbering runs per fold.',
  },

  {
    key: 'bullets',
    title: 'Bullet list',
    use: 'Three to five short points. Add data-otodo to the <ul> and data-checked="true|false" per <li> for a checklist.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <ul class="anim"><li>First point</li><li>Second point</li><li>Third point</li></ul>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Bullets" and "To-do list" palette entries, verbatim.',
  },

  {
    key: 'static-table',
    title: 'Static presentation table',
    use: 'A small table of fixed values. This is NOT the `table` KIND — that one carries a JSON data block and live formulas the calc engine bakes. Use this when there is nothing to calculate.',
    inner: `<div class="slide-inner">
  <h2 class="anim" style="--i:0">Heading</h2>
  <table class="o-table anim"><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>
</div>`,
    source: 'packages/studio-core/src/lib/palette.ts — the "Table" palette entry, verbatim.',
  },

  {
    key: 'image-figure',
    title: 'Image with a caption',
    use: 'A picture on a fold. Replace the data: URI with your own image bytes.',
    inner: `<div class="slide-inner">
  <figure class="o-img anim"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="A red pixel, magnified"><figcaption>Asset-table image, resolved at mount.</figcaption></figure>
</div>`,
    source:
      'packages/studio-core/src/lib/palette.ts (imageBlockHtml) for the figure/img/figcaption shape; the data: URI is the "redpx" test asset from fixtures/minimal.origami.html. The src attribute is this host\'s deviation — see the caveat.',
    caveat: `DEVIATION, on purpose: ${ASSET_RULE}, because the Studio keeps them in a deck-level asset table and points at them with img[data-oasset="id"]. No tool on this host writes that table, and a data-oasset that resolves to nothing makes validateDeck fail the Fold with "assets.ref" — save_deck would then refuse to save it. An inline data:image/* URI is inert under the content policy and passes validateDeck, so it is the only image route an agent has here. The costs are real: the Studio's image tooling will not manage it, and the bytes inflate the file (and the browser autosave slot) directly.`,
  },
];

/** Recipe list for the guide payload, keyed for lookup. */
export function recipeCatalog(): Record<string, unknown> {
  return Object.fromEntries(
    RECIPES.map((r) => [
      r.key,
      { title: r.title, use: r.use, html: r.inner, source: r.source, ...(r.caveat ? { caveat: r.caveat } : {}) },
    ])
  );
}
