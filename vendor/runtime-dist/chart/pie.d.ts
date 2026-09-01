import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
/** What a slice prints: the text, and how far it has to move off the label point to stay in the
    colour. `dx` is 0 for every name that already fits centred — which is every name that was not
    escaping — so a slice only moves its label when the alternative is cutting it shorter. */
export interface SliceName {
    text: string;
    dx: number;
}
/** The name to print inside a slice, and where — the room rule in one place, so what is drawn and
    what is measured can never be two different readings. `a0`/`a1` are the slice's own angles,
    `rIn`/`rOut` its band; the label sits at LABEL_R through that band, which is where renderPie
    draws it. `text` is '' for a slice with no room for a name a reader could match to a legend. */
export declare function sliceLabel(name: string, a0: number, a1: number, rIn: number, rOut: number): SliceName;
export declare function renderPie(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
