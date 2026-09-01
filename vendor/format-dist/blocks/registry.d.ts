import type { Kind } from './kind.js';
import type { FormatBlock } from './types.js';
/** Every format-layer block facet, in canonical (KINDS declaration) order. This
    array IS the source of truth the `KINDS` map projects from; `KIND_DATA_SPECS`
    projects the `data`-carrying subset (in its own historical order). Adding a
    block = add its `blocks/<key>.ts` facet + one import + one entry here — no edit
    to kinds.ts or validate.ts. */
export declare const FORMAT_BLOCKS: FormatBlock[];
/** Registry indexed by kind for O(1) facet lookup. @__PURE__ so an unused import
    (e.g. from the runtime viewer, which never reads the registry) tree-shakes away. */
export declare const FORMAT_BLOCKS_BY_KEY: Record<Kind, FormatBlock>;
