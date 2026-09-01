import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
/** Spoke ceilings for this chart: the pinned `maxes` where present, else one shared ceiling. */
export declare function spokeMaxes(data: ChartData): number[];
export declare function renderRadar(svg: SVGElement, data: ChartData, w: number, lay: Layout): void;
