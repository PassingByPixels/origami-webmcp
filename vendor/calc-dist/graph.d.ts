import type { Node } from './ast.js';
/** Collect the A1 cells a formula depends on (single refs + expanded ranges). Cross-block
    @block.output refs are intentionally excluded — they resolve via the injected `named`
    map, and cross-block cycles are detected at the Fold level (Slice 4). */
export declare function refsOf(node: Node, out: Set<string>): void;
