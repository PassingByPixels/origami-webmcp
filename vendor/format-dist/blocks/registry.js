import { coverBlock } from './cover.js';
import { bulletsBlock } from './bullets.js';
import { statsBlock } from './stats.js';
import { freeBlock } from './free.js';
import { ganttBlock } from './gantt.js';
import { chartBlock } from './chart.js';
import { videoBlock } from './video.js';
import { flowBlock } from './flow.js';
import { graphBlock } from './graph.js';
import { trackerBlock } from './tracker.js';
import { notesBlock } from './notes.js';
import { gridBlock } from './grid.js';
import { documentBlock } from './document.js';
import { tableBlock } from './table.js';
import { compositeBlock } from './block.js';
import { sliderBlock } from './slider.js';
import { drawBlock } from './draw.js';
import { vennBlock } from './venn.js';
/** Every format-layer block facet, in canonical (KINDS declaration) order. This
    array IS the source of truth the `KINDS` map projects from; `KIND_DATA_SPECS`
    projects the `data`-carrying subset (in its own historical order). Adding a
    block = add its `blocks/<key>.ts` facet + one import + one entry here — no edit
    to kinds.ts or validate.ts. */
export const FORMAT_BLOCKS = [
    coverBlock,
    bulletsBlock,
    statsBlock,
    freeBlock,
    ganttBlock,
    chartBlock,
    videoBlock,
    flowBlock,
    graphBlock,
    trackerBlock,
    notesBlock,
    gridBlock,
    documentBlock,
    tableBlock,
    compositeBlock,
    sliderBlock,
    drawBlock,
    vennBlock,
];
/** Registry indexed by kind for O(1) facet lookup. @__PURE__ so an unused import
    (e.g. from the runtime viewer, which never reads the registry) tree-shakes away. */
export const FORMAT_BLOCKS_BY_KEY = /* @__PURE__ */ Object.fromEntries(FORMAT_BLOCKS.map((b) => [b.key, b]));
