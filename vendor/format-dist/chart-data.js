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
/* WHEN A CAPABILITY EARNS A TYPE, AND WHEN IT IS ONLY A FLAG. One rule, applied to all five of the
   0.4.1 wave-2 charts, so the answer is not re-argued per chart:

     a new CHART_TYPE when the DATA SHAPE differs — a reader/writer has to learn a new field layout
     a FLAG when only the PICTURE differs — same labels, same series, same values

   Histogram (04), Pareto (05) and Stream (26) carry EXACTLY a bar's / a bar's / a line's data, so
   each is a flag. Waterfall (15) needs signed values plus a per-bar kind, and Box plot (14) needs
   five numbers (or a sample list) per category — neither fits `values`, so both are types.

   The rule pays for itself twice. (1) COST: a type forks validateChartData, normalizeChartData, the
   Studio's category grid, the xlsx importer and the ledger mapper; a flag forks none of them.
   (2) DEGRADATION: an old viewer drops an unknown FLAG and draws the correct-but-plainer chart
   underneath (a histogram becomes a gappy bar, a pareto loses its cumulative line, a stream becomes
   the lines whose gaps it was drawing), whereas an unknown TYPE falls back to 'bar' and draws
   something the author never asked for. A flag degrades to a subset of the truth; a type cannot.

   The counter-argument — "an author hunting for Histogram will not find it behind a checkbox" — is
   real, and it is a DISCOVERABILITY problem, so it is fixed where discoverability lives: the Studio
   type dropdown lists Histogram, Pareto and Stream as first-class entries that set the flag
   (canvas-chart.ts, TYPE_LABELS + applyPreset). The author never sees the difference; the file
   format, the validator and every older install do.

   ── 0.4.1 WAVE 3 (the polar/shape family) applies the SAME rule, and one more consideration that
   only shows up once a wave has shipped ─────────────────────────────────────────────────────────
   Donut (10), Nightingale (23), Funnel (11) and Radial bar (22) carry EXACTLY a pie's / a pie's /
   a bar's / a bar's data, so all four are FLAGS. Radar (16) carries `maxes` — one ceiling per spoke
   — and Gauge (18) carries `{value, min, max}` plus a unit, neither of which fits `values`, so both
   are TYPES.

   The extra consideration is what an OLDER install does, and it is sharper than the wave-2 note
   above says. An unknown FLAG is simply not read: `validateChartData` does not reject unknown keys,
   so a v0.4.0 install VALIDATES a radial-bar deck and draws a plain bar chart of the same numbers.
   An unknown TYPE is rejected by name here, so the same deck reports a violation before it is ever
   drawn. A flag round-trips through an install that has never heard of it; a type cannot. That is
   why the two charts with nothing new to carry stay flags even though the pictures are unlike
   anything else in the suite — and why Radar and Gauge pay the cost knowingly. */
/* ── 0.4.1 WAVE 4 (the sequential-colour pair) applies the same rule, and it splits them ─────────
   Hexagonal binning (24) carries EXACTLY a scatter's data — parallel xs/values — so it is a FLAG,
   and the degradation argument is at its strongest there: an install that has never heard of
   `hexbin` draws the scatter of the very same points, which is the picture underneath the density.
   Heatmap (17) is a TYPE, and for a reason none of the earlier waves hit. Its carrier IS a bar's on
   the surface — labels plus one number per label — but its series are the grid's ROWS, so the 1-6
   series cap that guards every bar and line chart in every existing deck would have had to be
   relaxed to 24 INSIDE the branch that validates them. chart-data.ts refuses that kind of
   conditional weakening for waterfall and box plot, and refuses it here for the same reason: the
   rule protecting the old pictures must not acquire an exception owned by a new one. */
/* ── 0.4.1 WAVE 5 (the tree family) — one TYPE carrying two FLAGS, on the same rule ──────────────
   Treemap (19) is a TYPE. A tree is a new DATA SHAPE: every chart before it carries a FLAT list of
   categories, and no reader or writer of this format has ever had to learn that one label can be
   INSIDE another. `parents` is a genuinely new field with genuinely new rules — an index range and an
   acyclicity condition — and neither can be stated as a preference over a bar's carrier. The
   heatmap's test settles it from the other side as well: a flag would have had to widen the 1-24
   label cap to 60 INSIDE the branch that validates every plain bar chart in every existing deck,
   which is exactly the conditional weakening this file refuses for waterfall, box plot and heatmap.

   Sunburst (20) and Convex treemap (25) are FLAGS, and they are the clearest cases the arc has
   produced. Both read the SAME labels, the SAME parents and the SAME values; only the PICTURE
   differs — a polar partition instead of a rectangular one, rounded and gapped cells instead of
   abutting ones. Neither adds a field, neither changes a rule, and an install that has never heard
   of either drops the unknown key and draws the treemap of the very same tree, which is the picture
   underneath both of them. That is the degradation argument at full strength: a flag round-trips
   through an install that never heard of it, a type is rejected by name.

   The two flags are MUTUALLY EXCLUSIVE, on the funnel/polar precedent. `convex` describes the
   corners and the gaps of a RECTANGLE, and a sunburst has no rectangles to round; accepting the pair
   would take a choice the author made and silently discard half of it.

   The DISCOVERABILITY cost is paid where it always is — the Studio type picker lists Treemap,
   Convex Treemap and Sunburst as three first-class entries that set the flags (canvas-chart.ts,
   PRESET_LABELS + applyChartPreset). The author never sees the difference; the file format, the
   validator and every older install do. */
/* ── 0.4.1 WAVE 5b (27 Sankey) — a TYPE, and the last of the 27 ──────────────────────────────────
   A sankey is a GRAPH, and a graph is the second data shape this format has never carried. A tree
   let one label sit inside another; a flow diagram lets one label point AT another, any number of
   times, from both ends. `links` is therefore a field of its own kind: it is the first array in this
   interface that is NOT parallel to `labels` — it has its own length, its own cap, and its entries
   are RELATIONSHIPS rather than properties of a node. No flag on a bar or a line could carry that.

   WHY THE SERIES IS BALLAST, AND WHY IT IS NOT DELETED. A sankey node's size is its THROUGHPUT — the
   larger of what flows into it and what flows out — and every one of those numbers is already in
   `links`. Storing the throughput again in `series[0].values` would give one figure two sources, and
   the moment an author edits a link the two disagree, with nothing on the picture able to say which
   one is being drawn. The treemap's interior-node rule once made the same argument and has since been
   withdrawn — a tree node turned out to have a genuine value OF ITS OWN, drawn beside its children —
   and the difference is what leaves this rule standing: a sankey node has no such quantity. Its
   throughput is stated in full by `links` and by nothing else, so the values must ALL be zero, and the
   validator says so rather than ignoring what is there. Keeping the (empty) series is what lets a
   sankey stay one shape with every other chart — `series[0].name` still names the flow for a caption
   and every consumer that walks `series` keeps working — where deleting it would fork the one field
   every reader of this format already knows how to read.

   ACYCLIC, AND CHECKED PROPERLY. A sankey is drawn in COLUMNS, and a column is a position in a
   topological order; a cycle has no such order, so a cyclic flow is not a hard picture to draw but an
   impossible one. The check below is a real topological sort (Kahn), not the walk-up-under-a-budget
   the tree uses — a node may have many parents here, so there is no single chain to walk. */
/* ── 0.4.1 WAVE 6 (the two NAMING fields) — NEITHER earns a type, and one of them earns a rule ───
   `legend` and `pieLabels` both answer the same author question, asked from the two ends: WHERE DOES
   A COLOUR GET ITS NAME? Today the answer is always "in the swatch row under the picture", and the
   owner's report is that a pie's names belong in the pie. Both are picture-only — same labels, same
   series, same values — so by this file's own rule both are FLAGS, and the degradation argument is
   at full strength on each: an install that has never heard of either drops the unknown key and
   draws the legend it has always drawn.

   THE RULE THEY EARN IS THE GATE. Every flag before them rides on ONE type and is rejected
   everywhere else, which is a question about the DATA SHAPE. `legend` is a question about the
   PICTURE: it is accepted on every type that draws a swatch row and rejected on the four that never
   draw one — a gauge (one dial, named in its own middle), a heatmap and a hexbin (both decoded by a
   colour SCALE they draw inside the SVG, which is not a series key), and a sankey (whose palette
   repeats past eight nodes, so a swatch row would claim a colour stands for one name when it stands
   for two). Those four are exactly the types renderChart already gives an empty entry list, so the
   gate is a restatement of the renderer rather than a second opinion about it. Offering a switch
   that turns off something never drawn is the one sin this arc keeps closing; rejecting it is the
   only answer that cannot become that.

   A NOTE ON WHAT `legend: false` DOES NOT DO. It removes the swatch row and nothing else. The row is
   an HTML block BELOW the SVG, not a band inside it (chart.ts, renderChart), so the plot has no
   space to reclaim — the picture is drawn at exactly the same size and the block under it goes. */
export const CHART_TYPES = ['bar', 'line', 'pie', 'timeseries', 'scatter', 'waterfall', 'boxplot', 'radar', 'gauge', 'heatmap', 'treemap', 'sankey'];
/** Max rows in a heatmap — its series are the grid's ROWS, so the cap matches the 24-column label
    cap rather than the 1-6 series cap every other type keeps. */
export const HEATMAP_MAX_ROWS = 24;
/** Most nodes a TREEMAP takes, INTERIOR NODES INCLUDED — a type-specific label cap, on the heatmap's
    precedent that a cap belongs to the picture rather than to the whole format.

    It is 60 and not 24 because a tree spends labels the flat types do not: a two-level tree over 24
    leaves already needs 24 + its branches, so the 24 that is generous for a bar is short for the
    same data drawn as a tree. It is not larger than 60 because 60 is what a horizontal bar chart
    already takes — the widest cap in the format — and a treemap of more than 60 cells prints cells
    too small to name, at which point the picture has stopped stating anything a reader can use. */
export const TREEMAP_MAX_NODES = 60;
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
export const SANKEY_MAX_NODES = 60;
export const SANKEY_MAX_LINKS = 120;
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
export const HEXBIN_VALUES_MAX_BINS = 33;
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
export const CHART_PLOT_H_MIN = 180;
export const CHART_PLOT_H_MAX = 1200;
/** The bracket a stored `textScale` must fall inside — the multiplier on the FREE surfaces only
    (title, subtitle, axis titles, ticks, corner labels, the centre readout, a band label, the HTML
    legend). 0.75 is the floor a tick can shrink to before it reads as a footnote rather than a
    number; 1.5 is the ceiling a title can grow to before a two-line default wraps to three inside
    the title band's fixed height. Bracketed rather than clamped, on `plotHeight`'s own rule: a
    number outside it is not a smaller mistake than a string. */
export const TEXT_SCALE_MIN = 0.75;
export const TEXT_SCALE_MAX = 1.5;
/** Waterfall step kind. `total` is grounded at zero (an opening/closing balance); `increase` and
    `decrease` float from the running total. */
export const WATERFALL_KINDS = ['total', 'increase', 'decrease'];
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
/** A canonical A1 range: a single cell ("A1") or a two-cell range ("A1:C10"), uppercase only. */
const A1_RANGE_RE = /^[A-Z]+[0-9]+(:[A-Z]+[0-9]+)?$/;
/** A picture-only FLAG that is on the wrong picture. Present means it must be a boolean AND must be
    riding on the type that DRAWS it; absent is always legal, because every flag in this file is
    absent-by-default. Named once because the same rule gates a dozen of them. */
function misplacedFlag(value, drawnByThisType) {
    return value !== undefined && (typeof value !== 'boolean' || !drawnByThisType);
}
/** A real number the picture can draw — NaN and the infinities are rejected everywhere. */
function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
}
/** A string within its cap. Used on the optional captions, each of which is absent-by-default, so
    the caller tests `!== undefined` first. */
function isCappedString(x, max) {
    return typeof x === 'string' && x.length <= max;
}
/** An integer index into `labels` — the index-keyed discipline `highlightIndex` and a flow's
    endpoints share. (`parents` reads [-1, n) instead, so it states its own range.) */
function isLabelIndex(x, labelCount) {
    return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < labelCount;
}
function chartShape(d) {
    // A timeseries is keyed by numeric x per series, not by categories — so it carries no labels.
    const isTs = d.type === 'timeseries';
    // A scatter is keyed by (x,y) pairs — likewise category-free, but its y may be negative.
    const isXY = d.type === 'scatter';
    const isWf = d.type === 'waterfall';
    const isBox = d.type === 'boxplot';
    const isGauge = d.type === 'gauge';
    return {
        isTs,
        isXY,
        free: isTs || isXY,
        isWf,
        isBox,
        isRadar: d.type === 'radar',
        isGauge,
        isHeat: d.type === 'heatmap',
        // 19 Treemap — the wave-5 TYPE. Its two flags (sunburst, convex) are gated to it further down.
        isTree: d.type === 'treemap',
        // 27 Sankey — the wave-5b TYPE. `links` is gated to it further down, and it is the only field in
        // this file that carries a RELATIONSHIP rather than a property of a label.
        isFlow: d.type === 'sankey',
        // 24 Hexagonal binning — a scatter FLAG, so it is only ever true on a scatter (the gate below
        // rejects it anywhere else, and every rule keyed to it therefore reads a scatter).
        isHex: isXY && d.hexbin === true,
        // the two wave-3 bar SHAPES. Neither has a Cartesian plot box, and neither has room for a second
        // series, so both are treated exactly like the single-series types below.
        isFunnel: d.type === 'bar' && d.funnel === true,
        isPolar: d.type === 'bar' && d.polar === true,
        /* THE ONLY RELAXATION OF THE `value >= 0` RULE, and it is keyed to the TYPE, never to a flag.
           A waterfall step is a signed delta and a box's five-number summary is a coordinate, so both
           must carry negatives. bar / line / pie / timeseries keep the v0.4.0 rule untouched — which is
           exactly why Waterfall and Box plot are TYPES and not bar flags: a flag would have turned this
           into a conditional weakening INSIDE the branch that guards a plain bar, where every other bar
           chart in every existing deck is validated. There is no tension to report; the two rules never
           meet.
           A GAUGE joins them for a third reason: its dial is a coordinate range, so a floor of -40 and a
           reading of -12 are ordinary data. */
        signed: isWf || isBox || isGauge,
        labelCount: Array.isArray(d.labels) ? d.labels.length : 0,
    };
}
/* Horizontal ranking charts read fine with many rows; a vertical/pie stays capped at 24 (thin bars
   past that). A HEATMAP is pinned at 24 whatever `orientation` says: the key is inert on this type
   (see the note further down), and letting an inert key widen the column cap to 60 would VALIDATE a
   grid that normalizeChartData then truncates to 24 — a silently discarded half of the data, which
   is the one outcome both halves of this file exist to prevent. */
/* A TREEMAP is pinned at its own cap for the same reason a heatmap is pinned at 24: `orientation`
   is INERT on the type (see the note further down), so letting an inert key move the cap would make
   the legal node count depend on a field the picture never reads. TREEMAP_MAX_NODES states why 60.
   A SANKEY is pinned the same way and for the same reason — SANKEY_MAX_NODES states why 60 there. */
function labelCap(d, s) {
    return s.isTree ? TREEMAP_MAX_NODES : s.isFlow ? SANKEY_MAX_NODES : !s.isHeat && d.orientation === 'horizontal' ? 60 : 24;
}
function checkLabels(d, s, bad) {
    const maxLabels = labelCap(d, s);
    if (!Array.isArray(d.labels) || (!s.free && (d.labels.length < 1 || d.labels.length > maxLabels))) {
        bad('labels', s.free ? 'labels must be an array' : `labels must be an array of 1–${maxLabels} entries`);
        return;
    }
    // A gauge shows ONE dial and its label names it; more would be silently unread. A radar needs
    // three spokes to enclose an area — two draw a line back over itself, which is not a radar.
    if (s.isGauge && d.labels.length !== 1)
        bad('labels', 'a gauge takes exactly one label — the name of the dial');
    if (s.isRadar && d.labels.length < 3)
        bad('labels', 'a radar needs at least 3 spokes');
    d.labels.forEach((l, i) => {
        if (typeof l !== 'string' || l.length === 0 || l.length > 40)
            bad('label', `label ${i}: must be a non-empty string (max 40)`);
    });
}
/* Single-series types + the single-series flag. A pareto's second axis is a percentage OF a
   total, a waterfall is one running balance and a box plot is one distribution per category —
   none of the three has a meaning for a second series, so the count is rejected, not ignored.
   …and a TREEMAP joins them: `parents` describes ONE tree, so a second series would be a second
   set of node sizes for the same nodes, with nothing on the picture able to show both.
   …and a SANKEY joins them from the other side: its series carries no sizes at all (they are
   derived from `links`), so a second one would be a second set of nothing. */
function singleSeriesName(d, s) {
    return d.type === 'pie' ? 'pie chart' : s.isWf ? 'waterfall' : s.isBox ? 'box plot' : s.isGauge ? 'gauge' : s.isFunnel ? 'funnel' : s.isPolar ? 'radial bar' : s.isTree ? 'treemap' : s.isFlow ? 'sankey' : d.pareto === true ? 'pareto' : '';
}
function checkSeries(d, s, bad) {
    // A HEATMAP's series are the grid's ROWS, so its cap is the label cap, not the 1-6 series cap.
    // See the CHART_TYPES note for why that difference is what makes it a type and not a bar flag.
    const maxSeries = s.isHeat ? HEATMAP_MAX_ROWS : 6;
    if (!Array.isArray(d.series) || d.series.length < 1 || d.series.length > maxSeries) {
        bad('series', `series must be an array of 1–${maxSeries} entries`);
        return;
    }
    const one = singleSeriesName(d, s);
    if (one && d.series.length !== 1) {
        bad('series', `a ${one} takes exactly one series`);
    }
    d.series.forEach((entry, i) => checkSeriesEntry(entry, i, d, s, bad));
}
function checkSeriesEntry(entry, i, d, s, bad) {
    const o = (entry ?? {});
    checkSeriesStyle(o, i, d, bad);
    checkPointMarkFields(o, i, s, bad);
    checkDistributionFields(o, i, s, bad);
    if (s.free)
        checkFreeAxisSeries(o, i, s, bad);
    else
        checkCategoryValues(o, i, s, bad);
}
function checkSeriesStyle(o, i, d, bad) {
    if (!isCappedString(o.name, 60))
        bad('series.name', `series ${i}: name must be a string (max 60)`);
    if (typeof o.color !== 'string' || !COLOR_RE.test(o.color))
        bad('series.color', `series ${i}: color must be a #hex value`);
    if (o.dash !== undefined && typeof o.dash !== 'boolean')
        bad('series.dash', `series ${i}: dash must be a boolean`);
    if (o.markers !== undefined && typeof o.markers !== 'boolean')
        bad('series.markers', `series ${i}: markers must be a boolean`);
    // `fill` is a LINE concept (the band under the stroke) — a bar/pie/scatter has no band.
    if (misplacedFlag(o.fill, d.type === 'line'))
        bad('series.fill', `series ${i}: fill is a boolean on a line series only`);
}
/* bubble sizes + point captions are scatter-only; on any other type they are meaningless — and
   a HEXBIN is the case where "meaningless" needs saying out loud, because it IS a scatter. It
   replaces the individual point marks with a lattice of cells, so there is no disc left to
   size and no point left to caption; accepting either would take a value and discard it. */
function checkPointMarkFields(o, i, s, bad) {
    const wrong = s.isHex ? 'point-mark field a hexbin does not draw' : 'scatter-only field';
    if (o.sizes !== undefined && (!s.isXY || s.isHex))
        bad('series.sizes', `series ${i}: sizes is a ${wrong}`);
    if (o.pointLabels !== undefined && (!s.isXY || s.isHex))
        bad('series.pointLabels', `series ${i}: pointLabels is a ${wrong}`);
}
// distribution fields ride parallel to the CATEGORIES and mean nothing on any other type
function checkDistributionFields(o, i, s, bad) {
    for (const key of ['boxes', 'samples', 'outliers']) {
        const arr = o[key];
        if (arr === undefined)
            continue;
        if (!s.isBox) {
            bad(`series.${key}`, `series ${i}: ${key} is a boxplot-only field`);
        }
        else if (!Array.isArray(arr) || arr.length !== s.labelCount) {
            bad(`series.${key}`, `series ${i}: ${key} must have one array per label (${s.labelCount})`);
        }
        else {
            arr.forEach((row, j) => checkDistributionRow(row, key, i, j, bad));
        }
    }
    if (s.isBox && o.boxes === undefined && o.samples === undefined) {
        bad('series.boxes', `series ${i}: a box plot needs boxes (pre-computed) or samples (raw)`);
    }
}
/** One category's row of observations. `boxes` additionally carries a FIXED five-number summary. */
function checkDistributionRow(row, key, i, j, bad) {
    if (!Array.isArray(row) || (key === 'boxes' && row.length !== 5)) {
        bad(`series.${key}`, `series ${i} ${key} ${j}: must be an array${key === 'boxes' ? ' of exactly 5 numbers [low, Q1, median, Q3, high]' : ''}`);
        return;
    }
    row.forEach((n, k) => {
        if (!isFiniteNumber(n))
            bad(`series.${key}`, `series ${i} ${key} ${j}[${k}]: must be a finite number`);
        // REJECT, never repair: an out-of-order summary draws a median outside its own box and
        // a whisker inside it. normalizeChartData sorts it so the picture survives; the
        // validator says so, because only the author can know which number was wrong.
        else if (key === 'boxes' && k > 0 && typeof row[k - 1] === 'number' && n < row[k - 1])
            bad('series.boxes', `series ${i} box ${j}: must be ascending [low ≤ Q1 ≤ median ≤ Q3 ≤ high]`);
    });
}
/* xs parallel to values, per-series length. A timeseries reads left-to-right (x
   non-decreasing, y ≥ 0); a scatter is a cloud, so neither rule applies to it. */
function checkFreeAxisSeries(o, i, s, bad) {
    const xs = o.xs;
    const need = s.isXY ? 1 : 2;
    if (!Array.isArray(xs) || xs.length < need) {
        bad('series.xs', `series ${i}: xs must be an array of ≥${need} x-coordinates`);
        return;
    }
    if (!Array.isArray(o.values) || o.values.length !== xs.length) {
        bad('series.values', `series ${i}: values must parallel xs (${xs.length})`);
        return;
    }
    checkXYPoints(xs, o.values, i, s, bad);
    // bubble sizes + point captions ride parallel to the points
    if (!s.isXY)
        return;
    checkBubbleSizes(o, i, xs.length, bad);
    checkPointCaptions(o, i, xs.length, bad);
}
function checkXYPoints(xs, values, i, s, bad) {
    for (let k = 0; k < xs.length; k++) {
        const x = xs[k];
        if (!isFiniteNumber(x))
            bad('series.x', `series ${i} x ${k}: must be a finite number`);
        else if (s.isTs && k > 0 && typeof xs[k - 1] === 'number' && x < xs[k - 1])
            bad('series.x', `series ${i} x ${k}: must be non-decreasing`);
        const y = values[k];
        if (!isFiniteNumber(y) || (s.isTs && y < 0))
            bad('series.value', `series ${i} value ${k}: must be a finite number${s.isTs ? ' ≥ 0' : ''}`);
    }
}
function checkBubbleSizes(o, i, points, bad) {
    if (o.sizes === undefined)
        return;
    if (!Array.isArray(o.sizes) || o.sizes.length !== points) {
        bad('series.sizes', `series ${i}: sizes must have one number per point (${points})`);
        return;
    }
    o.sizes.forEach((z, k) => {
        if (!isFiniteNumber(z) || z < 0)
            bad('series.size', `series ${i} size ${k}: must be a finite number ≥ 0`);
    });
}
function checkPointCaptions(o, i, points, bad) {
    if (o.pointLabels === undefined)
        return;
    if (!Array.isArray(o.pointLabels) || o.pointLabels.length !== points) {
        bad('series.pointLabels', `series ${i}: pointLabels must have one string per point (${points})`);
        return;
    }
    o.pointLabels.forEach((t, k) => {
        if (!isCappedString(t, 40))
            bad('series.pointLabel', `series ${i} pointLabel ${k}: must be a string (max 40)`);
    });
}
function checkCategoryValues(o, i, s, bad) {
    if (!Array.isArray(o.values) || o.values.length !== s.labelCount) {
        bad('series.values', `series ${i}: values must have one number per label (${s.labelCount})`);
        return;
    }
    o.values.forEach((n, j) => {
        if (!isFiniteNumber(n) || (!s.signed && n < 0)) {
            bad('series.value', `series ${i} value ${j}: must be a finite number${s.signed ? '' : ' ≥ 0'}`);
        }
        else if (s.isFlow && n !== 0) {
            /* A SANKEY'S SERIES IS BALLAST, AND THE ZERO IS ENFORCED RATHER THAN IGNORED — the
               rule the treemap's interior nodes once carried, applied to every node instead. A node's
               size is its THROUGHPUT, which `links` already states in full; a number stored here
               would be a second source for it and the two would disagree the first time a flow was
               edited, with nothing on the picture able to say which one is being drawn. Requiring
               the zero is what stops the file carrying a number no reader will ever see. */
            bad('series.value', `series ${i} value ${j}: a sankey node is sized by its links, so its stored value must be 0`);
        }
    });
}
function checkYMax(d, bad) {
    if (d.yMax !== null && d.yMax !== undefined && (typeof d.yMax !== 'number' || !Number.isFinite(d.yMax) || d.yMax <= 0)) {
        bad('yMax', 'yMax must be null or a positive number');
    }
}
// Optional per-slice pie colours: when present, one #hex per label (dense, aligned).
function checkSliceColors(d, s, bad) {
    if (d.sliceColors === undefined)
        return;
    if (!Array.isArray(d.sliceColors) || d.sliceColors.length !== s.labelCount) {
        bad('sliceColors', `sliceColors, when present, must have one #hex per label (${s.labelCount})`);
        return;
    }
    d.sliceColors.forEach((c, i) => {
        if (typeof c !== 'string' || !COLOR_RE.test(c))
            bad('sliceColor', `sliceColor ${i}: must be a #hex value`);
    });
}
// Optional presentation fields (all absent-by-default; each: present → validate, absent → skip).
function checkBarLayoutFields(d, s, bad) {
    if (d.orientation !== undefined && d.orientation !== 'horizontal' && d.orientation !== 'vertical')
        bad('orientation', "orientation must be 'horizontal' or 'vertical'");
    if (d.barMode !== undefined && d.barMode !== 'grouped' && d.barMode !== 'overlaid' && d.barMode !== 'stacked')
        bad('barMode', "barMode must be 'grouped', 'overlaid' or 'stacked'");
    if (d.highlightIndex !== undefined && !isLabelIndex(d.highlightIndex, s.labelCount))
        bad('highlightIndex', `highlightIndex must be an integer in [0, ${s.labelCount})`);
    if (d.showValues !== undefined && typeof d.showValues !== 'boolean')
        bad('showValues', 'showValues must be a boolean');
}
function checkCaptionFields(d, bad) {
    if (d.title !== undefined && !isCappedString(d.title, 120))
        bad('title', 'title must be a string (max 120)');
    if (d.subtitle !== undefined && !isCappedString(d.subtitle, 120))
        bad('subtitle', 'subtitle must be a string (max 120)');
    if (d.xTitle !== undefined && !isCappedString(d.xTitle, 60))
        bad('xTitle', 'xTitle must be a string (max 60)');
    if (d.yTitle !== undefined && !isCappedString(d.yTitle, 60))
        bad('yTitle', 'yTitle must be a string (max 60)');
}
/* 0.4.1 wave-2 display flags. Each is a picture-only variant of the type it rides on, so each is
   gated to that type — a histogram on a pie means nothing and must not be quietly accepted. */
function checkDisplayFlags(d, bad) {
    // Sparkline is a LINE display mode — it has no meaning on a bar/pie/timeseries/scatter.
    if (misplacedFlag(d.spark, d.type === 'line'))
        bad('spark', 'spark is a boolean on a line chart only');
    if (misplacedFlag(d.histogram, d.type === 'bar'))
        bad('histogram', 'histogram is a boolean on a bar chart only');
    if (misplacedFlag(d.pareto, d.type === 'bar'))
        bad('pareto', 'pareto is a boolean on a bar chart only');
    // A pareto's second axis runs up the RIGHT of a vertical plot; a horizontal bar's value axis is
    // already along the bottom, so there is nowhere honest to put it.
    else if (d.pareto === true && d.orientation === 'horizontal')
        bad('pareto', 'pareto needs a vertical bar chart (orientation must not be horizontal)');
    if (misplacedFlag(d.stream, d.type === 'line'))
        bad('stream', 'stream is a boolean on a line chart only');
    // A sparkline strips the whole frame; a stream IS the frame. Asking for both is a contradiction.
    else if (d.stream === true && d.spark === true)
        bad('stream', 'stream and spark cannot both be set');
}
// Waterfall step kinds — parallel to the categories (a waterfall has exactly one series).
function checkWaterfallKinds(d, s, bad) {
    if (d.kinds === undefined)
        return;
    if (!s.isWf || !Array.isArray(d.kinds) || d.kinds.length !== s.labelCount) {
        bad('kinds', `kinds is a waterfall-only array of one step kind per label (${s.labelCount})`);
        return;
    }
    d.kinds.forEach((k, i) => {
        if (!WATERFALL_KINDS.includes(k))
            bad('kind', `kind ${i}: must be one of ${WATERFALL_KINDS.join('|')}`);
    });
}
/* 0.4.1 WAVE-3 display flags — the same gating as wave 2: each is a picture-only variant of the
   type it rides on, so each is rejected anywhere else rather than quietly accepted. */
function checkPolarFamilyFlags(d, bad) {
    if (misplacedFlag(d.donut, d.type === 'pie'))
        bad('donut', 'donut is a boolean on a pie chart only');
    if (misplacedFlag(d.rose, d.type === 'pie'))
        bad('rose', 'rose is a boolean on a pie chart only');
    if (misplacedFlag(d.funnel, d.type === 'bar'))
        bad('funnel', 'funnel is a boolean on a bar chart only');
    if (misplacedFlag(d.polar, d.type === 'bar'))
        bad('polar', 'polar is a boolean on a bar chart only');
}
/** The bar fields a funnel and a radial bar REPLACE rather than reinterpret — the key, and the
    reason the shape has nothing to apply it to. */
const SHAPE_REPLACED_FIELDS = [
    ['orientation', 'has no bar orientation'],
    ['barMode', 'has no bar grouping mode'],
    ['highlightIndex', 'has no category band to highlight'],
    ['histogram', 'cannot also be a histogram'],
    ['pareto', 'cannot also be a pareto'],
];
/* A funnel and a radial bar each REPLACE the bar's plot box with a shape of their own, so every
   field that describes that plot box is a contradiction rather than a preference. Rejected, not
   ignored: a chart that accepted "Horizontal" and then drew a funnel would be discarding a choice
   the author made and telling them nothing. */
function checkShapeReplacements(d, s, bad) {
    if (s.isFunnel || s.isPolar) {
        const shape = s.isFunnel ? 'funnel' : 'radial bar';
        if (s.isFunnel && s.isPolar)
            bad('funnel', 'funnel and polar cannot both be set');
        for (const [key, why] of SHAPE_REPLACED_FIELDS) {
            if (d[key] !== undefined)
                bad(key, `a ${shape} ${why}`);
        }
    }
    // A funnel NAMES AND VALUES every stage unconditionally (chart/funnel.ts says why), so the flag
    // has nothing left to switch; a gauge's centre readout is the value. Both would be discarded.
    if (d.showValues !== undefined && (s.isFunnel || s.isGauge))
        bad('showValues', `a ${s.isFunnel ? 'funnel' : 'gauge'} always prints its own value — showValues has no meaning`);
}
function axislessShapeName(s) {
    return s.isRadar ? 'radar' : s.isGauge ? 'gauge' : s.isFunnel ? 'funnel' : s.isTree ? 'treemap' : s.isFlow ? 'sankey' : 'radial bar';
}
/* NO x/y AXIS, SO NO AXIS TITLE. A polar chart's spokes and rings are its axes and they are named
   on the chart itself; a funnel and a gauge have no axis at all. This is the stream-graph trap
   that cost wave 2 a defect — a title that validates, saves, round-trips and is never drawn.
   …and a TREEMAP joins the four: its cells are nested areas, not positions on a pair of scales,
   so there is no axis anywhere on the picture for a title to name.
   …and a SANKEY joins them as the sixth. Its columns look like an axis and are not one: a column
   is a position in a topological ORDER, not a value on a scale, and the vertical extent is a stack
   of throughputs with no origin. Naming either would name a measurement the picture never makes. */
function checkAxisTitles(d, s, bad) {
    if (!s.isRadar && !s.isGauge && !s.isFunnel && !s.isPolar && !s.isTree && !s.isFlow)
        return;
    if (d.xTitle !== undefined || d.yTitle !== undefined)
        bad('xTitle', `a ${axislessShapeName(s)} has no x/y axis to title`);
}
// Radar spoke ceilings — parallel to the spokes, each strictly positive (a spoke with a ceiling of
// zero has no scale, and every value on it would land on the centre).
function checkRadarMaxes(d, s, bad) {
    if (d.maxes === undefined)
        return;
    if (!s.isRadar || !Array.isArray(d.maxes) || d.maxes.length !== s.labelCount) {
        bad('maxes', `maxes is a radar-only array of one ceiling per spoke (${s.labelCount})`);
        return;
    }
    d.maxes.forEach((m, i) => {
        if (!isFiniteNumber(m) || m <= 0)
            bad('max', `max ${i}: must be a finite number > 0`);
    });
}
// Gauge bounds + unit suffix.
function checkGaugeBounds(d, s, bad) {
    for (const key of ['gaugeMin', 'gaugeMax']) {
        if (d[key] === undefined)
            continue;
        if (!s.isGauge || !isFiniteNumber(d[key]))
            bad(key, `${key} is a gauge-only finite number`);
    }
    if (s.isGauge && typeof d.gaugeMin === 'number' && typeof d.gaugeMax === 'number' && d.gaugeMax <= d.gaugeMin) {
        bad('gaugeMax', 'gaugeMax must be greater than gaugeMin');
    }
    if (d.unit !== undefined && (!s.isGauge || !isCappedString(d.unit, 8)))
        bad('unit', 'unit is a gauge-only string (max 8)');
}
/* ── 0.4.1 WAVE 4 ────────────────────────────────────────────────────────────────────────────
   24 Hexagonal binning is a scatter FLAG, gated to its type exactly like every flag before it.
   `hexBins` is meaningless without it — a bin count with nothing to bin — so it is refused on a
   plain scatter rather than stored and ignored. */
function checkHexbin(d, s, bad) {
    if (misplacedFlag(d.hexbin, s.isXY))
        bad('hexbin', 'hexbin is a boolean on a scatter chart only');
    if (d.hexBins !== undefined && (!s.isHex || typeof d.hexBins !== 'number' || !Number.isInteger(d.hexBins) || d.hexBins < 4 || d.hexBins > 60)) {
        bad('hexBins', 'hexBins is a hexbin-only integer in [4, 60] — the number of hex columns across the plot');
    }
}
/* 17 Heatmap refuses exactly ONE shared field, and the line it draws is deliberate.
   `showValues` is REJECTED, on the funnel's precedent: chart/heatmap.ts prints the value in every
   cell that has room for one, unconditionally, because a printed grid with no numbers can only be
   estimated from colour. There is nothing left for the flag to switch.
   The BAR-LAYOUT fields — orientation, barMode, highlightIndex — and `sliceColors` are NOT
   rejected, and that is the pie's precedent rather than the funnel's. A funnel IS a bar, so a bar
   orientation on one is a contradiction inside a single type; a heatmap is a different type
   entirely, where those keys are as inert as `orientation` has been on a pie since v0.4.0.
   Rejecting them would also make a bar → heatmap switch produce a chart the author cannot save
   and has no control left to repair. Inert and legal beats rejected and unreachable. */
function checkHeatmapShowValues(d, s, bad) {
    if (s.isHeat && d.showValues !== undefined) {
        bad('showValues', 'a heatmap always prints the value in every cell that fits one — showValues has no meaning');
    }
}
/** One entry of `parents`: an index in [-1, n) that is not the node itself. */
function checkParentIndex(n, i, labelCount, bad) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < -1 || n >= labelCount) {
        bad('parent', `parent ${i}: must be an integer in [-1, ${labelCount}) — -1 means a root`);
        return false;
    }
    if (n === i) {
        bad('parent', `parent ${i}: a node cannot be its own parent`);
        return false;
    }
    return true;
}
/* ACYCLICITY, checked by WALKING UP from every node under a step budget of one hop per node.
   A forest of n nodes has at most n-1 edges above any node, so a walk that has not reached a
   root in n steps is inside a cycle — there is no other way to spend that many steps.
   This is ALSO the "at least one root" rule, and it is not checked twice on purpose: every
   entry is already in [-1, n), so a parents array with no -1 gives all n nodes an out-edge,
   and n out-edges over n nodes always close a cycle. A separate root test could therefore
   never fail on its own, and a condition that cannot be false is worse than no condition. */
function firstCyclicNode(par, labelCount) {
    for (let i = 0; i < labelCount; i++) {
        let at = par[i];
        for (let steps = 0; at >= 0; steps++) {
            if (steps >= labelCount)
                return i;
            at = par[at];
        }
    }
    return -1;
}
/* ── 0.4.1 WAVE 5 — the TREE, and the two flags that only change how it is drawn ───────────────
   `parents` is the one genuinely new carrier this wave adds, and every rule on it REJECTS rather
   than repairs. A tree is the one shape in this format where a single wrong number is not a wrong
   VALUE but a wrong STRUCTURE: an index one out of range moves a whole branch, and only the author
   knows which branch it was meant to hang from. normalizeChartData repairs the same faults so the
   picture survives an old or hand-edited file; the validator says so, because a repaired tree is a
   different tree and nothing on the drawing says which one you are looking at.

   AN INTERIOR NODE'S VALUE IS ITS OWN, ON EXACTLY A LEAF'S TERMS — there is no rule here, and
   the absence is the decision.

   WHAT THIS REPLACES demanded a stored ZERO on every node with children, on the ground that a
   branch's size was DERIVED from the leaves under it and a stored number would be a second
   source for one figure. The premise was the defect. A parent that owned 40 and held a child
   of 50 drew a box of 50, so a sibling of 80 looked BIGGER than a group the data said was 90 —
   a treemap's only claim is that area is share, and it was stating a false one.

   A parent now KEEPS its own value and its box holds that value PLUS everything under it,
   drawn as a self-cell among the children (runtime chart/treemap.ts states the picture). The
   stored number is the OWN share, so there is still exactly one source for it, and the general
   `>= 0` finite rule above already covers it — a second rule here could only disagree.

   A STORED ZERO IS STILL LEGAL, which is what makes every deck written under the old rule load
   and draw exactly as it always did: no own value, no self-cell, the same picture. */
function checkTreemapParents(d, s, bad) {
    if (d.parents === undefined)
        return;
    if (!s.isTree || !Array.isArray(d.parents) || d.parents.length !== s.labelCount) {
        bad('parents', `parents is a treemap-only array of one parent index per label (${s.labelCount})`);
        return;
    }
    const p = d.parents;
    let shaped = true;
    p.forEach((n, i) => {
        if (!checkParentIndex(n, i, s.labelCount, bad))
            shaped = false;
    });
    if (!shaped)
        return;
    const cyclic = firstCyclicNode(p, s.labelCount);
    if (cyclic >= 0)
        bad('parents', `parents must form a forest — node ${cyclic} is inside a cycle`);
}
/* The two picture-only flags, gated to the type exactly like every flag before them, and mutually
   exclusive on the funnel/polar precedent: `convex` rounds and insets a RECTANGLE, and a sunburst
   has no rectangles to round.
   A TREEMAP NAMES AND SIZES EVERY CELL IT HAS ROOM FOR, unconditionally — the funnel's and the
   heatmap's precedent. There is no axis beside a cell to measure its area against, so a cell with
   no number can only be estimated by eye, and the flag would have nothing left to switch. */
function checkTreemapFlags(d, s, bad) {
    if (misplacedFlag(d.sunburst, s.isTree))
        bad('sunburst', 'sunburst is a boolean on a treemap only');
    if (misplacedFlag(d.convex, s.isTree))
        bad('convex', 'convex is a boolean on a treemap only');
    else if (d.convex === true && d.sunburst === true)
        bad('convex', 'sunburst and convex cannot both be set');
    if (s.isTree && d.showValues !== undefined) {
        bad('showValues', 'a treemap prints the name and value in every cell that fits them — showValues has no meaning');
    }
}
/** A flow's `from` and `to` — both indices into `labels`, on `parents`' index-keyed discipline. */
function checkFlowEndpoints(o, i, labelCount, bad) {
    let ok = true;
    for (const key of ['from', 'to']) {
        if (!isLabelIndex(o[key], labelCount)) {
            bad(`links.${key}`, `link ${i}: ${key} must be an integer in [0, ${labelCount}) — an index into labels`);
            ok = false;
        }
    }
    return ok;
}
/** Validate one flow and, when it is sound, record its endpoints for the graph checks below. */
function collectFlow(l, i, labelCount, from, to, bad) {
    if (l === null || typeof l !== 'object' || Array.isArray(l)) {
        bad('links', `link ${i}: must be an object { from, to, value }`);
        return false;
    }
    const o = l;
    let ok = checkFlowEndpoints(o, i, labelCount, bad);
    // A SELF-LOOP IS NOT A SMALL CYCLE, it is a ribbon that starts and ends on the same bar and
    // so encloses no flow at all. It is named separately from the acyclicity rule below because
    // an author who typed one row twice needs to be told which row, not that the graph is cyclic.
    if (ok && o.from === o.to) {
        bad('links.from', `link ${i}: a flow cannot start and end at the same node`);
        ok = false;
    }
    const v = o.value;
    // > 0, NOT >= 0: a zero-value ribbon is not a thin ribbon but nothing at all, and a flow of
    // nothing between two nodes states a connection that is not there. A negative flow would draw
    // its ribbon backwards through the node it leaves.
    if (!isFiniteNumber(v) || v <= 0) {
        bad('links.value', `link ${i}: value must be a finite number > 0`);
        ok = false;
    }
    if (!ok)
        return false;
    from.push(o.from);
    to.push(o.to);
    return true;
}
/* ACYCLICITY BY A REAL TOPOLOGICAL SORT (Kahn), and not by the walk-up-under-a-budget the
   treemap uses. A tree node has exactly one parent, so there is one chain to walk; a sankey
   node has any number of predecessors, so there is no single chain and the walk would have
   to branch. Kahn instead repeatedly removes a node with no remaining incoming edge: what is
   left when nothing can be removed is exactly the part of the graph that is inside a cycle. */
function checkFlowsAcyclic(from, to, labelCount, bad) {
    const indeg = new Array(labelCount).fill(0);
    const out = Array.from({ length: labelCount }, () => []);
    for (let i = 0; i < from.length; i++) {
        out[from[i]].push(to[i]);
        indeg[to[i]]++;
    }
    const queue = [];
    for (let i = 0; i < labelCount; i++)
        if (indeg[i] === 0)
            queue.push(i);
    let seen = 0;
    for (let q = 0; q < queue.length; q++) {
        seen++;
        for (const t of out[queue[q]])
            if (--indeg[t] === 0)
                queue.push(t);
    }
    if (seen >= labelCount)
        return;
    // the lowest-indexed node still carrying an incoming edge — the entry point into the ring
    const stuck = indeg.findIndex((n) => n > 0);
    bad('links', `the flows must be ACYCLIC — node ${stuck} is inside a cycle, and a cycle has no column to sit in`);
}
/* EVERY NODE IN AT LEAST ONE FLOW. A node with no edge has no throughput, so no height; no
   edge, so no column; and nothing on the picture at all. It is rejected rather than dropped
   because a silently missing name is the one fault a reader of a printed deck cannot see. */
function checkEveryNodeLinked(from, to, labelCount, bad) {
    const linked = new Set([...from, ...to]);
    for (let i = 0; i < labelCount; i++) {
        if (!linked.has(i))
            bad('links', `node ${i} appears in no flow — a sankey node with no link has no place in the diagram`);
    }
}
/* ── 0.4.1 WAVE 5b — 27 SANKEY, the flows ────────────────────────────────────────────────────
   `links` is REQUIRED here and rejected everywhere else. Required, because a sankey with no flows
   is not a plainer sankey — it is a column of unconnected names, which is a list and not a
   diagram; and every rule below rejects rather than repairs, on `parents`' precedent: a wrong
   index in a graph is a wrong STRUCTURE, and only the author knows which node was meant.
   normalizeChartData repairs the same faults so a hand-edited file still draws something.
   A SANKEY NAMES AND VALUES EVERY NODE IT HAS ROOM FOR, unconditionally — the funnel's, the
   heatmap's and the treemap's precedent, now the fourth time it is reached. A node bar is a
   throughput with no axis beside it, so a bar with no number can only be estimated against the
   other bars, and the flag would have nothing left to switch. */
function checkSankeyLinks(d, s, bad) {
    if (s.isFlow && d.showValues !== undefined) {
        bad('showValues', 'a sankey prints each node’s name and throughput wherever there is room — showValues has no meaning');
    }
    if (d.links !== undefined && !s.isFlow) {
        bad('links', 'links is a sankey-only array of { from, to, value } flows');
        return;
    }
    if (!s.isFlow)
        return;
    const raw = d.links;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > SANKEY_MAX_LINKS) {
        bad('links', `a sankey needs a links array of 1–${SANKEY_MAX_LINKS} { from, to, value } flows`);
        return;
    }
    let shaped = true;
    const from = [];
    const to = [];
    raw.forEach((l, i) => {
        if (!collectFlow(l, i, s.labelCount, from, to, bad))
            shaped = false;
    });
    if (!shaped)
        return;
    checkFlowsAcyclic(from, to, s.labelCount, bad);
    checkEveryNodeLinked(from, to, s.labelCount, bad);
}
/* ── 0.4.1 WAVE 6 — the two NAMING flags ─────────────────────────────────────────────────────
   `legend` is gated on what the PICTURE draws rather than on one type, which is new here and is
   argued in full above CHART_TYPES. The four refusals are exactly the four types renderChart gives
   an empty swatch list: a gauge names its one dial in the middle of itself, a heatmap and a hexbin
   are decoded by the colour SCALE each draws inside its own SVG (a scale is not a series key), and
   a sankey's palette repeats past eight nodes, so a swatch row there would claim a colour stands
   for one name when it stands for two. On all four there is no row to suppress, and a flag that
   switches off something never drawn is this arc's cardinal sin. */
function checkLegend(d, s, bad) {
    if (d.legend === undefined)
        return;
    if (typeof d.legend !== 'boolean') {
        bad('legend', 'legend must be a boolean');
        return;
    }
    if (!s.isGauge && !s.isHeat && !s.isFlow && !s.isHex)
        return;
    const what = s.isGauge ? 'gauge' : s.isHeat ? 'heatmap' : s.isFlow ? 'sankey' : 'hexbin';
    bad('legend', `a ${what} draws no swatch legend — legend has nothing to switch`);
}
/* `pieLabels` is an ordinary one-type flag: only a pie has slices with room inside them for a
   name. Every other picture already prints its categories along an axis, in its own cells, or has
   no categorical key at all. */
function checkPieLabels(d, bad) {
    if (misplacedFlag(d.pieLabels, d.type === 'pie')) {
        bad('pieLabels', 'pieLabels is a boolean on a pie chart only');
    }
}
/* `plotHeight` is a GEOMETRY field rather than a flag, so it is bracketed rather than type-keyed:
   it is legal on every picture (a value typed on a bar chart has to survive a trip through the
   horizontal switch and be honoured again on the way back), and the three pictures that cannot
   draw it — a horizontal bar, a heatmap, a sparkline — WITHHOLD the control instead of rejecting
   the key, which is the rule the arc has kept since `yMax` on a stream graph.

   Bracketed and not clamped: a number outside [CHART_PLOT_H_MIN, CHART_PLOT_H_MAX] is not a
   smaller mistake than a string, and silently pulling it to the nearest bound would draw a chart
   the file does not describe. */
function checkPlotHeight(d, bad) {
    if (d.plotHeight !== undefined &&
        (typeof d.plotHeight !== 'number' ||
            !Number.isFinite(d.plotHeight) ||
            d.plotHeight < CHART_PLOT_H_MIN ||
            d.plotHeight > CHART_PLOT_H_MAX)) {
        bad('plotHeight', `plotHeight is the plot box height in viewBox units — a number in [${CHART_PLOT_H_MIN}, ${CHART_PLOT_H_MAX}]`);
    }
}
/* 0.4.1h CHART TEXT — three fields, legal on every picture (never type-keyed), on the same
   withhold-the-control-keep-the-value rule plotHeight and legend already keep: the panel decides
   per picture which of the FREE surfaces exist to colour, this schema only checks the shape. */
function checkChartText(d, bad) {
    if (d.textColor !== undefined && (typeof d.textColor !== 'string' || !COLOR_RE.test(d.textColor))) {
        bad('textColor', 'textColor must be a #hex value');
    }
    if (d.textFont !== undefined && d.textFont !== 'playfair' && d.textFont !== 'lora' && d.textFont !== 'inter' && d.textFont !== 'source-serif') {
        bad('textFont', "textFont must be one of 'playfair', 'lora', 'inter', 'source-serif'");
    }
    if (d.textScale !== undefined &&
        (typeof d.textScale !== 'number' || !Number.isFinite(d.textScale) || d.textScale < TEXT_SCALE_MIN || d.textScale > TEXT_SCALE_MAX)) {
        bad('textScale', `textScale is a multiplier on the free surfaces' own size — a number in [${TEXT_SCALE_MIN}, ${TEXT_SCALE_MAX}]`);
    }
}
function checkQuadrantCorners(q, bad) {
    if (q.corners === undefined)
        return;
    if (!Array.isArray(q.corners) || q.corners.length > 4) {
        bad('quadrant.corners', 'quadrant.corners must be an array of up to 4 captions');
        return;
    }
    q.corners.forEach((c, i) => {
        if (!isCappedString(c, 60))
            bad('quadrant.corner', `quadrant corner ${i}: must be a string (max 60)`);
    });
}
// Quadrant split + corner captions (scatter only) — and NOT on a hexbin, whose lattice replaces
// the very point marks the split lines are there to divide.
function checkQuadrant(d, s, bad) {
    if (d.quadrant === undefined)
        return;
    if (s.isHex) {
        bad('quadrant', 'a hexbin bins the whole cloud — a quadrant split has no point marks to divide');
        return;
    }
    const q = d.quadrant;
    if (!s.isXY || q === null || typeof q !== 'object' || Array.isArray(q)) {
        bad('quadrant', 'quadrant is a scatter-only object { x, y, corners? }');
        return;
    }
    if (!isFiniteNumber(q.x))
        bad('quadrant.x', 'quadrant.x must be a finite number');
    if (!isFiniteNumber(q.y))
        bad('quadrant.y', 'quadrant.y must be a finite number');
    checkQuadrantCorners(q, bad);
}
/** The picture named in the link refusal — the type that cannot read a ledger range. */
function unlinkableChartName(s) {
    return s.isTs ? 'timeseries' : s.isBox ? 'box plot' : s.isGauge ? 'gauge' : s.isTree ? 'treemap' : s.isFlow ? 'sankey' : 'scatter';
}
function checkLinkFields(l, bad) {
    if (typeof l.ledgerId !== 'string' || l.ledgerId.length === 0 || l.ledgerId.length > 64)
        bad('link.ledgerId', 'link.ledgerId must be a non-empty string (max 64)');
    if (l.tab !== undefined && (typeof l.tab !== 'string' || l.tab.length === 0 || l.tab.length > 64))
        bad('link.tab', 'link.tab must be a non-empty string (max 64)');
    if (typeof l.range !== 'string' || !A1_RANGE_RE.test(l.range))
        bad('link.range', 'link.range must be an A1 range like "A1:C10"');
    if (typeof l.header !== 'boolean')
        bad('link.header', 'link.header must be a boolean');
    if (l.orient !== undefined && l.orient !== 'row' && l.orient !== 'col')
        bad('link.orient', "link.orient must be 'row' or 'col'");
}
// Optional ledger link (present → strict shape check, absent → skip). A timeseries and a scatter
// can't link — the range→series mapper only emits bar/line/pie (a categorical range has no second
// numeric axis to map x onto), so reject a link on either.
// A BOX PLOT joins the ban for a different reason: a ledger cell yields ONE number, and a box
// needs five (or a whole sample column) per category — the range→series mapper has no shape to
// map onto. A WATERFALL is NOT banned: labels + one signed column is exactly what the mapper
// already emits, and the step kinds default from the sign.
// A GAUGE joins the ban, and for the sharpest version of the box plot's reason: a gauge takes ONE
// number, while a range is a rectangle of cells that the mapper turns into labels plus a column
// per series. There is no range a gauge could read — and its floor and ceiling are not in the
// grid at all. A RADAR is NOT banned: labels plus one column per series is exactly what the mapper
// emits, and absent `maxes` simply means every spoke shares one ceiling.
// A HEATMAP is not merely allowed to link — it is the BEST fit in the suite. Every other picture
// collapses a range into bars or slices and throws the rectangle away; a heatmap draws the whole
// rectangle, one cell per ledger cell, with the header row naming the rows. `link.orient:col`
// transposes it, and the mapper's clamp to >= 0 costs it nothing (its own schema requires that).
// A TREEMAP joins the ban, on the BOX PLOT's reason rather than the gauge's: the range→series
// mapper emits labels plus one column per series and has no shape that says which label is INSIDE
// which. A linked treemap could therefore only ever be a flat forest — a bar chart in rectangles —
// so the door is shut rather than opened onto half the type. Lifting it needs a mapper that can
// read a second key column as a parent name, which is a wave of its own.
// A SANKEY joins the ban on the treemap's reason at its sharpest: the mapper emits labels plus one
// COLUMN PER SERIES, and a flow is not a column — it is a pair of node names and a magnitude, which
// a categorical range has no shape for. A linked sankey could only be a set of nodes with no edges,
// which is the one thing this type rejects outright.
function checkLedgerLink(d, s, bad) {
    if (d.link === undefined)
        return;
    if (s.free || s.isBox || s.isGauge || s.isTree || s.isFlow) {
        bad('link', `a ${unlinkableChartName(s)} chart cannot link to a ledger`);
        return;
    }
    if (d.link === null || typeof d.link !== 'object' || Array.isArray(d.link)) {
        bad('link', 'link must be an object { ledgerId, range, header }');
        return;
    }
    checkLinkFields(d.link, bad);
}
/** Strict shape check for one chart data block. REJECT, never repair.

    The body is a DISPATCHER. Every rule lives in a named check above, and the checks run in the
    order their violations are expected in — the rule code, the message and the ORDER are all part
    of the format's contract, so a check is named and moved out, never reordered. */
export function validateChartData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `chart.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'chart data must be a JSON object');
        return v;
    }
    const d = data;
    if (!CHART_TYPES.includes(d.type)) {
        bad('type', `type must be one of ${CHART_TYPES.join('|')}`);
    }
    const s = chartShape(d);
    checkLabels(d, s, bad);
    checkSeries(d, s, bad);
    checkYMax(d, bad);
    checkSliceColors(d, s, bad);
    checkBarLayoutFields(d, s, bad);
    checkCaptionFields(d, bad);
    checkDisplayFlags(d, bad);
    checkWaterfallKinds(d, s, bad);
    checkPolarFamilyFlags(d, bad);
    checkShapeReplacements(d, s, bad);
    checkAxisTitles(d, s, bad);
    checkRadarMaxes(d, s, bad);
    checkGaugeBounds(d, s, bad);
    checkHexbin(d, s, bad);
    checkHeatmapShowValues(d, s, bad);
    checkTreemapParents(d, s, bad);
    checkTreemapFlags(d, s, bad);
    checkSankeyLinks(d, s, bad);
    checkLegend(d, s, bad);
    checkPieLabels(d, bad);
    checkPlotHeight(d, bad);
    checkChartText(d, bad);
    checkQuadrant(d, s, bad);
    checkLedgerLink(d, s, bad);
    return v;
}
/** Serialize chart data for embedding — "<" escaped (the carrier invariant).
    Keys are emitted in a FIXED canonical order (present-only), so a field the editor
    happened to append last still serializes deterministically. Charts that use none of
    the optional fields are byte-identical to the pre-1A/1D shape. */
export function chartDataJson(data) {
    const isTs = data.type === 'timeseries';
    const isXY = data.type === 'scatter';
    const isBox = data.type === 'boxplot';
    const series = data.series.map((o) => ({
        name: o.name,
        color: o.color,
        values: o.values,
        ...((isTs || isXY) && o.xs !== undefined ? { xs: o.xs } : {}), // xs is an x/y concept — never emitted for bar/line/pie
        ...(o.dash !== undefined ? { dash: o.dash } : {}),
        ...(o.markers !== undefined ? { markers: o.markers } : {}),
        // 0.4.1 fields APPEND after every pre-existing key, so a series that uses none of them is
        // byte-identical to what 0.4.0 emitted.
        ...(o.fill !== undefined ? { fill: o.fill } : {}),
        ...(isXY && o.sizes !== undefined ? { sizes: o.sizes } : {}),
        ...(isXY && o.pointLabels !== undefined ? { pointLabels: o.pointLabels } : {}),
        // 0.4.1 WAVE-2 fields append after the wave-1 ones, for the same reason.
        ...(isBox && o.boxes !== undefined ? { boxes: o.boxes } : {}),
        ...(isBox && o.samples !== undefined ? { samples: o.samples } : {}),
        ...(isBox && o.outliers !== undefined ? { outliers: o.outliers } : {}),
    }));
    const ordered = {
        type: data.type,
        labels: data.labels,
        series,
        yMax: data.yMax,
        ...(data.orientation !== undefined ? { orientation: data.orientation } : {}),
        ...(data.barMode !== undefined ? { barMode: data.barMode } : {}),
        ...(data.highlightIndex !== undefined ? { highlightIndex: data.highlightIndex } : {}),
        ...(data.showValues !== undefined ? { showValues: data.showValues } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.xTitle !== undefined ? { xTitle: data.xTitle } : {}),
        ...(data.yTitle !== undefined ? { yTitle: data.yTitle } : {}),
        ...(data.sliceColors !== undefined ? { sliceColors: data.sliceColors } : {}),
        ...(data.link !== undefined
            ? {
                link: {
                    ledgerId: data.link.ledgerId,
                    ...(data.link.tab !== undefined ? { tab: data.link.tab } : {}), // absent = legacy top-level link (byte-stable)
                    range: data.link.range,
                    header: data.link.header,
                    ...(data.link.orient !== undefined ? { orient: data.link.orient } : {}), // 'row' is the default → omitted
                },
            }
            : {}),
        // 0.4.1 fields APPEND after every pre-existing key (see the series map above).
        ...(data.spark !== undefined ? { spark: data.spark } : {}),
        ...(data.quadrant !== undefined
            ? {
                quadrant: {
                    x: data.quadrant.x,
                    y: data.quadrant.y,
                    ...(data.quadrant.corners !== undefined ? { corners: data.quadrant.corners } : {}),
                },
            }
            : {}),
        // 0.4.1 WAVE-2 chart-level fields, appended last again.
        ...(data.histogram !== undefined ? { histogram: data.histogram } : {}),
        ...(data.pareto !== undefined ? { pareto: data.pareto } : {}),
        ...(data.stream !== undefined ? { stream: data.stream } : {}),
        ...(data.kinds !== undefined ? { kinds: data.kinds } : {}),
        // 0.4.1 WAVE-3 chart-level fields, appended after the wave-2 ones for the same reason: a chart
        // that uses none of them is byte-identical to what the previous wave emitted.
        ...(data.donut !== undefined ? { donut: data.donut } : {}),
        ...(data.rose !== undefined ? { rose: data.rose } : {}),
        ...(data.funnel !== undefined ? { funnel: data.funnel } : {}),
        ...(data.polar !== undefined ? { polar: data.polar } : {}),
        ...(data.maxes !== undefined ? { maxes: data.maxes } : {}),
        ...(data.gaugeMin !== undefined ? { gaugeMin: data.gaugeMin } : {}),
        ...(data.gaugeMax !== undefined ? { gaugeMax: data.gaugeMax } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        // 0.4.1 WAVE-4 chart-level fields, appended after the wave-3 ones on the same rule: a chart that
        // uses none of them serializes byte-identically to what the previous wave emitted.
        ...(data.hexbin !== undefined ? { hexbin: data.hexbin } : {}),
        ...(data.hexBins !== undefined ? { hexBins: data.hexBins } : {}),
        // 0.4.1 WAVE-5 chart-level fields, appended after the wave-4 ones on the same rule: a chart that
        // uses none of them serializes byte-identically to what the previous wave emitted. The order
        // inside the wave is the order the picture is built in — the tree first, then how it is drawn.
        ...(data.parents !== undefined ? { parents: data.parents } : {}),
        ...(data.sunburst !== undefined ? { sunburst: data.sunburst } : {}),
        ...(data.convex !== undefined ? { convex: data.convex } : {}),
        // …and 27 SANKEY's flows last of all, on the same append-only rule. Each entry is rebuilt key by
        // key rather than spread, so a link object that picked up a stray property in an editor session
        // cannot widen the file — the same discipline the `link` and `quadrant` objects above keep.
        ...(data.links !== undefined
            ? { links: data.links.map((l) => ({ from: l.from, to: l.to, value: l.value })) }
            : {}),
        // 0.4.1 WAVE-6 chart-level fields, appended after the wave-5b flows on the same append-only rule:
        // a chart that uses neither serializes byte-identically to what the previous wave emitted, which
        // is what keeps every saved deck untouched by this wave. Legend first, then the pie's own
        // variation on it — the general question before the specific one.
        ...(data.legend !== undefined ? { legend: data.legend } : {}),
        ...(data.pieLabels !== undefined ? { pieLabels: data.pieLabels } : {}),
        // …and the plot box's own height LAST in the wave, on the same append-only rule: a chart whose
        // height was never dragged carries no key, so every deck written before this control is
        // byte-identical. It is a size rather than a word or a switch, so it sits after both.
        ...(data.plotHeight !== undefined ? { plotHeight: data.plotHeight } : {}),
        // 0.4.1h CHART TEXT, appended after plotHeight on the same append-only rule: a chart whose LOOK
        // panel never opened the text cluster carries none of the three keys, so it is byte-identical to
        // a deck written before this wave. Colour, then family, then size — the order the panel's own
        // cluster reads left to right.
        ...(data.textColor !== undefined ? { textColor: data.textColor } : {}),
        ...(data.textFont !== undefined ? { textFont: data.textFont } : {}),
        ...(data.textScale !== undefined ? { textScale: data.textScale } : {}),
    };
    return JSON.stringify(ordered, null, 2).replace(/</g, '\\u003c');
}
