export const documentBlock = {
    key: 'document',
    name: 'Document (report)',
    schemaComment: [
        '.slide-inner.o-doc wraps everything — a continuous A4 reading column, NOT a 100vh slide scene; it flows top-to-bottom and prints to portrait A4 pages',
        'masthead: <header class="o-doc-masthead"> with h1 (document title) then <p class="o-doc-byline"> (author · date · version)',
        'a <nav class="o-toc" data-toc-mount></nav> is the auto table-of-contents — LEAVE IT EMPTY in source; the runtime builds it from the headings',
        'body blocks in reading order: h2 / h3 (auto-numbered by CSS — write plain heading text, never type the numbers) · p · ul>li / ol>li · blockquote.o-quote',
        '  · table.o-table · figure.o-img>img[data-oasset]+figcaption (images from the asset table, never inline src) · figure.o-chartfig / figure.o-videofig (live charts/video work inline)',
        'NEVER separate lines with literal newlines inside a <p> — HTML collapses them to a single space and the breaks vanish (a "1.\\n2.\\n3." list becomes a run-on). Use a real block per point: separate <p> (or ol>li / ul>li for a list), and <br> only for a soft line break',
        'document blocks: <div class="o-callout" data-otone="accent|green|amber|red"><p>…</p></div> (note/tip/warning) · <pre class="o-code"><code>…</code></pre> (escape "<" as &lt;)',
        '  · <span class="o-footnote">…</span> (auto-numbered) · <hr class="o-pagebreak"> (forces a page break in print/PDF)',
        'a document is freeform INERT HTML with NO data-odata block — no <script>/<style>/<iframe>/on*=/remote URLs, so the deck stays inactive (recipients never see a padlock)',
    ],
};
