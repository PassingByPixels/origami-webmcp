import type { ChartData } from '@origami/format';
import { type Layout } from './core.js';
/** Extra right margin a pareto's second axis needs for its spine, ticks and "100%" labels. */
export declare const PARETO_AXIS_W = 34;
/** The cumulative line's colour — derived from the bar colour so it can never match it. */
export declare const paretoColor: (data: ChartData) => string;
/** Legend entry for the derived line. It has no series of its own, so nothing else would name it. */
export declare const PARETO_LEGEND = "Cumulative %";
/** Draw the cumulative-percentage line and its right-hand axis over an already-drawn bar plot. */
export declare function renderPareto(svg: SVGElement, data: ChartData, lay: Layout, plotW: number): void;
