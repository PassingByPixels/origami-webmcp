import { type ChartData } from '@origami/format';
import { CHART_PALETTE, niceMax, sliceColor } from './chart/core.js';
export { niceMax, CHART_PALETTE, sliceColor };
export declare const CHART_W = 640;
export declare const CHART_H = 360;
/** The bounds the EDITOR's height controls stop at, for this picture — the grip and the panel's
    number box read this one function, and the validator's static bracket (chart-data.ts) mirrors its
    floor. One helper, because the #furnhandle lesson is that a grip which re-derives its own clamp
    stops somewhere the writer does not.

    `current` is the plot height the chart is drawn at RIGHT NOW — the stored value, or the branch's
    own default — so a drag can start from where the picture is instead of from a constant that is
    wrong on two of the branches.

    Three ceilings, and the lowest wins:
      - the printed card's content column (PRINT_COLUMN_H), less whatever bands this layout turned on;
      - the schema's own CHART_PLOT_H_MAX, so the control can never write a file it then refuses;
      - on the POLAR family only, plotW — because r = min(plotW, plotH) / 2 (chart/pie.ts,
        chart/polar.ts), so past plotW the number rises and the disc does not, which is the
        offered-but-undrawn defect this arc exists to close, reached through geometry instead of
        through a flag.

    AT TODAY'S NUMBERS THE COLUMN WINS AND THE plotW TERM NEVER FIRES, and the margin is narrower
    than it looks. A disc picture's plotW is 582 on all four (640 − 46 − 12; they are all
    fixed-width and all axis-free, so no band ever moves mL), and the column leaves a disc at most
    505 (547 − 12 − 30, the least-banded case) — 77 units short. The widest sheet term ANY branch can
    produce is a treemap's 523, still under 582, so the term is dormant across the whole set.

    IT IS KEPT DELIBERATELY. It is the ceiling the control needs the moment PRINT_COLUMN_H moves
    again, and a clamp that is only right because a stricter one stands in front of it is a lie
    waiting for the stricter one to move. runtime/test/chart-height.test.ts pins the FORMULA
    `min(column, plotW)` rather than an inequality for exactly that reason, and asserts which of the
    two is binding, so raising the column past 582 turns the test red instead of turning the pie's
    control into a number that rises while the disc stands still. */
export declare function plotHeightBounds(data: ChartData): {
    min: number;
    max: number;
    current: number;
};
/** The runtime's OWN copy of the curated stack strings — css.ts's `[data-ofont]` rules (the
    canonical, test-pinned copy fonts.test.ts checks lib/fonts.ts against) live in the SAME package
    but are not exported, and lib/fonts.ts itself lives in studio-core, which the runtime must never
    depend on (it ships to the viewer; studio-core does not). A third copy is a real liability — see
    lib/fonts.ts's own header on why the LAST one was supposed to be gone — so chart-render.test.ts
    pins this table against css.ts's BASE_CSS text the same way fonts.test.ts already does, and any
    future edit to either has to keep both tests green. */
export declare const CHART_FONT_STACK: Record<string, string>;
/** Lenient normalize — junk degrades, never throws. */
export declare function normalizeChartData(raw: unknown): ChartData;
/** Render one chart into its figure's [data-chart-mount]. Idempotent.
    `forPrint` marks the hidden `.o-print` clone, which needs its own gradient-id namespace — a
    `url(#…)` is resolved document-wide, and the stage's copy is display:none when the page prints.
    See defs.ts. It changes NOTHING else about the picture. */
export declare function renderChart(figure: Element, data: ChartData, forPrint?: boolean): void;
/** Parse one figure's data block. null = missing/unparseable. */
export declare function parseChartFigureData(figure: Element): ChartData | null;
/** Sweep a mounted slide for chart figures and render each. Charts are
    in-slide blocks, so this runs for every slide regardless of its kind.
    `forPrint` is the sweep context's flag — it reaches renderChart's gradient namespace and
    nothing else. It cannot be replaced by a DOM probe: this runs while the print clone is still
    detached (viewer.ts, cloneSlide). */
export declare function mountCharts(slide: Element, forPrint?: boolean): void;
