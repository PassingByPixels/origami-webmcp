export const freeBlock = {
    key: 'free',
    name: 'Freeform',
    schemaComment: [
        '.slide-inner wraps everything; any block vocabulary is allowed',
        'blocks: .eyebrow · h1/h2 · .lede · p · ul>li · .cols>.col (two columns) · .card-grid>.stat-card',
        'table.o-table · blockquote.o-quote (+footer attribution) · a.o-btn · span.o-pill · hr.rule',
        'figure.o-img > img[data-oasset="id"] + figcaption — images come from the asset table, never inline src',
    ],
};
