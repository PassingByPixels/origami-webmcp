import { coverCss } from './cover-css.js';
import { bulletsCss } from './bullets-css.js';
import { statsCss } from './stats-css.js';
import { ganttCss } from './gantt-css.js';
import { flowCss } from './flow-css.js';
import { graphCss } from './graph-css.js';
import { trackerCss } from './tracker-css.js';
import { notesCss } from './notes-css.js';
import { gridCss } from './grid-css.js';
import { tableCss } from './table-css.js';
import { chartCss } from './chart-css.js';
import { videoCss } from './video-css.js';
import { documentCss } from './document-css.js';
import { sliderCss } from './slider-css.js';
import { drawCss } from './draw-css.js';
import { vennCss } from './venn-css.js';
export { coverCss, bulletsCss, statsCss, ganttCss, flowCss, graphCss, trackerCss, notesCss, gridCss, tableCss, chartCss, videoCss, documentCss, sliderCss, drawCss, vennCss };
export declare const CSS_ORDER: readonly ["cover", "bullets", "stats", "gantt", "flow", "graph", "tracker", "notes", "grid", "table", "chart", "video", "document", "slider", "draw", "venn"];
/** kind key → that kind's CSS chunk. Exported so the byte-golden test snapshots the REAL
    map instead of a copy of it, which could silently drift out of step. */
export declare const KIND_CSS_BY_KEY: Record<string, string>;
/** The full shipped kinds stylesheet, byte-identical to the pre-split KINDS_CSS
    (verified by runtime/test/css-golden.test.ts). Not imported by the viewer —
    assemble.ts and index.ts pull it directly, so it never enters the boot IIFE. */
export declare const KINDS_CSS: string;
