import { type ChartData } from '@origami/format';
import { type Layout } from './core.js';
interface Flow {
    from: number;
    to: number;
    value: number;
}
/** The flows, cleaned and put in ONE canonical order — ascending by `from`, then `to`, then value.

    THE ORDER IS PINNED HERE AND NOWHERE ELSE, and it is what makes the picture independent of the
    order the links happen to be written in. Two files holding the same six flows in different
    sequences are the same diagram and must draw the same bytes; sorting once, on the data itself,
    is the only way to make that true without asking the author to sort their own file.

    IT ALSO REPAIRS, for the reason chart/treemap.ts re-checks its cycles: `renderChart` is a public
    export and the Studio calls it with its own working copy rather than a freshly normalized one, so
    a junk or cyclic `links` array reaching here is one call away. The cut rule is stated in one line
    so it can be reproduced: walk the canonical order, keep a flow unless its target already reaches
    its source, which means the LATER flow of a ring is the one dropped — later in the canonical
    order, never in the file's order, so the same file always loses the same edge. */
export declare function readFlows(data: ChartData): Flow[];
export declare function renderSankey(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
export {};
