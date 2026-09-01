import { expandRange } from './refs.js';
/** Collect the A1 cells a formula depends on (single refs + expanded ranges). Cross-block
    @block.output refs are intentionally excluded — they resolve via the injected `named`
    map, and cross-block cycles are detected at the Fold level (Slice 4). */
export function refsOf(node, out) {
    switch (node.t) {
        case 'ref':
            out.add(node.a1);
            break;
        case 'range': {
            const cells = expandRange(node.a, node.b);
            if (cells)
                for (const c of cells)
                    out.add(c);
            break;
        }
        case 'unary':
            refsOf(node.x, out);
            break;
        case 'binary':
            refsOf(node.l, out);
            refsOf(node.r, out);
            break;
        case 'call':
            for (const a of node.args)
                refsOf(a, out);
            break;
        default:
            break; // num / str / bool / named — no in-block cell dependency
    }
}
