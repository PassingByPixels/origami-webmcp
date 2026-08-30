/**
 * HOSTILE REVIEW of the artifact `npm run demo` produced.
 *
 *   npm run demo:audit
 *
 * Opens the .origami.html straight off disk over file:// in a PLAIN Chromium — no WebMCP, no
 * app, no server, no flags. That is the promise the format makes ("double-click, it plays"), so
 * that is where it gets tested. Every block must mount from the file itself.
 *
 * It fails loudly rather than papering over anything, and writes four screenshots next to the
 * artifact.
 */
import { chromium } from '@playwright/test';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ART = join(homedir(), 'Downloads', 'origami-webmcp-demo.origami.html');
const SHOT = (name) => join(homedir(), 'Downloads', `origami-webmcp-demo-${name}.png`);

/** Exactly what the demo authored — a split word would not round-trip to one of these. */
const VENN_LABELS = new Set(['Human authored', 'Agent authored', 'Interoperability', 'Reviewed together', 'An open Fold']);

const findings = [];
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  findings.push(m);
  console.log(`  FAIL  ${m}`);
};
const check = (ok, m) => (ok ? pass(m) : fail(m));

try {
  await access(ART);
} catch {
  console.error(`\n  No artifact at ${ART}\n  Run "npm run demo" first.\n`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));

console.log(`\n  auditing ${ART}\n  over ${pathToFileURL(ART).href}\n`);
await page.goto(pathToFileURL(ART).href);
await page.waitForTimeout(1500);

/* ---- the deck itself ---- */
const tabs = page.locator('.o-tab');
const tabCount = await tabs.count();
check(tabCount === 6, `6 folds in the tab strip (found ${tabCount})`);
check((await page.locator('.o-title').innerText()).includes('A Fold, Written by an Agent'), 'masthead carries the deck title');
const sub = await page.locator('.o-subtitle').count();
check(sub === 1, 'masthead subtitle rendered');
const chips = await page.locator('.o-chip').count();
check(chips === 3, `3 metadata chips (found ${chips})`);

/** Show fold `i` and let its mount AND entrance animation settle. 900 ms was not enough: the
    flow diagram was still mid-reveal, so a screenshot caught it clipped and every DOM-presence
    check still passed. Presence is not visibility. */
async function fold(i) {
  await tabs.nth(i).click();
  await page.waitForTimeout(1600);
}

/**
 * Every element matching `sel` is fully READABLE — inside the viewport AND clear of the fixed
 * masthead. `top >= 0` is not enough: the first version of this check passed a diagram whose
 * top 74px sat behind the 100px header bar. Anything a reader cannot see is not rendered.
 */
async function fullyVisible(sel) {
  return page.locator(`.o-stage .slide.is-shown ${sel}`).evaluateAll((els) => {
    const h = window.innerHeight;
    const mast = document.querySelector('.o-top')?.getBoundingClientRect().bottom ?? 0;
    const boxes = els.map((e) => e.getBoundingClientRect());
    return {
      count: boxes.length,
      mast: Math.round(mast),
      bad: boxes.filter((b) => b.top < mast || b.bottom > h).map((b) => ({ top: Math.round(b.top), bottom: Math.round(b.bottom) })),
    };
  });
}

/** Text of every <text> in a block's svg. textContent, because SVG has no innerText. */
const svgText = (blockClass) =>
  page.locator(`.o-stage .slide.is-shown ${blockClass} svg text`).evaluateAll((ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));

/* ---- 1. cover ---- */
await fold(0);
check((await page.locator('.o-stage .slide.is-shown h1').count()) > 0, 'cover: h1 rendered');
const cards = await page.locator('.o-stage .slide.is-shown .stat-card').count();
check(cards === 3, `cover: 3 stat cards (found ${cards})`);
// the accepted proposal, not the original wording
const lede = await page.locator('.o-stage .slide.is-shown .lede').innerText();
check(lede.startsWith('Nothing was uploaded. No server saw it.'), 'cover: carries the ACCEPTED proposal text, not the draft');
await page.screenshot({ path: SHOT('cover') });

/* ---- 2. venn ---- */
await fold(1);
const vennSvg = page.locator('.o-stage .slide.is-shown .o-venn svg');
check((await vennSvg.count()) > 0, 'venn: svg mounted');
check((await page.locator('.o-stage .slide.is-shown .o-venn svg circle, .o-stage .slide.is-shown .o-venn svg ellipse, .o-stage .slide.is-shown .o-venn svg path').count()) >= 3, 'venn: 3+ shapes drawn');

// no mid-word splits: rejoining each label's tspans must reproduce a label we actually wrote
const vennTexts = await page.locator('.o-stage .slide.is-shown .o-venn svg text').evaluateAll((nodes) =>
  nodes.map((n) => {
    const spans = [...n.querySelectorAll('tspan')].map((t) => t.textContent.trim()).filter(Boolean);
    return { lines: spans.length ? spans : [n.textContent.trim()], joined: (spans.length ? spans : [n.textContent.trim()]).join(' ') };
  })
);
const wrapped = vennTexts.filter((t) => t.lines.length > 1);
const unknown = vennTexts.filter((t) => t.joined && !VENN_LABELS.has(t.joined));
check(vennTexts.length >= 5, `venn: ${vennTexts.length} label texts found`);
check(unknown.length === 0, `venn: every label rejoins to an authored label — NO mid-word split${unknown.length ? ` (bad: ${JSON.stringify(unknown.map((u) => u.joined))})` : ''}`);
console.log(`        wrapped over ${wrapped.length} label(s): ${JSON.stringify(wrapped.map((w) => w.lines))}`);
await page.screenshot({ path: SHOT('venn') });

/* ---- 3. draw ---- */
await fold(2);
const drawSvg = page.locator('.o-stage .slide.is-shown .o-draw svg');
check((await drawSvg.count()) > 0, 'draw: svg mounted');
const strokes = await page.locator('.o-stage .slide.is-shown .o-draw svg path').count();
check(strokes >= 8, `draw: ${strokes} stroke paths rendered`);
// NB: SVG <text> has no innerText — allInnerTexts() returns nulls. textContent is the only
// reading that works, and getting this wrong invents a defect that is not there.
const drawText = await svgText('.o-draw');
check(['Your notes', 'Fold it', 'One file'].every((t) => drawText.includes(t)), `draw: hand-lettered labels present (${JSON.stringify(drawText)})`);
await page.screenshot({ path: SHOT('draw') });

/* ---- 4. flow, two lanes ---- */
await fold(3);
check((await page.locator('.o-stage .slide.is-shown .o-flow svg').count()) > 0, 'flow: svg mounted');
const laneLabels = await svgText('.o-flow');
check(laneLabels.includes('Agent') && laneLabels.includes('Human'), `flow: BOTH lane headers present (${JSON.stringify(laneLabels.filter((t) => t === 'Agent' || t === 'Human'))})`);
check((await page.locator('.o-stage .slide.is-shown .o-flow svg .o-flow-lanes').count()) === 1, 'flow: the lane band group rendered');
const nodeLabels = ['Draft the fold', 'Propose the edit', 'Read the card', 'Accept', 'Save the file'];
check(nodeLabels.every((l) => laneLabels.includes(l)), `flow: all 5 nodes seated (${laneLabels.length} text nodes total)`);
const laneVis = await fullyVisible('.o-flow svg .o-flow-lanes rect');
check(laneVis.count === 2 && laneVis.bad.length === 0, `flow: both lane bands fully ON SCREEN, not clipped (${laneVis.count} bands, ${laneVis.bad.length} out of view${laneVis.bad.length ? ` ${JSON.stringify(laneVis.bad)}` : ''})`);
const figVis = await fullyVisible('.o-flowfig');
check(figVis.bad.length === 0, `flow: the whole figure fits the fold${figVis.bad.length ? ` — CLIPPED ${JSON.stringify(figVis.bad)}` : ''}`);
await page.screenshot({ path: SHOT('flow') });

/* ---- 5. chart ---- */
await fold(4);
check((await page.locator('.o-stage .slide.is-shown .o-chart svg').count()) > 0, 'chart: svg mounted');
const bars = await page.locator('.o-stage .slide.is-shown .o-chart svg rect').count();
check(bars >= 5, `chart: ${bars} rects (5 bars + grid expected)`);
await page.screenshot({ path: SHOT('chart') });

/* ---- 6. the scroll document, multi-column ---- */
await fold(5);
const doc = page.locator('.o-stage .slide.is-shown .o-doc');
check((await doc.count()) > 0, 'scroll: document paper rendered');
const tocLinks = await page.locator('.o-stage .slide.is-shown .o-toc a, .o-stage .slide.is-shown .o-toc li').count();
check(tocLinks >= 3, `scroll: table of contents built from the headings (${tocLinks} entries)`);
check((await page.locator('.o-stage .slide.is-shown .o-callout').count()) === 1, 'scroll: callout rendered');

const tcols = page.locator('.o-stage .slide.is-shown .o-tcols');
const tcolsCount = await tcols.count();
check(tcolsCount === 2, `scroll: 2 multi-column blocks (found ${tcolsCount})`);

// side by side is a GEOMETRY claim — measure it, do not trust the class name
for (let i = 0; i < tcolsCount; i++) {
  const boxes = await tcols.nth(i).locator('> .o-text').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) })));
  const sameRow = boxes.every((b) => Math.abs(b.y - boxes[0].y) < 8);
  const distinctX = new Set(boxes.map((b) => b.x)).size === boxes.length;
  check(boxes.length >= 2 && sameRow && distinctX, `scroll: tcols[${i}] — ${boxes.length} columns actually side by side (tops ${boxes.map((b) => b.y).join('/')}, lefts ${boxes.map((b) => b.x).join('/')})`);
}
await page.screenshot({ path: SHOT('scroll'), fullPage: false });

/* ---- console cleanliness ---- */
check(errors.length === 0, `zero console/page errors (found ${errors.length}${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''})`);

await browser.close();

console.log(`\n  screenshots: ${SHOT('cover')}`);
for (const n of ['venn', 'draw', 'flow', 'chart', 'scroll']) console.log(`               ${SHOT(n)}`);

if (findings.length) {
  console.log(`\n  ${findings.length} FINDING(S):`);
  for (const f of findings) console.log(`   - ${f}`);
  console.log('');
  process.exit(1);
}
console.log('\n  clean.\n');
