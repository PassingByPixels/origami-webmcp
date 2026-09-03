/* Whole-fold starters, ported VERBATIM from the Folio monorepo's Studio palette.
   ------------------------------------------------------------------------------------------
   Source: C:\Repos\Origami Folio\origami\packages\studio-core\src\lib\palette.ts (read-only
   reference). These are the rail's "+ Roadmap" / "+ Flowchart" / "+ Ledger" buttons: each one
   gives a free card pre-seeded with one data block. `dataFigure` and every *FoldInner builder
   below are copied from that file, not re-authored, so a fold this app starts and one the
   Studio starts are the same bytes — same discipline as starters.ts.

   They also make the guide's own advice concrete. Every data kind's schema says "a Flowchart
   fold is a free card holding one", and the catalog now steers that way (kinds.<k>.howToAdd);
   these starters ARE that shape, seeded, so an agent can take the advice in one call instead of
   assembling the figure itself.

   The seeds (GANTT_STARTER, FLOW_STARTER, GRAPH_STARTER, DRAW_STARTER, VENN_STARTER,
   TABLE_STARTER) are copied field for field from the same file. */

/** palette.ts dataFigure — verbatim. JSON is pretty-printed at 2 spaces and every "<" is
    escaped as \u003c, which is the data block's carrier invariant.

    `style` is the ONE addition, and it carries what the Studio's own block-size grips write on
    this same figure: `--obw:<px>` / `--obh:<px>`. The runtime CSS reads them off the figure by
    inheritance (.o-graph-svg, .o-flow-svg, .o-venn-svg, .o-gantt-wrap, figure.o-tablefig /
    .o-table-wrap). An empty `style` emits NO attribute, so a figure with no size named is
    byte-identical to the palette's. */
/* Exported so the mini tools' block writers build the SAME figure the Studio's rail does —
   there is one figure builder in this app, not one per page. */
export function dataFigure(kind: string, figClass: string, mountClass: string, seed: unknown, caption: string, style = ''): string {
  return `<figure class="${figClass} anim"${style ? ` style="${style}"` : ''}><script type="application/json" data-odata="${kind}">
${blockJson(seed)}
</script><div class="${mountClass}" data-${kind}-mount></div><figcaption>${caption}</figcaption></figure>`;
}

/** A data block's JSON exactly as dataFigure writes it: pretty-printed at 2 spaces with every
    "<" escaped (the carrier invariant). Exported so a tool that rewrites a block which is NOT
    wrapped in a figure — the table starter's .o-table-shell is one — writes the same bytes. */
export const blockJson = (seed: unknown): string => JSON.stringify(seed, null, 2).replace(/</g, '\\u003c');

/* ---------- seeds, verbatim from palette.ts ---------- */

const GANTT_STARTER = {
  totalWeeks: 16,
  startDate: null,
  lenses: [
    { name: 'Plan', color: '#4a8cc4' },
    { name: 'Design', color: '#9333ea' },
    { name: 'Build', color: '#d9a520' },
    { name: 'Launch', color: '#3d8b5a' },
    { name: 'Risk', color: '#c64a4a' },
  ],
  swimlanes: [
    { name: 'Workstream A', owner: 'Owner' },
    { name: 'Workstream B', owner: 'Owner' },
  ],
  cards: [
    { id: 'C01', title: 'Discovery & scoping', swimlane: 'Workstream A', start: 'W1', durationWeeks: 2, lens: 'Plan', type: 'Process', effort: 'EASY', what: 'Example card — click to edit any field, drag to move, drag the right edge to resize.', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
    { id: 'C02', title: 'Design & sign-off', swimlane: 'Workstream A', start: 'W3', durationWeeks: 2, lens: 'Design', type: 'Process', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
    { id: 'C03', title: 'Build phase', swimlane: 'Workstream A', start: 'W5', durationWeeks: 4, lens: 'Build', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
    { id: 'C04', title: 'Integration & testing', swimlane: 'Workstream B', start: 'W6', durationWeeks: 3, lens: 'Build', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
    { id: 'C05', title: 'User acceptance', swimlane: 'Workstream B', start: 'W9', durationWeeks: 2, lens: 'Risk', type: 'Process', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
    { id: 'C06', title: 'Go-live', swimlane: 'Workstream B', start: 'W11', durationWeeks: 1, lens: 'Launch', type: 'Process', effort: 'EASY', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
  ],
  milestones: [
    { label: 'Go / No-Go', week: 7, color: '#d9a520' },
    { label: 'Go-live', week: 11, color: '#3d8b5a' },
  ],
};

const FLOW_STARTER = {
  nodes: [
    { id: 'start', label: 'Kick-off', shape: 'pill', tone: 'accent' },
    { id: 'build', label: 'Build the thing', shape: 'box', tone: '' },
    { id: 'check', label: 'Does it pass?', shape: 'diamond', tone: 'amber' },
    { id: 'ship', label: 'Ship it', shape: 'pill', tone: 'green' },
    { id: 'fix', label: 'Fix and retry', shape: 'box', tone: 'red' },
  ],
  edges: [
    { from: 'start', to: 'build', label: '' },
    { from: 'build', to: 'check', label: '' },
    { from: 'check', to: 'ship', label: 'yes' },
    { from: 'check', to: 'fix', label: 'no' },
  ],
};

const GRAPH_STARTER = {
  nodes: [
    { id: 'core', label: 'The idea', x: 50, y: 38, tone: 'accent' },
    { id: 'a', label: 'Workstream A', x: 22, y: 16, tone: '' },
    { id: 'b', label: 'Workstream B', x: 78, y: 16, tone: '' },
    { id: 'c', label: 'Dependency', x: 28, y: 68, tone: 'amber' },
    { id: 'd', label: 'Stakeholders', x: 73, y: 70, tone: 'green' },
  ],
  edges: [
    { from: 'core', to: 'a', label: '' },
    { from: 'core', to: 'b', label: '' },
    { from: 'core', to: 'c', label: 'blocks' },
    { from: 'core', to: 'd', label: '' },
  ],
};

/** The canvas is FIXED at 800x450 scene units (palette.ts: a content-refitting canvas
    rebounded while drawing). Every element sits inside it. */
const DRAW_STARTER = {
  w: 800,
  h: 450,
  elements: [
    { id: 'd-box', type: 'rect', x: 50, y: 80, width: 190, height: 95, stroke: '#333333', fill: '#F2C94C', fillStyle: 'hachure', strokeWidth: 2, roughness: 1, seed: 11 },
    { id: 'd-label', type: 'text', x: 80, y: 114, width: 130, height: 26, stroke: '#333333', text: 'Sketch it', fontSize: 20, font: 'inter', textAlign: 'center', seed: 12 },
    { id: 'd-arrow', type: 'arrow', x: 252, y: 127, width: 130, height: 0, points: [[0, 0], [130, 0]], stroke: '#B3402A', strokeWidth: 2, roughness: 1, seed: 13 },
    { id: 'd-cloud', type: 'ellipse', x: 400, y: 62, width: 170, height: 112, stroke: '#3D8B5A', fill: '#6FCF97', fillStyle: 'cross', strokeWidth: 2, roughness: 2, seed: 14 },
    { id: 'd-note', type: 'text', x: 435, y: 106, width: 100, height: 24, stroke: '#2F4A6B', text: 'any idea', fontSize: 18, font: 'lora', textAlign: 'center', seed: 15 },
    { id: 'd-diamond', type: 'diamond', x: 420, y: 240, width: 140, height: 100, stroke: '#333333', fill: '', strokeWidth: 2, roughness: 1, seed: 17 },
  ],
};

const VENN_STARTER = {
  count: 2,
  sets: [
    { label: 'Us', color: '#4A8CC4' },
    { label: 'Them', color: '#D9A520' },
  ],
};

const TABLE_STARTER = {
  columns: [{ label: '' }, { label: '' }, { label: '' }, { label: '' }],
  rows: [
    ['', '', '', ''],
    ['', '', '', ''],
    ['', '', '', ''],
    ['', '', '', ''],
    ['', '', '', ''],
  ],
};

/* ---------- the fold builders, verbatim from palette.ts ---------- */

const ganttFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Roadmap</p>
    <h2 class="anim" style="--i:1">Critical path</h2>
    ${dataFigure('gantt', 'o-ganttfig', 'o-gantt', GANTT_STARTER, 'Roadmap')}
  </div>
`;

const flowFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Process</p>
    <h2 class="anim" style="--i:1">Flowchart</h2>
    ${dataFigure('flow', 'o-flowfig', 'o-flow', FLOW_STARTER, 'Flowchart')}
  </div>
`;

/**
 * MEASURED, not chosen: the block height (CSS px) a composed GRAPH gets when it names none.
 *
 * A default, unedited node graph OVERFLOWS a 720px screen before an author has typed anything.
 * Read at 1280x720 through the real render (tools/agent-bridge.mjs, 2026-09-03), a card of
 * eyebrow + h2 + graph + figcaption and nothing else:
 *
 *     --obh   (none)  600  500  450  400  380  360  340  320  300  280 and below
 *     card     875    956  856  806  756  736  716  696  676  656  654 (flat)
 *
 * The slope is exactly 1.0 px per unit down to ~290, where the CARD hits its own floor of 654px
 * and a smaller graph buys no height at all. 320 leaves the card at 676px — 44px inside the
 * screen, next to the 46px the chart default keeps — while the diagram stays large enough that
 * inspect_render reports no label collisions (checked at 320, 220 and 200: none at any).
 *
 * A graph that names its own `height` is obeyed and none of this applies. Flow, whose CSS is the
 * same shape (.o-flow-svg), needs NO default: the same run measured a composed flow card and the
 * flowchart starter at 660px each, both already inside 720.
 */
export const GRAPH_FIT_HEIGHT = 320;

/** The graph's floor, the counterpart of MIN_PLOT_HEIGHT. MEASURED on the same run: one lede
    paragraph costs a graph card 106-107px (875 -> 981 with no --obh; 716 -> 823 at --obh 360),
    the same PROSE_COST a chart pays, so prose on the card comes off the graph too. The floor
    itself is a JUDGEMENT sitting on one measurement — inspect_render found no label collision at
    200 — and it is where a diagram stops being worth drawing rather than a number the render
    forces. A card that still will not fit at 200 is overfull, and saying so is inspect_render's
    job, not the composer's. */
export const MIN_GRAPH_HEIGHT = 200;

/* The ONE starter that diverges from palette.ts, and only by its block SIZE. Measured at
   1280x720 (tools/agent-bridge.mjs, 2026-09-03): this starter renders a 875px card against
   720px of screen — an overflow the agent gets before it has edited anything. --obh
   GRAPH_FIT_HEIGHT brings the same card to 676px. The seed, the classes and the caption are
   still palette.ts verbatim. */
const graphFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Map</p>
    <h2 class="anim" style="--i:1">Node graph</h2>
    ${dataFigure('graph', 'o-graphfig', 'o-graph', GRAPH_STARTER, 'Node graph', `--obh:${GRAPH_FIT_HEIGHT}px`)}
  </div>
`;

const drawFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Sketch</p>
    <h2 class="anim" style="--i:1">Drawing</h2>
    ${dataFigure('draw', 'o-drawfig', 'o-draw', DRAW_STARTER, 'Drawing')}
  </div>
`;

const vennFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Overlap</p>
    <h2 class="anim" style="--i:1">Venn diagram</h2>
    ${dataFigure('venn', 'o-vennfig', 'o-venn', VENN_STARTER, 'Venn diagram')}
  </div>
`;

const ledgerFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Ledger</p>
    <h2 class="anim" style="--i:1">Ledger</h2>
    ${dataFigure('table', 'o-tablefig', 'o-table', TABLE_STARTER, 'Ledger table')}
  </div>
`;

export interface FoldStarter {
  key: string;
  /** The name the Studio's own rail button uses. */
  name: string;
  /** The data block the card is seeded with. */
  block: string;
  /** Default sidebar label. */
  label: string;
  /** When an agent should reach for it. */
  use: string;
  inner: () => string;
}

/** Every starter is a FREE card holding one block — the shape each kind's schema recommends. */
export const FOLD_STARTERS: FoldStarter[] = [
  { key: 'roadmap', name: 'Roadmap', block: 'gantt', label: 'Roadmap', use: 'A project plan over weeks: swimlanes, lensed cards and milestones, seeded with a 16-week example.', inner: ganttFoldInner },
  { key: 'flowchart', name: 'Flowchart', block: 'flow', label: 'Flowchart', use: 'A process with a decision in it. Auto-laid-out left to right; seeded with a build/check/ship loop.', inner: flowFoldInner },
  { key: 'node-graph', name: 'Node graph', block: 'graph', label: 'Node graph', use: 'A hub-and-spoke map of things and how they relate. Node positions are explicit percentages.', inner: graphFoldInner },
  { key: 'drawing', name: 'Drawing', block: 'draw', label: 'Drawing', use: 'A hand-drawn sketch on a fixed 800x450 canvas — boxes, arrows and text with a seeded jitter.', inner: drawFoldInner },
  { key: 'venn', name: 'Venn diagram', block: 'venn', label: 'Venn diagram', use: 'Two or three overlapping sets. Seeded with two circles; add a third by raising count and sets.', inner: vennFoldInner },
  { key: 'ledger', name: 'Ledger', block: 'table', label: 'Ledger', use: 'A live spreadsheet block. Seeded EMPTY (4 columns x 5 blank rows) — fill the cells and add formulas, which are baked by the calc engine on write.', inner: ledgerFoldInner },
];

export const findStarter = (key: string): FoldStarter | undefined => FOLD_STARTERS.find((s) => s.key === key);

/** Catalog for list_starters and the guide — everything except the markup itself. */
export const starterCatalog = (): Array<Record<string, unknown>> =>
  FOLD_STARTERS.map((s) => ({ starter: s.key, name: s.name, block: s.block, label: s.label, use: s.use }));
