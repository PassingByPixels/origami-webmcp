import type { ChartData, WaterfallKind } from '@origami/format';
import { type Layout } from './core.js';
/** The three step colours for this chart. `increase` is the author's own series colour; the other
    two are derived from it, so recolouring the series recolours the whole bridge coherently. */
export declare function waterfallColors(data: ChartData): Record<WaterfallKind, string>;
/** Legend entries for a waterfall — the KINDS present, not the single series, because three
    colours with no key is the one thing a printed bridge cannot explain to its reader. */
export declare function waterfallLegend(data: ChartData): Array<{
    label: string;
    color: string;
}>;
export declare function renderWaterfall(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
