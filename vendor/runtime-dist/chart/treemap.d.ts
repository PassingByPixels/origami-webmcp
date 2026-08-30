import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
export declare function renderTreemap(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
/** The legend keys the TOP-LEVEL BRANCHES, which is what the colours mean. A branch carries no cell
    text of its own — its rectangle is spent entirely on its children — so a legend is how the name
    of the group a colour stands for reaches the reader. On a FLAT tree the branches are the nodes,
    so the legend reads exactly like a pie's, which is the same picture in rectangles.

    …UP TO EIGHT ROOTS, AND NOT ONE MORE. CHART_PALETTE holds eight colours and a branch takes its
    own by position, so the ninth root repeats the first — and a swatch row would then "claim a
    colour stands for one name when it stands for two", which is chart/sankey.ts's stated reason for
    having no legend at all, reached here from the other side. Above eight the row is dropped whole
    rather than trimmed: a legend that keys some of the branches is a legend a reader would read as
    keying all of them. The names are not lost with it — renderRects prints each branch's own name
    in its outline, which is the half of this that makes dropping the row honest.

    ON A SUNBURST THE SAME HALF IS `ringLabel`, and it does not cover quite all of it. MEASURED, on
    nine shapes of 8/9/12 roots crossed with 0/2/4 children each — 87 root wedges in all: 86 carry
    their own name on the picture and ONE does not. It is R12K2's narrowest root, a wedge 0.24 rad
    across: at the radius its ink would dip to, the wedge leaves 3.8 units of run, and the SHORTEST
    caption that names anything — one letter and the ellipsis — measures 18.3. Its whole name
    measures 48.8. No fallback is offered for it on purpose: the centre hole is 39.4 units across,
    so a name printed there does not fit either (the same name draws 39.6 at the real font), and
    a legend row keyed to one of twelve repeating colours is the ambiguity this cap exists to
    refuse. One root in eighty-seven reaching the reader by its position in the ring rather than by
    a printed name is the residual, stated rather than papered over. */
export declare function treemapLegend(data: ChartData): Array<{
    label: string;
    color: string;
}>;
