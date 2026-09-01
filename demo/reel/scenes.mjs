/**
 * THE REEL'S CONTENT — every tool call the demo reel makes, and the markup it carries.
 *
 * Plain data. Written to the scene plan at
 * `Cortex/projects/Origami Folio/Upgrade Ideas/MCP upgrade/demo-reel-plan.md`.
 *
 * A SIBLING of src/app/demo-script.ts, deliberately not a reuse of it: the landing replay is a
 * shipped surface with its own tests, and a reel that re-cuts its pacing must not be able to move
 * it. Same shapes (a tool, args, a note), same `@ref` idea, its own list.
 *
 * PACING IS NOT HERE. Every call is paced by the driver off a settled preview repaint plus one
 * short beat, so no list in this file carries a sleep.
 */
import { IMAGE_DATA_URI, IMAGE_SIZE } from './paper-image.mjs';

/* ---------------------------------------------------------------- helpers ---------------- */

/** A data block, carrier invariant included: every "<" inside the JSON is escaped. */
const dataBlock = (kind, data) =>
  `<script type="application/json" data-odata="${kind}">${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}</script>`;

const figure = (kind, figClass, mountClass, data, caption) =>
  `<figure class="${figClass} anim">${dataBlock(kind, data)}<div class="${mountClass}" data-${kind}-mount></div><figcaption>${caption}</figcaption></figure>`;

export const COVER_REF = '@cover';

export function bindRefs(args, refs) {
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'string' && v.startsWith('@') && refs[v] !== undefined ? refs[v] : v;
  return out;
}

export function learnRefs(tool, body, refs) {
  if (tool === 'create_deck' && typeof body?.chunks?.[0]?.id === 'string') refs[COVER_REF] = body.chunks[0].id;
  if (tool === 'add_chunk' && typeof body?.chunkId === 'string') refs['@last'] = body.chunkId;
  // a mini page registers no list_chunks; inspect_render is where its one fold's id comes from
  if (tool === 'inspect_render' && typeof body?.folds?.[0]?.id === 'string') refs['@doc'] = body.folds[0].id;
}

/* ---------------------------------------------------------------- brand ------------------ */

const GREEN = '#557A4E';
const COPPER = '#8A4522';
const BLUE = '#4A8CC4';
const GOLD = '#D9A520';
const SLATE = '#2F4A6B';

/**
 * The copper palette the theme flip swaps in. NOT one token: the plan calls the restyle "the
 * single most visible tool", and an accent-only patch moves a few hairlines nobody can see at
 * 1080p. Ground, paper, rules and the masthead all travel together. The way BACK is not written
 * here — the driver captures the deck's own token set before the flip and restores exactly that,
 * so the green half of the flip is the deck's real palette rather than a guess at it.
 */
export const COPPER_THEME = {
  accent: COPPER,
  bg: '#F6ECE1',
  paper: '#FFF9F2',
  rule: '#E4CDB6',
  'rule-soft': '#EFDECC',
  'tint-a': '#F3E2D0',
  'tint-b': '#E7CBB0',
  chrome: '#7A3D1E',
  'chrome-ink': '#FFF3E6',
  'chrome-mark': '#F0C49A',
};

/* ================================================================ ACT 1 =================== */

const ACT1_COVER = `<div class="slide-inner">
  <p class="eyebrow">origami.gratis &middot; live over WebMCP</p>
  <h1>An agent is building this deck right now.</h1>
  <p class="lede">Every fold after this one arrives from a tool call this page registered with the browser. Nothing is uploaded, no server is involved, and the whole thing ends as one file you can email to anyone.</p>
  <div class="card-grid">
    <div class="stat-card"><div class="big">29</div><div class="lbl">Tools on the page</div></div>
    <div class="stat-card"><div class="big">1</div><div class="lbl">File when it lands</div></div>
    <div class="stat-card"><div class="big">0</div><div class="lbl">Servers involved</div></div>
  </div>
</div>`;

const ACT1_VENN = `<div class="slide-inner">
  <p class="eyebrow">One surface, two authors</p>
  <h2>Who writes the document</h2>
  ${figure(
    'venn',
    'o-vennfig',
    'o-venn',
    {
      count: 2,
      sets: [
        { label: 'Human authored', color: GREEN },
        { label: 'Agent authored', color: BLUE },
      ],
      overlaps: [{ sets: [0, 1], label: 'An open Fold', x: 50, y: 52 }],
    },
    'Neither half is optional. The file is where they meet.'
  )}
</div>`;

/* A FREE card holding the flow block, which is the shape the kind's own schema recommends: a
   `flow`-KIND fold lays out with no masthead offset and hides a two-lane diagram's top behind the
   header bar. `add_chunk starter:flowchart` already mints a free card, so the write matches it. */
const ACT1_FLOW = `<div class="slide-inner">
  <p class="eyebrow">The loop</p>
  <h2>How a fold gets made</h2>
  ${figure(
    'flow',
    'o-flowfig',
    'o-flow',
    {
      lanes: [
        { id: 'agent', label: 'Agent', order: 0, color: GREEN },
        { id: 'human', label: 'Human', order: 1, color: BLUE },
      ],
      nodes: [
        { id: 'read', label: 'Read the fold', shape: 'box', tone: '', lane: 'agent' },
        { id: 'draft', label: 'Draft the edit', shape: 'box', tone: 'accent', lane: 'agent' },
        { id: 'stage', label: 'Propose it', shape: 'pill', tone: 'accent', lane: 'agent' },
        { id: 'review', label: 'Worth keeping?', shape: 'diamond', tone: 'amber', lane: 'human' },
        { id: 'accept', label: 'Accept', shape: 'pill', tone: 'green', lane: 'human' },
        { id: 'save', label: 'Save one file', shape: 'pill', tone: 'green', lane: 'human' },
      ],
      edges: [
        { from: 'read', to: 'draft', label: '' },
        { from: 'draft', to: 'stage', label: 'ready' },
        { from: 'stage', to: 'review', label: 'staged' },
        { from: 'review', to: 'accept', label: 'yes' },
        { from: 'accept', to: 'save', label: '' },
      ],
    },
    'Two lanes, because the human half is not optional — it is just not mandatory.'
  )}
</div>`;


/* The only fold in the reel placed with add_custom_fold — a whole page handed over in one call,
   which is the tool's own pitch. It summarises the act rather than restating the cover. */
const ACT1_SUMMARY = `<div class="slide-inner">
  <p class="eyebrow">Twelve calls, four folds, no server</p>
  <h2>What just happened</h2>
  <ul>
    <li>A blank Fold was minted inside the tab and never left it.</li>
    <li>The whole theme was swapped to copper and back while you watched.</li>
    <li>A venn, a flowchart and a roadmap were placed, filled in and reordered.</li>
    <li>The layout was measured in a real render before anything was saved.</li>
  </ul>
</div>`;

/** Act 1: the presentation. The driver paces it; the theme flip is calls 4 and 5. */
export const ACT1 = [
  { tool: 'create_deck', args: { title: 'Origami — the pitch, folded by an agent', foldType: 'deck', discard: true }, note: 'mint a blank Fold' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: ACT1_COVER }, note: 'write the cover' },
  { tool: 'set_header', args: { subtitle: 'Authored live over WebMCP — no server, no upload, no install', chips: ['WebMCP', 'One file', 'Inert by default'] }, note: 'set the masthead' },
  { tool: '@theme-copper', args: {}, note: 'THEME FLIP — the whole deck restyles' },
  { tool: '@theme-green', args: {}, note: 'and back again' },
  { tool: 'list_starters', args: {}, note: 'what ready-made folds are there?' },
  { tool: 'add_chunk', args: { starter: 'venn', label: 'Who writes it' }, note: 'drop in the venn starter' },
  { tool: 'write_chunk', args: { chunkId: '@last', html: ACT1_VENN }, note: 'give it the real sets' },
  { tool: 'add_chunk', args: { starter: 'flowchart', label: 'How it gets made' }, note: 'a FLOWCHART starter' },
  { tool: 'write_chunk', args: { chunkId: '@last', html: ACT1_FLOW }, note: 'two lanes, six nodes, real edges' },
  { tool: 'add_chunk', args: { starter: 'roadmap', label: 'What comes next' }, note: 'the site roadmap' },
  { tool: 'move_chunk', args: { chunkId: '@last', position: 2 }, note: 'move it AHEAD of the flowchart' },
  { tool: 'add_custom_fold', args: { html: ACT1_SUMMARY, label: 'What just happened' }, note: 'a whole page in ONE call' },
  { tool: 'inspect_render', args: {}, note: 'measure the layout in the real renderer' },
  { tool: 'save_deck', args: {}, note: 'save' },
];

/* ================================================================ ACT 2 =================== */
/**
 * The same blocks, in a completely different shape.
 *
 * ONE document fold, grown by five successive write_chunk calls. One and not two on purpose: the
 * app follows an agent's write by taking the reader to the fold it touched (src/app/shell.ts:281),
 * so a second fold would yank the camera down mid-build and then need an upward move to get back.
 * With a single fold every write keeps the reader parked at the top, and the camera makes exactly
 * one pass — downward, continuous, after the document is finished.
 */

const DOC_HEAD = `<header class="o-doc-masthead">
    <h1>The same blocks, unrolled</h1>
    <p class="o-doc-byline">Written by an agent &middot; over WebMCP &middot; one sitting</p>
  </header>

  <h2>What a Fold actually is</h2>
  <p>A Fold is one <code>.origami.html</code> file that carries its own renderer. Open it and it plays: no install, no account, and no server deciding whether you may read your own document today.</p>
  <p>The slides an agent has just built were made of blocks. This is a document — a completely different reading experience — and it is made of the same ones. Nothing was converted, exported or redrawn on the way in.</p>

  <div class="o-tcols" data-ocols="2">
    <div class="o-text">
      <p>That constraint is what makes the format worth an agent's time. There is no API to keep in step and no schema living on someone else's machine. The contract is the file, and the file is right here.</p>
      <p>It also means review is local. Nothing leaves the tab until a human decides that it should.</p>
    </div>
    <div class="o-text">
      <p>The cost is discipline. Everything inside a Fold is inert by default: no fetches, no remote fonts, no scripts reaching for the network. Active content is allowed, but it puts the deck behind a padlock until the reader trusts the sender.</p>
      <p>Most documents never need to cross that line. This one does not.</p>
    </div>
  </div>`;

const DOC_LEDGER = `

  <h2>The books, mid-sentence</h2>
  <p>A spreadsheet block is not a picture of a spreadsheet. It keeps its columns, its alignment and its formulas, and it sits in the run of the prose the way any paragraph does.</p>
  ${figure(
    'table',
    'o-tablefig',
    'o-table',
    {
      columns: [{ label: 'Tool page' }, { label: 'Tools', align: 'right' }, { label: 'Block kinds', align: 'right' }, { label: 'Files it makes', align: 'right' }],
      rows: [
        ['Folio', '29', '9', '1'],
        ['Draw', '13', '1', '1'],
        ['Charts', '12', '2', '1'],
        ['Gantt', '11', '1', '1'],
        ['Total', '65', '13', '4'],
      ],
      formulas: { B5: '=SUM(B1:B4)', C5: '=SUM(C1:C4)', D5: '=SUM(D1:D4)' },
    },
    'The ledger block, reading as part of the argument rather than as an attachment.'
  )}
  <p>Four tool pages, sixty-five registered tools between them, and one file format underneath all of it. The totals in that last row were computed by a calculation engine running in this browser, and they travel as values — so a reader whose browser never runs a line of it still sees the right numbers.</p>`;

const DOC_GRAPH = `

  <h2>The map, mid-sentence</h2>
  <p>A node graph is the block for things that relate to each other with no running order. It lands in a document exactly as it lands on a slide.</p>
  ${figure(
    'graph',
    'o-graphfig',
    'o-graph',
    {
      nodes: [
        { id: 'file', label: 'One file', x: 50, y: 46, tone: 'accent' },
        { id: 'folio', label: 'Folio', x: 18, y: 16, tone: '' },
        { id: 'draw', label: 'Draw', x: 80, y: 18, tone: '' },
        { id: 'charts', label: 'Charts', x: 84, y: 74, tone: 'green' },
        { id: 'gantt', label: 'Gantt', x: 20, y: 76, tone: 'green' },
        { id: 'agent', label: 'Any agent', x: 50, y: 92, tone: 'amber' },
      ],
      edges: [
        { from: 'folio', to: 'file', label: 'writes' },
        { from: 'draw', to: 'file', label: '' },
        { from: 'charts', to: 'file', label: '' },
        { from: 'gantt', to: 'file', label: '' },
        { from: 'agent', to: 'file', label: 'over WebMCP' },
      ],
    },
    'Every tool on the site writes the same thing, and so does anything driving them.'
  )}
  <p>Positions are percentages, edges are named, and the whole diagram is a few hundred bytes of data the renderer draws on open. Resize the window and it lays out again; it is not a picture of a diagram.</p>`;

const DOC_IMAGE = `

  <h2>The picture, mid-sentence</h2>
  <p>An image travels inside the file as data, so a Fold has no broken pictures a year from now. There is nothing here to fetch and nothing to expire.</p>
  <figure class="o-figure anim">
    <img src="${IMAGE_DATA_URI}" alt="Three folded paper petals in green, copper and sage on a sheet of paper" width="${IMAGE_SIZE.width}" height="${IMAGE_SIZE.height}" style="max-width:100%;height:auto;display:block;margin:0 auto">
    <figcaption>Embedded as a data URI &mdash; inert by the format's own rules, so the deck stays unlocked.</figcaption>
  </figure>
  <p>The format's content policy is explicit about this: a <code>data:</code> URI is inert for a known image type, and active for anything else. That single rule is why a picture costs a Fold nothing in trust while an embedded script costs it the padlock.</p>`;

const DOC_CLOSE = `

  <h2>Why any of this matters</h2>
  <p>A document that needs a server is a document with an expiry date. The link rots, the account lapses, the vendor pivots, and the reader is left with a screenshot of something that used to work.</p>
  <div class="o-callout" data-otone="accent">
    <p>The venn, the flowchart, the ledger, the map, the picture, the sketch. They work on a slide, in a flowing document, or as a whole tool of their own — because there is one format underneath.</p>
  </div>
  <p>The last step is the only one a human has to own: putting the bytes somewhere. An agent can ask, but it cannot reach past the browser's file picker, and that is the correct place for the boundary.</p>
  <p>Everything above this line was written by a model calling tools the page had registered with the browser. No account was created, no upload happened, and the only thing that will outlive the tab is a file.</p>`;

const doc = (inner) => `<div class="slide-inner o-doc">${inner}\n</div>`;

/** Act 2: one fold, five growing revisions of it, then the camera makes its single pass. */
export const ACT2 = [
  { tool: 'create_deck', args: { title: 'The same blocks, unrolled', foldType: 'scroll', discard: true }, note: 'a SCROLL Fold this time' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: doc(DOC_HEAD) }, note: 'the opening prose' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: doc(DOC_HEAD + DOC_LEDGER) }, note: 'a LEDGER block, mid-prose' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: doc(DOC_HEAD + DOC_LEDGER + DOC_GRAPH) }, note: 'a NODE GRAPH block, mid-prose' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: doc(DOC_HEAD + DOC_LEDGER + DOC_GRAPH + DOC_IMAGE) }, note: 'an EMBEDDED IMAGE, mid-prose' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: doc(DOC_HEAD + DOC_LEDGER + DOC_GRAPH + DOC_IMAGE + DOC_CLOSE) }, note: 'the closing section' },
  { tool: 'inspect_render', args: {}, note: 'measure the whole document' },
  { tool: 'save_deck', args: {}, note: 'save' },
];

/* ================================================================ MINIS =================== */

const EMPTY_CANVAS = `<div class="slide-inner">
  <p class="eyebrow anim" style="--i:0">Sketch</p>
  <h2 class="anim" style="--i:1">Drawing</h2>
  ${figure('draw', 'o-drawfig', 'o-draw', { w: 800, h: 450, elements: [] }, 'Drawing')}
</div>`;

const el = (o) => ({ tool: 'add_element', args: o, note: `draw ${o.id}` });

export const DRAW_SCENE = [
  // inspect_render FIRST, and not for show: a mini page does not register list_chunks, so the
  // measurement report is the only route to the id of the one fold the page minted.
  { tool: 'inspect_render', args: {}, note: 'look at the canvas the page opened with' },
  { tool: 'write_chunk', args: { chunkId: '@doc', html: EMPTY_CANVAS }, note: 'clear the seeded sketch' },
  /* Shape THEN the arrow that lands on it: attach.to is validated against the scene as it
     stands, so an arrow drawn before its target is refused (measured — draw.element.attach). */
  el({ id: 'n-box', type: 'rect', x: 60, y: 150, width: 200, height: 100, stroke: '#1A1A1A', fill: '', roughness: 1, strokeWidth: 2, seed: 7001 }),
  el({ id: 'n-label', type: 'text', x: 92, y: 190, width: 160, height: 30, stroke: '#1A1A1A', text: 'Your notes', fontSize: 24, font: 'caveat', seed: 7002 }),
  el({ id: 'n-diamond', type: 'diamond', x: 366, y: 138, width: 190, height: 124, stroke: GREEN, fill: GREEN, fillStyle: 'hachure', opacity: 90, roughness: 1, strokeWidth: 2, seed: 7004 }),
  el({ id: 'n-arrow1', type: 'arrow', x: 272, y: 200, width: 84, height: 0, points: [[0, 0], [84, 0]], stroke: GREEN, strokeWidth: 2, roughness: 1, seed: 7003, attach: { from: 'n-box', to: 'n-diamond' } }),
  el({ id: 'n-fold', type: 'text', x: 418, y: 190, width: 140, height: 30, stroke: '#1A1A1A', text: 'Fold it', fontSize: 24, font: 'caveat', seed: 7005 }),
  el({ id: 'n-ellipse', type: 'ellipse', x: 660, y: 150, width: 190, height: 100, stroke: '#1A1A1A', fill: '', roughness: 1, strokeWidth: 2, seed: 7007 }),
  el({ id: 'n-arrow2', type: 'arrow', x: 566, y: 200, width: 84, height: 0, points: [[0, 0], [84, 0]], stroke: GREEN, strokeWidth: 2, roughness: 1, seed: 7006, attach: { from: 'n-diamond', to: 'n-ellipse' } }),
  el({ id: 'n-one', type: 'text', x: 700, y: 190, width: 150, height: 30, stroke: '#1A1A1A', text: 'One file', fontSize: 24, font: 'caveat', seed: 7008 }),
  el({ id: 'n-rule', type: 'freedraw', x: 676, y: 262, width: 160, height: 12, stroke: GREEN, strokeWidth: 3, roughness: 1, seed: 7009, points: [[0, 0], [30, 6], [64, 1], [100, 8], [132, 2], [160, 6]] }),
  { tool: 'set_caption', args: { caption: 'Notes in, one file out — drawn by an agent over WebMCP.' }, note: 'caption it' },
  { tool: 'save_deck', args: {}, note: 'save' },
];

export const CHARTS_SCENE = [
  { tool: 'get_data', args: {}, note: 'read the seeded chart' },
  {
    tool: 'set_chart',
    args: {
      chart: {
        type: 'bar',
        labels: ['A link', 'A PDF', 'A Fold'],
        series: [{ name: 'Still opens in five years', color: GREEN, values: [21, 68, 100] }],
        yMax: 110,
        showValues: true,
        title: 'Files people can still open',
      },
      caption: 'Real data replaces the seed, in one call.',
    },
    note: 'swap the seeded bars for real data',
  },
  {
    tool: 'set_chart',
    args: {
      chart: {
        type: 'pie',
        labels: ['A link', 'A PDF', 'A Fold'],
        series: [{ name: 'Still opens in five years', color: GREEN, values: [21, 68, 100] }],
        yMax: null,
        showValues: true,
        title: 'The same numbers, as a pie',
      },
      caption: 'One argument, twelve chart types — the data never moves.',
    },
    note: 'the same numbers as a pie',
  },
  {
    tool: 'set_venn',
    args: {
      venn: {
        count: 2,
        sets: [
          { label: 'Chart', color: GREEN },
          { label: 'Venn', color: GOLD },
        ],
        overlaps: [{ sets: [0, 1], label: 'One block, one gate', x: 50, y: 52 }],
      },
      caption: 'And the SAME fold morphs from a chart to a Venn.',
    },
    note: 'morph the same fold into a Venn',
  },
  { tool: 'save_deck', args: {}, note: 'save' },
];

export const GANTT_SCENE = [
  {
    tool: 'set_roadmap',
    args: {
      roadmap: {
        totalWeeks: 12,
        startDate: '2026-09-07',
        lenses: [
          { name: 'BUILD', color: BLUE },
          { name: 'LAUNCH', color: '#3D8B5A' },
          { name: 'DESIGN', color: GOLD },
        ],
        swimlanes: [
          { name: 'Site', owner: 'Origami Labs' },
          { name: 'Tools', owner: 'Origami Labs' },
          { name: 'Design', owner: 'Origami Labs' },
        ],
        cards: [
          { id: 'C01', title: 'origami.gratis goes live', swimlane: 'Site', start: 'W1', durationWeeks: 2, lens: 'LAUNCH', type: 'Process', effort: 'EASY', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: true },
          { id: 'C02', title: 'Draw, Charts and Gantt', swimlane: 'Tools', start: 'W1', durationWeeks: 3, lens: 'BUILD', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
          { id: 'C03', title: 'WebMCP on every page', swimlane: 'Tools', start: 'W4', durationWeeks: 3, lens: 'BUILD', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
          { id: 'C04', title: 'Origami Design', swimlane: 'Design', start: 'W5', durationWeeks: 4, lens: 'DESIGN', type: 'Technical', effort: 'DEFER', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
          { id: 'C05', title: 'The eighth petal', swimlane: 'Design', start: 'W9', durationWeeks: 2, lens: 'DESIGN', type: 'Process', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
          { id: 'C06', title: 'Share a Fold by link', swimlane: 'Site', start: 'W8', durationWeeks: 4, lens: 'LAUNCH', type: 'Technical', effort: 'DEFER', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
        ],
        milestones: [{ label: 'One file, every tool', week: 10, color: '#3D8B5A' }],
      },
      caption: 'The roadmap an agent wrote — on a real calendar.',
    },
    note: 'a real roadmap, three lanes, six cards',
  },
];

export const GANTT_SAVE = [{ tool: 'save_deck', args: {}, note: 'save' }];

/* ================================================================ HAND-OFF ================ */
/**
 * The half-made human deck, built BEFORE the take in a throwaway browser: cover plus one rough
 * fold, deliberately unfinished. Nothing in it repeats the pitch — different subject, different
 * palette, different voice — because the close is the last 30 seconds of the reel and must not
 * replay content the viewer has already sat through.
 */

const HANDOFF_COVER = `<div class="slide-inner">
  <p class="eyebrow">Half done &middot; started by hand in the Folio extension</p>
  <h1>Weekly review</h1>
  <p class="lede">Week 36. Written on a train, saved as one file, never uploaded anywhere.</p>
</div>`;

const HANDOFF_ROUGH = `<div class="slide-inner">
  <h2>Notes to tidy up</h2>
  <ul>
    <li>shipped the gantt thing</li>
    <li>3 tickets?? check monday</li>
    <li>TODO write this properly before the standup</li>
  </ul>
</div>`;

/** A slate palette, so the dropped file is visibly somebody else's document. */
export const HANDOFF_THEME = {
  accent: SLATE,
  bg: '#EEF1F5',
  paper: '#FFFFFF',
  rule: '#D5DDE7',
  'rule-soft': '#E6ECF2',
  'tint-a': '#DEE7F0',
  'tint-b': '#C6D5E4',
  chrome: '#22364E',
  'chrome-ink': '#EEF3F8',
  'chrome-mark': '#9FBBD6',
};

export const HANDOFF_BUILD = [
  { tool: 'create_deck', args: { title: 'Weekly review — week 36', foldType: 'deck', discard: true }, note: 'the human starts a deck' },
  { tool: 'set_deck_meta', args: { themeName: 'weekly-slate', themeTokens: HANDOFF_THEME }, note: 'their own theme' },
  { tool: 'write_chunk', args: { chunkId: COVER_REF, html: HANDOFF_COVER }, note: 'the cover they wrote' },
  { tool: 'add_custom_fold', args: { html: HANDOFF_ROUGH, label: 'Notes to tidy up' }, note: 'one rough fold, left unfinished' },
];

/** The finishing edit the agent stages on that rough fold — the card a HUMAN accepts on camera. */
export const HANDOFF_FINISHED_FOLD = `<div class="slide-inner">
  <p class="eyebrow">Finished by an agent, in the browser</p>
  <h2>Notes to tidy up</h2>
  <ul>
    <li>Gantt shipped on Tuesday; the roadmap block is live on every tool page.</li>
    <li>Three tickets still open — triage them before Monday's standup.</li>
    <li>Write up the WebMCP result while it is still fresh.</li>
  </ul>
</div>`;

export const HANDOFF_PROPOSAL = {
  title: 'Finish the week-36 notes',
  prompt: 'Turn the three rough notes into finished lines, and keep the order they were written in',
  author: 'agent:reel',
};
