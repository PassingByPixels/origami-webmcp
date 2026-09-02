import type { Violation } from './types.js';
/**
 * Chart BLOCK data — unlike gantt/tracker (whole-slide kinds), charts are
 * in-slide blocks: any number, on any slide. Each figure carries its own
 * inert JSON block:
 *
 *   <figure class="o-chartfig">
 *     <script type="application/json" data-odata="chart">{…}</script>
 *     <div class="o-chart" data-chart-mount></div>
 *     <figcaption>…</figcaption>
 *   </figure>
 *
 * Same carrier rules as every data block: "<" always escaped, the literal
 * script form enforced by validateSlideContent.
 */
export declare const CHART_TYPES: readonly ["bar", "line", "pie", "timeseries", "scatter", "waterfall", "boxplot", "radar", "gauge", "heatmap", "treemap", "sankey"];
/** Max rows in a heatmap — its series are the grid's ROWS, so the cap matches the 24-column label
    cap rather than the 1-6 series cap every other type keeps. */
export declare const HEATMAP_MAX_ROWS = 24;
/** Most nodes a TREEMAP takes, INTERIOR NODES INCLUDED — a type-specific label cap, on the heatmap's
    precedent that a cap belongs to the picture rather than to the whole format.

    It is 60 and not 24 because a tree spends labels the flat types do not: a two-level tree over 24
    leaves already needs 24 + its branches, so the 24 that is generous for a bar is short for the
    same data drawn as a tree. It is not larger than 60 because 60 is what a horizontal bar chart
    already takes — the widest cap in the format — and a treemap of more than 60 cells prints cells
    too small to name, at which point the picture has stopped stating anything a reader can use. */
export declare const TREEMAP_MAX_NODES = 60;
/** Most nodes a SANKEY takes, and most flows between them. Both are type-specific caps, on the same
    precedent the heatmap and the treemap set: a cap belongs to the picture it protects.

    60 NODES matches the treemap's, and for a related reason — a sankey spends labels on interior
    stages the flat types never have — but the binding limit here is the COLUMN, not the total: 60
    nodes stacked in one column of a 336-unit plot leave each bar under 6 units tall, which is below
    the 10px glyph the name would need, so the picture stops naming anything past roughly that point.

    120 LINKS is TWICE the node cap, and that ratio is the number worth stating. A flow diagram a
    reader can follow has a few edges per node; at 2 per node the ribbons already cross enough that
    the layout pass below spends its whole budget on them, and past it the picture is a mat rather
    than a diagram. It is also what bounds the crossing-minimisation cost: 32 fixed sweeps over 120
    edges is arithmetic a viewer does not notice, where an uncapped graph is not. */
export declare const SANKEY_MAX_NODES = 60;
export declare const SANKEY_MAX_LINKS = 120;
/** Most hex COLUMNS a hexbin can print its counts at — above this the editor withholds `showValues`
    rather than offering a flag the renderer will drop.

    DERIVED FROM THE GEOMETRY, not chosen. chart/hexbin.ts prints a count only where the cell is at
    least as tall as the 10px glyph, R >= 10, and R is plotW / (sqrt(3) * hexBins). A hexbin's
    viewBox is a fixed 720 and its right margin is a fixed 84 (12 + the colour-scale gutter), but its
    LEFT margin is 46 or 64 depending on whether the chart carries a y-axis title — so plotW is 590
    or 572 and the cliff falls at 34 columns or at 33. This is the CONSERVATIVE one: 572 / (10 *
    sqrt(3)) = 33.02. At 33 the counts are drawn in either layout; above it they are drawn in
    neither, or in only the wider one, and a control the author can tick to no effect is the defect
    this constant exists to close. The renderer keeps the geometric test — this is the editor's
    single-number reading of it, and runtime/test/chart-041-defects.test.ts pins the two together. */
export declare const HEXBIN_VALUES_MAX_BINS = 33;
/** The bracket a stored `plotHeight` must fall inside — the SCHEMA's bounds, which are deliberately
    WIDER than the ones the editor's grip and number box stop at.

    The floor is where the picture stops being a chart. Below ~180 viewBox units the y-axis ticks of
    a default layout overprint each other (chart/axis.ts spaces them across the plot box) and a bar
    is shorter than the number printed on it, so a smaller value is not a smaller chart, it is an
    unreadable one.

    The ceiling is the HAND-AUTHORED one, and the gap between it and the editor's is the point. The
    editor clamps to what fits a printed card sheet (see plotHeightBounds in runtime/chart.ts, which
    shows that arithmetic); a file written by hand, by a script or by a future editor may legitimately
    want a tall chart on a scroll deck, where no sheet exists to cut it. So the validator refuses only
    the values that are not a chart at all, and the editor refuses the ones that would not print. */
export declare const CHART_PLOT_H_MIN = 180;
export declare const CHART_PLOT_H_MAX = 1200;
/** The bracket a stored `textScale` must fall inside — the multiplier on the FREE surfaces only
    (title, subtitle, axis titles, ticks, corner labels, the centre readout, a band label, the HTML
    legend). 0.75 is the floor a tick can shrink to before it reads as a footnote rather than a
    number; 1.5 is the ceiling a title can grow to before a two-line default wraps to three inside
    the title band's fixed height. Bracketed rather than clamped, on `plotHeight`'s own rule: a
    number outside it is not a smaller mistake than a string. */
export declare const TEXT_SCALE_MIN = 0.75;
export declare const TEXT_SCALE_MAX = 1.5;
/** Waterfall step kind. `total` is grounded at zero (an opening/closing balance); `increase` and
    `decrease` float from the running total. */
export declare const WATERFALL_KINDS: readonly ["total", "increase", "decrease"];
export type WaterfallKind = (typeof WATERFALL_KINDS)[number];
export interface ChartSeries {
    name: string;
    color: string;
    values: number[];
    /** Timeseries/scatter-only: x-coordinates parallel to `values` (same length). Gives continuous X
        and lets a series stop before the others (partial length). Absent for bar/line/pie. */
    xs?: number[];
    /** Line/timeseries: dashed stroke when true; solid when absent/false. */
    dash?: boolean;
    /** Line: markers absent/true = shown, false = hidden. Timeseries: absent/false = hidden, true = shown. */
    markers?: boolean;
    /** Line-only: fill the band under the stroke with a downward-fading gradient of `color`
        (07 Area). Partial opacity, so stacked areas stay readable through each other. */
    fill?: boolean;
    /** Scatter-only: per-point magnitude parallel to `values` — its presence makes the series a
        BUBBLE series (13). Radius is area-proportional, so the disc does not exaggerate. */
    sizes?: number[];
    /** Scatter-only: per-point captions parallel to `values`, drawn above the point. */
    pointLabels?: string[];
    /** Boxplot-only: the five-number summary per category, parallel to `labels` —
        [whiskerLow, Q1, median, Q3, whiskerHigh], ascending. PRE-COMPUTED is the primary contract:
        Folio draws statistics, it does not own them. */
    boxes?: number[][];
    /** Boxplot-only: raw observations per category, parallel to `labels`. Used only when `boxes` is
        absent — see chart/box.ts for the percentile method and the whisker rule. */
    samples?: number[][];
    /** Boxplot-only: points drawn beyond the whiskers, per category, parallel to `labels`. */
    outliers?: number[][];
}
/** Sankey-only: ONE FLOW, from one node to another. `from` and `to` are indices into `labels` — the
    same index-keyed discipline `parents` uses, and for the same reason: a name would be a second way
    to say which node is meant, and two duplicate labels would then be one node instead of two.
    `value` is the magnitude, strictly positive — a zero ribbon is not a thin ribbon, it is nothing,
    and a ribbon of nothing between two nodes states a connection that does not exist. */
export interface ChartFlow {
    from: number;
    to: number;
    value: number;
}
/** Scatter-only: the split point of a QUADRANT chart (21) plus its four corner captions. */
export interface ChartQuadrant {
    /** X value of the vertical split line. */
    x: number;
    /** Y value of the horizontal split line. */
    y: number;
    /** Up to four captions: [top-left, top-right, bottom-left, bottom-right]. */
    corners?: string[];
}
export interface ChartData {
    type: (typeof CHART_TYPES)[number];
    labels: string[];
    series: ChartSeries[];
    /** Optional fixed y-axis maximum (bar/line). null = scale to the data. */
    yMax: number | null;
    /** Bar orientation — 'horizontal' ranks categories down the y-axis (absent = vertical). */
    orientation?: 'horizontal' | 'vertical';
    /** Bar grouping — 'overlaid' nests bars per category, 'stacked' stacks the series into one bar
        per category (absent = grouped side-by-side). */
    barMode?: 'grouped' | 'overlaid' | 'stacked';
    /** Index of a category to highlight with a background band. */
    highlightIndex?: number;
    /** Draw a numeric value label on every bar / point (bar + line; pie is legend-labelled). */
    showValues?: boolean;
    /** Title + subtitle drawn above the plot (all chart types). */
    title?: string;
    subtitle?: string;
    /** Axis titles — bar/line only (a pie has no axes). */
    xTitle?: string;
    yTitle?: string;
    /** Per-slice colours for a PIE (aligned to labels — a pie is category-keyed, not
        series-keyed). Absent = the fixed palette rotates per slice (byte-stable default). */
    sliceColors?: string[];
    /** Live link to a ledger (`table`) block in the same file. When set, the chart's labels/series
        are BAKED from the ledger's cells over `range` at author time (host-side). Absent = a
        standalone chart (byte-clean). The inert viewer ignores this — it renders the baked series. */
    link?: ChartLink;
    /** Line-only: render as a SPARKLINE (08) — no axes, gridlines, ticks, legend or title band,
        autoscaled to its own min/max so the shape fills a small box. A FLAG rather than a type
        because the data shape is exactly a line's; see the note on renderSpark. */
    spark?: boolean;
    /** Scatter-only: split lines + corner captions (21). Absent = a plain scatter/bubble. */
    quadrant?: ChartQuadrant;
    /** Bar-only: draw the bars GAPLESS with square corners (04 Histogram), so pre-binned counts read
        as one continuous distribution instead of separate categories. Cosmetic only — the data,
        the axis and the ordering are a bar's. */
    histogram?: boolean;
    /** Bar-only, vertical, exactly one series: add the cumulative-percentage line on a second
        (right-hand) value axis (05 Pareto). The line is DERIVED from `values` — running sum / total —
        so it is never authored and never stored. */
    pareto?: boolean;
    /** Line-only: stack the series with a CENTRED baseline and draw them as smooth filled bands
        (26 Stream Graph). Mutually exclusive with `spark`. */
    stream?: boolean;
    /** Waterfall-only: the step kind per category, parallel to `labels`. Absent = derived from the
        sign of each value (>= 0 increase, < 0 decrease), so a plain bridge needs no kinds at all. */
    kinds?: WaterfallKind[];
    /** Pie-only: draw the ring with an inner radius and a TOTAL in the middle (10 Donut). The centre
        readout is the reason a donut exists — the renderer never omits it. */
    donut?: boolean;
    /** Pie-only: equal-angle wedges whose RADIUS encodes the value (23 Nightingale). Area-honest —
        radius scales with the square root, so a 4x value gives a 2x radius. Composes with `donut`. */
    rose?: boolean;
    /** Bar-only, exactly one series: draw the stages as tapering trapezoids (11 Funnel). Every stage
        is named and valued on the chart, so `showValues` has no meaning and is rejected. */
    funnel?: boolean;
    /** Bar-only, exactly one series: draw the categories as angular sectors on polar axes, value
        encoded as radius (22 Radial bar). Mutually exclusive with `funnel`. */
    polar?: boolean;
    /** Radar-only: the ceiling of each SPOKE, parallel to `labels`, every entry > 0. Absent = every
        spoke shares `yMax ?? niceMax(peak)`, which is the usual case (scores all out of the same
        number) and keeps a plain radar byte-clean. */
    maxes?: number[];
    /** Gauge-only: the floor of the dial. Absent = 0. May be negative — a dial is a coordinate. */
    gaugeMin?: number;
    /** Gauge-only: the ceiling of the dial, strictly greater than `gaugeMin`. Absent = 100. */
    gaugeMax?: number;
    /** Gauge-only: a suffix printed after the centre readout ("%", " GB"). Absent = bare number. */
    unit?: string;
    /** Scatter-only: bin the point cloud into a pointy-top hexagonal lattice and colour each cell by
        its COUNT (24 Hexagonal binning). The individual point marks are replaced, so `sizes`,
        `pointLabels` and `quadrant` are all rejected alongside it. */
    hexbin?: boolean;
    /** Hexbin-only: how many hex COLUMNS span the plot (4-60, integer). Absent = 20. Expressed as a
        count rather than a radius because the plot's own units are not what an author is tuning. */
    hexBins?: number;
    /** Treemap-only: the TREE, as a flat parent-pointer array parallel to `labels`. Entry `i` is the
        index of node `i`'s parent, or -1 when the node is a root. The array must form a FOREST — no
        self-reference, no cycle — and absent means every node is a root, which is a legal single-level
        treemap and keeps a flat one byte-clean.
  
        FLAT PARENT POINTERS AND NOT NESTED JSON, deliberately. Every other field in this interface is
        an array parallel to `labels`; a nested `children` tree would have been a second, contradicting
        way to say what a chart's categories are, and it would have put `values`, `sliceColors` and
        `highlightIndex` — all index-keyed — out of reach of the nodes they describe. */
    parents?: number[];
    /** Treemap-only: draw the tree as a POLAR partition, one ring per depth, angle proportional to the
        subtree total (20 Sunburst). Picture-only — same labels, same parents, same values. Mutually
        exclusive with `convex`. */
    sunburst?: boolean;
    /** Treemap-only: round the cell corners and inset each cell by a gap (25 Convex treemap).
        Picture-only, and rectangles-only, which is why it cannot be combined with `sunburst`. */
    convex?: boolean;
    /** Sankey-only: the FLOWS, as a list of {from, to, value} edges over the `labels` (27 Sankey).
        Required on the type and required to be a DAG — a sankey is drawn in columns, and a column is a
        position in a topological order, which a cycle does not have. Every node must appear in at
        least one flow: a node with no edge has no column, no height and nothing to draw.
  
        THE ONLY ARRAY IN THIS INTERFACE THAT IS NOT PARALLEL TO `labels`, deliberately. Its entries
        are relationships rather than properties of a node, so it has its own length and its own cap
        (SANKEY_MAX_LINKS); a per-label shape could carry at most one edge per node and a sankey's
        whole subject is the nodes that fan out and back in. */
    links?: ChartFlow[];
    /** Draw the SWATCH ROW under the picture? Absent or true = drawn exactly as it always has been, so
        every deck written before this key is byte-identical and pixel-identical. `false` suppresses it.
  
        Accepted only on the types that DRAW one — see the wave-6 note above CHART_TYPES for why a
        gauge, a heatmap, a hexbin and a sankey reject it rather than storing an inert switch. It is
        accepted on a SPARKLINE, which draws no legend either, and that is the one deliberate
        inconsistency: `spark` is a display MODE of a line, so the key belongs to the line underneath
        it and is there again the moment the mode is switched off — the same rule `yMax` and `yTitle`
        already follow on that picture. The panel withholds the control there (chart-fields.ts). */
    legend?: boolean;
    /** Pie-only: print each slice's NAME inside its own slice (absent = names live only in the legend).
        A slice takes its name only where the room rule allows — chart/pie.ts measures the label against
        the chord at the label radius and OMITS it rather than clip it, because a truncated name on a
        printed deck cannot be recognised as truncated. Composes with `donut` (the centre readout is
        left alone) and with `rose`. */
    pieLabels?: boolean;
    /** How tall the PLOT BOX is, in viewBox units (absent = the historical 318, or 336 on a treemap /
        sankey — see layout() in runtime/chart.ts). It sizes the picture, never the type: a viewBox is
        a coordinate system, so growing it at a fixed width gives the marks more room at exactly the
        same glyph size, which is what "make the chart taller" means and what stretching the SVG does
        not do.
  
        Absent on every chart written before this key, and absent is what a chart that never touches
        the grip keeps carrying — so every existing deck serializes byte-identically.
  
        NOT accepted as a total height: the optional title band and axis-title strip GROW the viewBox
        around the plot box rather than eating into it, exactly as they always have, so a chart keeps
        the plot the author sized when a title is added to it.
  
        Honoured on the fixed-height branches only. A HORIZONTAL BAR and a HEATMAP size themselves as
        rowCount x pitch, so a total written over that would silently re-pitch the rows — a different
        control (the pitch) for a later decision, and the editor withholds this one on both. A
        SPARKLINE short-circuits the whole layout, so it has no plot box at all. The key is only
        WITHHELD on those three, never rejected: a height set on a bar chart survives a trip through
        the horizontal switch and is honoured again on the way back.
  
        On the POLAR family (pie, donut, rose, radar, gauge, radial bar) the picture is a circle
        inscribed in the plot box — r = min(plotW, plotH) / 2 — so past plotW the number goes on
        validating and the disc stops growing. The editor clamps there for that reason; the schema does
        not, because plotW is a function of the type and of the data. */
    plotHeight?: number;
    /** 0.4.1h CHART TEXT — colour, family and size for the FREE surfaces only: title, subtitle, axis
        titles, ticks, corner labels, the centre readout, a band label and the HTML swatch legend.
        Absent on every chart written before this key, and absent is what a chart that never opens the
        new LOOK cluster keeps carrying — so every existing deck serializes byte-identically.
  
        NOT accepted on the surfaces a WCAG contrast ratio or a series colour already owns.
        `.o-chart-cellvalue` (a heatmap/hexbin/treemap cell's own number) picks its ink per cell against
        that cell's ramp colour and `.o-chart-axis2`/`.o-chart-tick2` (a pareto's second axis, a stream's
        band names) take the colour of the series they belong to — both declare NO fill/stroke of their
        own on purpose (chart-css.ts says why), and a chart-wide colour must not out-rank either. The
        runtime enforces this by which CSS classes read the variables at all; this field carries one
        colour for the picture, not a per-class list, so there is nothing here for a validator to gate. */
    textColor?: string;
    /** 0.4.1h — the family for the free surfaces above, one of the four curated OFL faces (the same
        list `data-ofont` already offers on a block). Reused rather than a new asset slot: picking a
        family embeds its woff2 into the deck the same way the masthead's and the block's own font
        pickers do, so a recipient with no OFL fonts installed still sees it.
  
        IT DOES NOT RECALIBRATE `estTextWidth` (runtime/chart/core.ts). That table is already an
        estimate calibrated on Segoe UI and already approximate the moment a deck's own theme swaps
        `--font-body`; a curated serif widens the gap further, which is why the field is withheld on
        every FIT-BOUND surface (a funnel's stage name, a pie's slice label, a treemap's cell caption,
        and the rest of the nine modules that measure text to fit it) rather than accepted everywhere
        and silently mis-measured. */
    textFont?: 'playfair' | 'lora' | 'inter' | 'source-serif';
    /** 0.4.1h — a size MULTIPLIER on the free surfaces' own px values (title 16px, ticks 11px, and so
        on), bracketed to [TEXT_SCALE_MIN, TEXT_SCALE_MAX]. It is deliberately NOT a number threaded
        into `layout()` or the nine fitter modules — see plotHeight's own note on why a size that moves
        geometry is a slice of its own. 1 (or absent) draws every existing deck pixel-identical. */
    textScale?: number;
}
/** A chart→ledger link descriptor. The chart pulls its data from the ledger's baked cells over an
    A1 range; the pulled values are frozen into labels/series so the file stays self-contained. */
export interface ChartLink {
    /** Stable id of the target ledger — matches TableData.id. */
    ledgerId: string;
    /** Stable id of the linked SHEET within that ledger — matches a sheet's TableData.sid (the top
        level or a tabs[i].data; the sid travels with the sheet on a swap, so the link survives tab
        switches, renames and moves). Absent = a legacy pre-sid link = the top-level (active) sheet. */
    tab?: string;
    /** A1 range over the ledger's FULL grid, e.g. "A1:C12". */
    range: string;
    /** First row = series names, first column = category labels (same reading as the xlsx import). */
    header: boolean;
    /** Read orientation — 'row' (default, omitted) reads as-is; 'col' transposes before mapping. */
    orient?: 'row' | 'col';
}
/** Strict shape check for one chart data block. REJECT, never repair.

    The body is a DISPATCHER. Every rule lives in a named check above, and the checks run in the
    order their violations are expected in — the rule code, the message and the ORDER are all part
    of the format's contract, so a check is named and moved out, never reordered. */
export declare function validateChartData(data: unknown): Violation[];
/** Serialize chart data for embedding — "<" escaped (the carrier invariant).
    Keys are emitted in a FIXED canonical order (present-only), so a field the editor
    happened to append last still serializes deterministically. Charts that use none of
    the optional fields are byte-identical to the pre-1A/1D shape. */
export declare function chartDataJson(data: ChartData): string;
