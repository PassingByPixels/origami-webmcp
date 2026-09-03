/**
 * THE RECORDED RUN — the ordered tool calls that build the demo Fold, and the deck content
 * they carry. Plain data: no DOM, no imports, nothing browser-only.
 *
 * ONE source, TWO drivers, no twin to keep in step:
 *   - the landing's "Watch an agent build a deck" replays it through
 *     `registry.invoke(tool, args, 'replay')` (src/app/main.ts);
 *   - `npm run demo` (demo/author-demo.mjs) plays the SAME list through Chrome's own WebMCP
 *     surface, in a real headed browser, and writes the finished Fold to disk.
 * Node imports this .ts file directly (type stripping, measured on node v24.14.0), so keep
 * every type here erasable: no enum, no namespace, no parameter properties, no decorators.
 *
 * The list starts at create_deck and ENDS BEFORE save_deck. The replay must not start a
 * download nobody asked for; the demo adds its own onboarding reads and its own save.
 */

export interface DemoCall {
  tool: string;
  args: Record<string, unknown>;
  /** One line for the demo's transcript. The replay ignores it — the rail writes its own. */
  note: string;
}

/* ---------- ids that do not exist until the run mints them ----------
   A static list cannot know the chunk id create_deck will hand back, so a call NAMES one and
   the runner fills it in. Two references, both minted by a call earlier in this same list. */

/** The cover fold create_deck minted — the chunk the demo edits and then proposes against. */
export const COVER_REF = '@cover';
/** The proposal propose_chunk staged, for the accept_proposal that follows it. */
export const PROPOSAL_REF = '@proposal';

/** Replace any `@ref` argument with the id the run has learned for it. */
export function bindRefs(args: Record<string, unknown>, refs: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' && value.startsWith('@') && refs[value] !== undefined ? refs[value] : value;
  }
  return out;
}

/** Learn the ids one finished call minted, for the calls after it. `body` is the tool's JSON. */
export function learnRefs(tool: string, body: unknown, refs: Record<string, string>): void {
  const b = (body ?? {}) as { chunks?: Array<{ id?: string }>; proposalId?: string };
  if (tool === 'create_deck' && typeof b.chunks?.[0]?.id === 'string') refs[COVER_REF] = b.chunks[0].id;
  if (tool === 'propose_chunk' && typeof b.proposalId === 'string') refs[PROPOSAL_REF] = b.proposalId;
}

/* ---------------------------------------------------------------- deck content ---------- */

const dataBlock = (kind: string, data: unknown): string =>
  `<script type="application/json" data-odata="${kind}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/* "39" is the registered tool count this page reports (tests/e2e/app.spec.ts asserts it). It is
   a literal because the cover is authored markup, not a template — if the surface grows, this
   number and that assertion move together. */
const COVER = `<div class="slide-inner">
  <p class="eyebrow">Origami · authored over WebMCP</p>
  <h1>An agent made this Fold. In your browser.</h1>
  <p class="lede">Nothing was uploaded and no server saw it. A model called tools this page had registered, and the deck assembled itself while you watched — ending as one file you can email to anyone.</p>
  <div class="card-grid">
    <div class="stat-card"><div class="big">39</div><div class="lbl">Tools on the page</div></div>
    <div class="stat-card"><div class="big">1</div><div class="lbl">File when it lands</div></div>
    <div class="stat-card"><div class="big">0</div><div class="lbl">Servers involved</div></div>
  </div>
</div>`;

/* Labels chosen to exercise the 0.4.3 wrap work: two multi-word labels that must break at a
   space, and one long unbreakable word that must SHRINK rather than be cut in half. */
const VENN = `<figure class="o-vennfig anim">${dataBlock('venn', {
  count: 3,
  sets: [
    { label: 'Human authored', color: '#557A4E' },
    { label: 'Agent authored', color: '#4a8cc4' },
    { label: 'Interoperability', color: '#d9a520' },
  ],
  overlaps: [
    { sets: [0, 1], label: 'Reviewed together', x: 50, y: 33 },
    { sets: [0, 1, 2], label: 'An open Fold', x: 50, y: 55 },
  ],
})}<div class="o-venn" data-venn-mount></div><figcaption>Where an agent-written document has to land to be worth anything.</figcaption></figure>`;

/* A recognisable sketch: notes -> fold -> one file, with a hand-drawn underline.
   Fixed seeds so the jitter is identical on every open. */
const DRAW = `<figure class="o-drawfig anim">${dataBlock('draw', {
  elements: [
    { id: 'd1', name: 'source box', type: 'rect', x: 30, y: 70, width: 200, height: 92, stroke: '#1A1A1A', fill: '', roughness: 1, strokeWidth: 2, seed: 11117 },
    { id: 'd2', name: 'source label', type: 'text', x: 60, y: 105, width: 150, height: 28, stroke: '#1A1A1A', text: 'Your notes', fontSize: 22, font: 'caveat', seed: 11118 },
    { id: 'd3', name: 'arrow one', type: 'arrow', x: 240, y: 116, width: 76, height: 0, stroke: '#1A1A1A', strokeWidth: 2, points: [[0, 0], [76, 0]], roughness: 1, seed: 11119, attach: { from: 'd1', to: 'd4' } },
    { id: 'd4', name: 'fold diamond', type: 'diamond', x: 326, y: 56, width: 190, height: 120, stroke: '#557A4E', fill: '#557A4E', fillStyle: 'hachure', roughness: 1, strokeWidth: 2, opacity: 90, seed: 11120 },
    { id: 'd5', name: 'fold label', type: 'text', x: 372, y: 104, width: 120, height: 28, stroke: '#1A1A1A', text: 'Fold it', fontSize: 22, font: 'caveat', seed: 11121 },
    { id: 'd6', name: 'arrow two', type: 'arrow', x: 526, y: 116, width: 76, height: 0, stroke: '#1A1A1A', strokeWidth: 2, points: [[0, 0], [76, 0]], roughness: 1, seed: 11122, attach: { from: 'd4', to: 'd7' } },
    { id: 'd7', name: 'result ellipse', type: 'ellipse', x: 612, y: 70, width: 210, height: 92, stroke: '#1A1A1A', fill: '', roughness: 1, strokeWidth: 2, seed: 11123 },
    { id: 'd8', name: 'result label', type: 'text', x: 648, y: 105, width: 150, height: 28, stroke: '#1A1A1A', text: 'One file', fontSize: 22, font: 'caveat', seed: 11124 },
    { id: 'd9', name: 'underline', type: 'freedraw', x: 620, y: 178, width: 196, height: 12, stroke: '#557A4E', strokeWidth: 3, roughness: 1, seed: 11125,
      points: [[0, 0], [28, 6], [58, 1], [92, 8], [124, 2], [158, 7], [196, 2]] },
    { id: 'd10', name: 'aside', type: 'text', x: 30, y: 220, width: 500, height: 24, stroke: '#5A554D', text: 'no build step, no runtime to install', fontSize: 18, font: 'caveat', seed: 11126 },
  ],
})}<div class="o-draw" data-draw-mount></div><figcaption>The whole pitch, drawn badly on purpose.</figcaption></figure>`;

/* Authored as a FREE card holding a flow block, which is what the kind's own schema recommends
   ("a Flowchart fold is a free card holding one"). A `flow`-KIND fold lays out with
   justify-content:flex-start and no masthead offset, so a 2-lane diagram's top ~74px hides
   behind the 100px header bar. A free card centres normally. */
const FLOW = `<div class="slide-inner">
  <p class="eyebrow">The loop</p>
  <h2>Who does what</h2>
  <figure class="o-flowfig anim">${dataBlock('flow', {
  lanes: [
    { id: 'agent', label: 'Agent', order: 0, color: '#557A4E' },
    { id: 'human', label: 'Human', order: 1, color: '#4a8cc4' },
  ],
  nodes: [
    { id: 'draft', label: 'Draft the fold', shape: 'box', tone: '', lane: 'agent' },
    { id: 'propose', label: 'Propose the edit', shape: 'box', tone: 'accent', lane: 'agent' },
    { id: 'read', label: 'Read the card', shape: 'diamond', tone: '', lane: 'human' },
    { id: 'accept', label: 'Accept', shape: 'pill', tone: 'green', lane: 'human' },
    { id: 'save', label: 'Save the file', shape: 'pill', tone: 'green', lane: 'human' },
  ],
  edges: [
    { from: 'draft', to: 'propose', label: 'ready' },
    { from: 'propose', to: 'read', label: 'staged' },
    { from: 'read', to: 'accept', label: 'looks right' },
    { from: 'accept', to: 'save', label: 'done' },
  ],
})}<div class="o-flow" data-flow-mount></div><figcaption>Two lanes, because the human half is not optional — it is just not mandatory.</figcaption></figure>
</div>`;

/** Charts the calls this very script makes, per fold. Real numbers, counted below — not decoration. */
const chartCard = (labels: string[], values: number[]): string => `<div class="slide-inner">
  <p class="eyebrow">Measured, not decorative</p>
  <h2>What it cost to write the folds above</h2>
  <figure class="o-chartfig anim">${dataBlock('chart', {
    type: 'bar',
    labels,
    series: [{ name: 'Tool calls', color: '#557A4E', values }],
    yMax: null,
    showValues: true,
    yTitle: 'calls',
  })}<div class="o-chart" data-chart-mount></div><figcaption>Counted off the recorded call list itself, then written into this fold before you saw it.</figcaption></figure>
</div>`;

const SCROLL_DOC = `<div class="slide-inner o-doc">
  <header class="o-doc-masthead">
    <h1>Notes on a portable document</h1>
    <p class="o-doc-byline">Written by an agent · over WebMCP · one sitting</p>
  </header>
  <nav class="o-toc" data-toc-mount></nav>

  <h2>Why one file still matters</h2>
  <p>A document that needs a server is a document with an expiry date. The link rots, the account lapses, the vendor pivots, and the reader is left with a screenshot. A Fold takes the opposite bet: the renderer travels inside the file, so the only dependency is a browser.</p>

  <div class="o-tcols" data-ocols="2">
    <div class="o-text">
      <p>That constraint is what makes the format worth an agent's time. There is no API to keep in step and no schema living on someone else's machine — the contract is the file, and the file is right here.</p>
      <p>It also means review is local. Nothing leaves the tab until a human decides it should.</p>
    </div>
    <div class="o-text">
      <p>The cost is discipline. Everything inside a Fold has to be inert by default: no fetches, no remote fonts, no scripts that reach for the network. Active content is allowed, but it puts the deck behind a padlock until the reader trusts the sender.</p>
      <p>Most documents never need to cross that line.</p>
    </div>
  </div>

  <h2>What the agent actually did</h2>
  <p>It called tools this page had registered on Chrome's own WebMCP surface.<span class="o-footnote">Twenty-nine tools are registered; the folds above were built with eight of them.</span> Each call changed an in-memory model and re-rendered the deck; not one of them touched the disk.</p>

  <div class="o-callout" data-otone="accent">
    <p>The last step is the only one a human has to own: putting the bytes somewhere. An agent can ask, but it cannot reach past the browser's file picker — and that is the correct place for the boundary.</p>
  </div>

  <h2>Three things this fold proves</h2>
  <div class="o-tcols" data-ocols="3">
    <div class="o-text"><p><strong>Structure survives.</strong> Headings, columns and callouts come back as themselves, not as a flattened screenshot.</p></div>
    <div class="o-text"><p><strong>Drawing survives.</strong> The sketch a few folds back is vector, seeded, and identical on every open.</p></div>
    <div class="o-text"><p><strong>Review survives.</strong> The edit to the cover went through a proposal card before it landed.</p></div>
  </div>
</div>`;

const PROPOSED_COVER = COVER.replace(
  'Nothing was uploaded and no server saw it. A model called tools this page had registered, and the deck assembled itself while you watched — ending as one file you can email to anyone.',
  'Nothing was uploaded. No server saw it. A model called the tools this page registered, and the deck built itself while you watched — ending as one file you can email to anyone.'
);

/* Fold labels are named once and used twice — in the calls, and in the cost count below — so
   the chart cannot drift from the folds it is counting. */
const VENN_LABEL = 'Where it lands';
const DRAW_LABEL = 'The pitch, sketched';
const FLOW_LABEL = 'Who does what';

/* ---------------------------------------------------------------- the calls ------------- */

/** Everything up to the accepted proposal — the folds the chart then counts. */
const BUILD: DemoCall[] = [
  { tool: 'create_deck', args: { title: 'A Fold, Written by an Agent', foldType: 'deck', discard: true }, note: 'mint a blank Fold' },
  {
    tool: 'set_header',
    args: { subtitle: 'Authored live over WebMCP — no server, no upload, no install', chips: ['WebMCP', 'One file', 'Inert by default'] },
    note: 'set the masthead',
  },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: COVER }, note: 'write the cover' },
  { tool: 'add_chunk', args: { kind: 'venn', html: VENN, label: VENN_LABEL }, note: 'add the venn card' },
  { tool: 'add_chunk', args: { kind: 'draw', html: DRAW, label: DRAW_LABEL }, note: 'add the draw card' },
  { tool: 'add_chunk', args: { kind: 'free', html: FLOW, label: FLOW_LABEL }, note: 'add the two-lane flow' },
  {
    tool: 'propose_chunk',
    args: {
      chunkId: COVER_REF,
      html: PROPOSED_COVER,
      title: 'Tighten the cover lede',
      prompt: 'Two short sentences read better than one long one',
      author: 'agent:demo',
    },
    note: 'PROPOSE a cover edit (not applied)',
  },
  { tool: 'list_proposals', args: {}, note: 'read the review queue' },
  { tool: 'accept_proposal', args: { proposalId: PROPOSAL_REF }, note: 'ACCEPT it — the same path the human button takes' },
];

/**
 * Calls attributable to each fold, counted off the list that actually makes them.
 *
 * It used to count a LIVE transcript, which could only be done by the demo driver and included
 * that driver's onboarding reads. Counting the recorded list gives the same kind of number —
 * real calls, not a plausible-looking guess — and gives the replay and the demo the same chart.
 */
function foldCosts(calls: readonly DemoCall[]): { labels: string[]; values: number[] } {
  const count = (pred: (c: DemoCall) => boolean): number => calls.filter(pred).length;
  const labelled = (label: string) => (c: DemoCall) => c.args.label === label;
  return {
    labels: ['Cover', 'Venn', 'Draw', 'Flow', 'Review'],
    values: [
      count((c) => c.tool === 'set_header' || c.tool === 'write_chunk'),
      count(labelled(VENN_LABEL)),
      count(labelled(DRAW_LABEL)),
      count(labelled(FLOW_LABEL)),
      count((c) => c.tool.startsWith('propose_') || c.tool === 'list_proposals' || c.tool === 'accept_proposal'),
    ],
  };
}

const COSTS = foldCosts(BUILD);

/** The whole recorded run: create_deck first, no save_deck last. */
export const DEMO_CALLS: DemoCall[] = [
  ...BUILD,
  { tool: 'add_chunk', args: { kind: 'free', html: chartCard(COSTS.labels, COSTS.values), label: 'What it cost' }, note: "add the chart, from this list's own call counts" },
  { tool: 'add_chunk', args: { kind: 'document', html: SCROLL_DOC, label: 'The long read' }, note: 'add the multi-column scroll fold' },
  { tool: 'list_chunks', args: {}, note: 'confirm the table of contents' },
];

/** How many folds DEMO_CALLS leaves behind — the cover plus every add_chunk. */
export const DEMO_FOLDS = 1 + DEMO_CALLS.filter((c) => c.tool === 'add_chunk').length;

/**
 * What a model meeting Origami for the first time reads before it writes anything.
 * The DEMO driver plays these first; the replay does not — the landing button's promise is
 * "watch an agent build a deck", and a 15 KB guide fetch builds nothing.
 */
export const DEMO_ONBOARDING: DemoCall[] = [
  { tool: 'origami_guide', args: {}, note: 'read the whole format contract' },
  { tool: 'get_kind_schema', args: { kind: 'venn' }, note: 'learn the venn markup' },
  { tool: 'get_kind_schema', args: { kind: 'draw' }, note: 'learn the draw markup' },
];
