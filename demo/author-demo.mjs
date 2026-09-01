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
 * The call sequence and the deck content are NOT here: they live in src/app/demo-script.ts,
 * which the app's landing page replays through the same tools. One list, two drivers — node
 * imports the .ts module directly (type stripping), so there is no copy to keep in step.
 *
 * The ONLY DOM interaction outside the tool calls is clicking the deck's own tab strip inside
 * the preview, so a watching human sees each new fold as it lands. Every re-render resets the
 * viewer to fold 1, so without that the show would stare at the cover for two minutes.
 *
 * Ends by writing the finished .origami.html to your Downloads folder — the bytes the
 * export_deck TOOL hands back, which are the save path's own bytes.
 */
import { chromium } from '@playwright/test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEMO_CALLS, DEMO_FOLDS, DEMO_ONBOARDING, bindRefs, learnRefs } from '../src/app/demo-script.ts';

const PORT = 5180; // deliberately not 5173, so `npm run serve` can stay running
const OUT = join(homedir(), 'Downloads', 'origami-webmcp-demo.origami.html');
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const DELAY = delayArg ? Number(delayArg.split('=')[1]) : 800;

/** A sentence only the ACCEPTED cover carries — proof the review loop landed, not just ran. */
const ACCEPTED_MARKER = 'Nothing was uploaded. No server saw it.';

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
    await page.goto(`http://127.0.0.1:${PORT}/folio/index.html`);

    const pill = await page.getByTestId('mcp-status').textContent();
    if (!/connected via/.test(pill ?? '')) {
      throw new Error(`WebMCP did not come up — the status pill says "${pill}". Chrome ${ctx.browser()?.version()} may predate the feature.`);
    }
    banner(`WebMCP live on Chrome ${ctx.browser()?.version()} — ${pill}`);

    // --- onboard, exactly as a model meeting Origami for the first time would ---
    for (const step of DEMO_ONBOARDING) await call(page, step.tool, step.args, step.note);

    // --- the recorded run: the SAME list the app's landing page replays ---
    const refs = {};
    const last = {};
    for (const step of DEMO_CALLS) {
      const body = await call(page, step.tool, bindRefs(step.args, refs), step.note);
      learnRefs(step.tool, body, refs);
      last[step.tool] = body;
      // let a staged card sit on screen long enough to be read before it is resolved
      if (step.tool === 'propose_chunk') await sleep(DELAY);
      await showFoldFor(page, step.tool, body);
    }

    const toc = last.list_chunks;
    const saved = await call(page, 'save_deck', {}, 'finish — validate and try to save');

    /* --- take the bytes through the TOOL, not off the screen ---
       This used to read the preview's srcdoc, which carries the app's injected preview bridge
       (~1.6 KB of dead script the save path never writes) and lags the model by a debounce.
       export_deck returns exactly what save_deck serializes, straight from the model. */
    const exported = await call(page, 'export_deck', {}, 'take the finished bytes (the save path\'s own)');
    checkDeck(exported.text, toc.chunks.length);
    await writeFile(OUT, exported.text, 'utf8');

    banner('done');
    console.log(`  folds:        ${toc.chunks.length}  (${toc.chunks.map((c) => c.kind).join(', ')})`);
    console.log(`  tool calls:   ${transcript.length}`);
    console.log(`  deck valid:   ${saved.validated}   saved to disk by the page: ${saved.saved}`);
    console.log(`  written to:   ${OUT}`);
    console.log(`  bytes:        ${exported.bytes.toLocaleString()}`);
    if (consoleErrors.length) console.log(`  PAGE ERRORS:  ${consoleErrors.length} — ${consoleErrors.slice(0, 3).join(' | ')}`);
    else console.log('  page errors:  none');
    console.log('\n  transcript');
    for (const [i, t] of transcript.entries()) console.log(`   ${String(i + 1).padStart(2)}. ${t.name.padEnd(16)} ${t.note}`);
    console.log('');
    if (DELAY > 0) {
      console.log('  leaving the window open for 15s so you can click through it…\n');
      await sleep(15000);
    }
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
 * The finished Fold, checked before it is written.
 * Counts `<template data-origami-slide=` and not the bare attribute name: the embedded runtime
 * carries that string twice as a selector, which made a 6-fold deck read as 8.
 */
function checkDeck(html, folds) {
  const seen = (html.match(/<template data-origami-slide=/g) ?? []).length;
  if (seen !== folds || seen !== DEMO_FOLDS) {
    throw new Error(`the exported Fold has ${seen} folds; the deck reports ${folds} and the script builds ${DEMO_FOLDS}. Nothing was written.`);
  }
  if (!html.includes(ACCEPTED_MARKER)) {
    throw new Error('the exported Fold does not carry the ACCEPTED cover text — the review loop did not land. Nothing was written.');
  }
}

/** Click the deck's own tab strip so the fold a call just touched is the one on screen. */
async function showFoldFor(page, tool, body) {
  // add_chunk answers with the index it inserted at; the cover is fold 0, and the two calls
  // that rewrite it (the write, and the proposal being accepted) belong there.
  const index = tool === 'add_chunk' ? body.index : tool === 'write_chunk' || tool === 'accept_proposal' ? 0 : -1;
  if (index < 0 || DELAY === 0) return;
  const tab = page.frameLocator('[data-testid="preview"]').locator('.o-tab').nth(index);
  await tab.click({ timeout: 3000 }).catch(() => {});
  await sleep(DELAY);
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
