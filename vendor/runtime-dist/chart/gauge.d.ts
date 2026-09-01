import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
/** The value, floor and ceiling of a gauge. `normalizeChartData` guarantees max > min. */
export declare function gaugeRange(data: ChartData): {
    value: number;
    min: number;
    max: number;
};
export declare function renderGauge(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
