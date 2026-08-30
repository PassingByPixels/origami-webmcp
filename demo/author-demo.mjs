/**
 * THE SHOW — an agent authors a full-featured Fold, live, in a real browser.
 *
 *   npm run demo            (default ~800 ms between tool calls)
 *   npm run demo -- --delay=1500
 *   npm run demo -- --delay=0        (as fast as the browser will go)
 *
 * It launches the INSTALLED stable Chrome, headed, with WebMCP switched on, in a throwaway
 * profile (your own Chrome profile is never opened). Everything it does to the deck goes
 * through Chrome's OWN WebMCP surface — `document.modelContext.getTools()` and
 * `.executeTool()`. There is no shim, no shortcut, no reaching into the app's internals.
 *
 * The ONLY DOM interaction outside that is clicking the deck's own tab strip inside the
 * preview, so a watching human sees each new fold as it lands. Every re-render resets the
 * viewer to fold 1, so without that the show would stare at the cover for two minutes.
 *
 * Ends by writing the finished .origami.html to your Downloads folder.
 */
import { chromium } from '@playwright/test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = 5180; // deliberately not 5173, so `npm run serve` can stay running
const OUT = join(homedir(), 'Downloads', 'origami-webmcp-demo.origami.html');
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const DELAY = delayArg ? Number(delayArg.split('=')[1]) : 800;

/* ---------------------------------------------------------------- deck content ---------- */

const dataBlock = (kind, data) =>
  `<script type="application/json" data-odata="${kind}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const COVER = `<div class="slide-inner">
  <p class="eyebrow">Origami · authored over WebMCP</p>
  <h1>An agent made this Fold. In your browser.</h1>
  <p class="lede">Nothing was uploaded and no server saw it. A model called tools this page had registered, and the deck assembled itself while you watched — ending as one file you can email to anyone.</p>
  <div class="card-grid">
    <div class="stat-card"><div class="big">21</div><div class="lbl">Tools on the page</div></div>
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
   behind the 100px header bar — see the finding in the report. A free card centres normally. */
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

/** Charts the tool calls this very run has already made, per fold. Real numbers, not decoration. */
const chartCard = (labels, values) => `<div class="slide-inner">
  <p class="eyebrow">Measured, not decorative</p>
  <h2>What it cost to write the folds above</h2>
  <figure class="o-chartfig anim">${dataBlock('chart', {
    type: 'bar',
    labels,
    series: [{ name: 'Tool calls', color: '#557A4E', values }],
    yMax: null,
    showValues: true,
    yTitle: 'calls',
  })}<div class="o-chart" data-chart-mount></div><figcaption>Counted by the demo script as it ran, then written into this fold before you saw it.</figcaption></figure>
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
  <p>It called tools this page had registered on Chrome's own WebMCP surface.<span class="o-footnote">Twenty-one tools are registered; this run used eleven distinct ones.</span> Each call changed an in-memory model and re-rendered the deck; not one of them touched the disk.</p>

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

/* ---------------------------------------------------------------- the driver ------------- */

const transcript = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn(process.execPath, [join(import.meta.dirname, '../tests/e2e/static-server.mjs'), String(PORT)], { stdio: 'ignore' });
  await sleep(700);

  await sweepProfiles();
  const profile = await mkdtemp(join(process.cwd(), '.tmp-chrome-demo-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: ['--enable-features=WebMCP', '--window-size=1560,1000', '--window-position=40,20'],
    });
  } catch (e) {
    server.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    console.error(`\n  Could not launch stable Chrome (channel:"chrome"): ${e.message.split('\n')[0]}`);
    console.error('  This demo needs Chrome >= 146 installed. Nothing else was changed.\n');
    process.exit(1);
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);

    const pill = await page.getByTestId('mcp-status').textContent();
    if (!/connected via/.test(pill ?? '')) {
      throw new Error(`WebMCP did not come up — the status pill says "${pill}". Chrome ${ctx.browser()?.version()} may predate the feature.`);
    }
    banner(`WebMCP live on Chrome ${ctx.browser()?.version()} — ${pill}`);

    // --- onboard, exactly as a model meeting Origami for the first time would ---
    await call(page, 'origami_guide', {}, 'read the whole format contract');
    await call(page, 'get_kind_schema', { kind: 'venn' }, 'learn the venn markup');
    await call(page, 'get_kind_schema', { kind: 'draw' }, 'learn the draw markup');

    // --- the deck ---
    const created = await call(page, 'create_deck', { title: 'A Fold, Written by an Agent', foldType: 'deck', discard: true }, 'mint a blank Fold');
    const coverId = created.chunks[0].id;

    await call(page, 'set_header', { subtitle: 'Authored live over WebMCP — no server, no upload, no install', chips: ['WebMCP', 'One file', 'Inert by default'] }, 'set the masthead');
    await call(page, 'write_chunk', { chunkId: coverId, html: COVER }, 'write the cover');
    await show(page, 0);

    const venn = await call(page, 'add_chunk', { kind: 'venn', html: VENN, label: 'Where it lands' }, 'add the venn card');
    await show(page, 1);

    const draw = await call(page, 'add_chunk', { kind: 'draw', html: DRAW, label: 'The pitch, sketched' }, 'add the draw card');
    await show(page, 2);

    const flow = await call(page, 'add_chunk', { kind: 'free', html: FLOW, label: 'Who does what' }, 'add the two-lane flow');
    await show(page, 3);

    // --- the review loop, on show ---
    const staged = await call(page, 'propose_chunk', {
      chunkId: coverId,
      html: PROPOSED_COVER,
      title: 'Tighten the cover lede',
      prompt: 'Two short sentences read better than one long one',
      author: 'agent:demo',
    }, 'PROPOSE a cover edit (not applied)');
    await sleep(DELAY * 2); // let the card sit on screen
    await call(page, 'list_proposals', {}, 'read the review queue');
    await call(page, 'accept_proposal', { proposalId: staged.proposalId }, 'ACCEPT it — the same path the human button takes');
    await show(page, 0);

    // --- a fold built from numbers this run actually produced ---
    const perFold = foldCosts();
    await call(page, 'add_chunk', { kind: 'free', html: chartCard(perFold.labels, perFold.values), label: 'What it cost' }, 'add the chart, using this run\'s real counts');
    await show(page, 4);

    const doc = await call(page, 'add_chunk', { kind: 'document', html: SCROLL_DOC, label: 'The long read' }, 'add the multi-column scroll fold');
    await show(page, 5);

    const toc = await call(page, 'list_chunks', {}, 'confirm the table of contents');
    const saved = await call(page, 'save_deck', {}, 'finish — validate and try to save');

    // --- take the bytes the app would have written ---
    // The preview re-render is DEBOUNCED, so reading srcdoc the instant save_deck returns can
    // hand back a deck several folds behind. At --delay=0 that silently wrote a 4-fold file
    // that still carried the pre-proposal cover. Wait for the real thing instead of assuming.
    const html = await waitForDeck(page, toc.chunks.length, 'Nothing was uploaded. No server saw it.');
    await writeFile(OUT, html, 'utf8');

    banner('done');
    console.log(`  folds:        ${toc.chunks.length}  (${toc.chunks.map((c) => c.kind).join(', ')})`);
    console.log(`  tool calls:   ${transcript.length}`);
    console.log(`  deck valid:   ${saved.validated}   saved to disk by the page: ${saved.saved}`);
    console.log(`  written to:   ${OUT}`);
    console.log(`  bytes:        ${Buffer.byteLength(html, 'utf8').toLocaleString()}`);
    if (consoleErrors.length) console.log(`  PAGE ERRORS:  ${consoleErrors.length} — ${consoleErrors.slice(0, 3).join(' | ')}`);
    else console.log('  page errors:  none');
    console.log('\n  transcript');
    for (const [i, t] of transcript.entries()) console.log(`   ${String(i + 1).padStart(2)}. ${t.name.padEnd(16)} ${t.note}`);
    console.log('');
    if (DELAY > 0) {
      console.log('  leaving the window open for 15s so you can click through it…\n');
      await sleep(15000);
    }
    // ids referenced so a reader of the transcript can match folds to calls
    void [venn, draw, flow, doc];
  } finally {
    await ctx.close().catch(() => {});
    server.kill();
    await sweepProfiles();
  }
}

/** One tool call, through Chrome's own WebMCP surface. */
async function call(page, name, args, note) {
  const raw = await page.evaluate(
    async ([n, a]) => {
      const ctx = document.modelContext;
      const tools = await ctx.getTools();
      const t = tools.find((x) => x.name === n);
      if (!t) throw new Error(`not registered on the native surface: ${n}`);
      const r = await ctx.executeTool(t, JSON.stringify(a));
      return typeof r === 'string' ? r : JSON.stringify(r);
    },
    [name, args]
  );
  const envelope = JSON.parse(raw);
  const text = envelope.content[0].text;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  transcript.push({ name, note, isError: !!envelope.isError });
  console.log(`  ${String(transcript.length).padStart(2)}. ${name.padEnd(16)} ${note}${envelope.isError ? '   <-- ERROR' : ''}`);
  if (envelope.isError) throw new Error(`${name} failed: ${text.slice(0, 300)}`);
  await sleep(DELAY);
  return body;
}

/**
 * The serialized Fold, once the preview has actually caught up with the model.
 * Polls for the expected fold count AND a marker only the final state contains.
 * Counts `<template data-origami-slide=` and not the bare attribute name: the embedded runtime
 * carries that string twice as a selector, which made a 6-fold deck read as 8.
 */
async function waitForDeck(page, folds, marker) {
  const deadline = Date.now() + 8000;
  let html = '';
  while (Date.now() < deadline) {
    html = (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';
    const seen = (html.match(/<template data-origami-slide=/g) ?? []).length;
    if (seen === folds && html.includes(marker)) return html;
    await sleep(120);
  }
  const seen = (html.match(/<template data-origami-slide=/g) ?? []).length;
  throw new Error(`the preview never caught up: expected ${folds} folds${marker ? ' + the accepted cover text' : ''}, saw ${seen} folds. Nothing was written.`);
}

/** Click the deck's own tab strip so the newest fold is the one on screen. */
async function show(page, index) {
  if (DELAY === 0) return;
  const tab = page.frameLocator('[data-testid="preview"]').locator('.o-tab').nth(index);
  await tab.click({ timeout: 3000 }).catch(() => {});
  await sleep(DELAY);
}

/**
 * Tool calls attributable to each fold built so far, counted off the live transcript.
 * The chart fold is authored AFTER the folds it counts, so these are real numbers from this
 * run — not a hand-written guess that happens to look plausible.
 */
function foldCosts() {
  const byName = (re) => transcript.filter((t) => re.test(t.name)).length;
  const byNote = (word) => transcript.filter((t) => t.note.includes(word)).length;
  return {
    labels: ['Cover', 'Venn', 'Draw', 'Flow', 'Review'],
    values: [byName(/^(write_chunk|set_header)$/), byNote('venn'), byNote('draw'), byNote('flow'), byName(/^(propose_chunk|list_proposals|accept_proposal)$/)],
  };
}

async function sweepProfiles() {
  for (const name of await readdir(process.cwd())) {
    if (name.startsWith('.tmp-chrome-demo-')) await rm(join(process.cwd(), name), { recursive: true, force: true }).catch(() => {});
  }
}

function banner(msg) {
  console.log(`\n${'='.repeat(78)}\n  ${msg}\n${'='.repeat(78)}\n`);
}

main().catch((e) => {
  console.error(`\n  DEMO FAILED: ${e.message}\n`);
  process.exit(1);
});
