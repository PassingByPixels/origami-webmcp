/** The one cross-layer contract for the block-as-module design: the set of block
    kinds as a bare string union (no value imports), plus the placement vocabulary.
    Every layer's registry (format/runtime/studio-core/mcp) keys its own facets by
    this same `Kind`; nothing imports across the layers — the facets meet only at
    the key. Adding a block starts by adding its key here. */
export type Kind = 'cover' | 'bullets' | 'stats' | 'free' | 'document' | 'gantt' | 'flow' | 'graph' | 'chart' | 'video' | 'tracker' | 'notes' | 'grid' | 'table' | 'block' | 'slider' | 'draw' | 'venn';
/** Where a data block lives: 'slide' = exactly one whole-slide block on slides OF
    that kind; 'block' = an in-slide block, any number on any slide. */
export type Placement = 'slide' | 'block';
