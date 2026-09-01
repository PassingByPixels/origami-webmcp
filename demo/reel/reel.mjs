/**
 * THE DEMO REEL — one continuous 1080p screen recording of origami.gratis, silent, cut to the
 * scene plan in `Cortex/projects/Origami Folio/Upgrade Ideas/MCP upgrade/demo-reel-plan.md`.
 *
 *   node demo/reel/reel.mjs                 (full take -> Downloads/origami-reel.mp4)
 *   node demo/reel/reel.mjs --pace=0.9      (stretch or squeeze every beat by a factor)
 *   node demo/reel/reel.mjs --out=D:\x.mp4
 *
 * THE TRANSPORT IS THE REAL ONE. There is no shim anywhere in this file. It launches the
 * INSTALLED stable Chrome with `--enable-features=WebMCP` and drives every authoring call through
 * Chrome's own `document.modelContext.getTools()` / `.executeTool()` — the pattern
 * tests/e2e/webmcp-native.spec.ts proves and demo/author-demo.mjs uses. The app registers its
 * tools with the browser; this script asks the browser to run them. Measured on this machine:
 * Chrome 152.0.7977.65 exposes document.modelContext (navigator.modelContext is gone in 152) and
 * the status pill reads "connected via document.modelContext — 29 tools".
 *
 * WHY THE CALLS SHOW AS AGENT WORK. Chrome's executeTool reaches the callback the app registered,
 * which is `registry.invoke(name, args)` with no source argument, and src/core/registry.ts
 * defaults that to 'agent'. So the Activity rail narrates the reel as agent work because it IS
 * agent work, over the browser's own surface.
 *
 * A FAKE CURSOR is drawn by an init script, because a video capture cannot see the real pointer.
 * It is glided in step with real `page.mouse` moves, so the drawn arrow and the hover states can
 * never disagree, and it parks off-content while the agent works.
 *
 * PACING IS OFF THE RENDER, NOT A GUESS. After every mutating call the driver waits for the
 * preview iframe to remount and paint (the viewer's own `window.__origami` plus two animation
 * frames), then holds ONE short beat. Nothing in this reel stands still for more than two seconds
 * except the two deliberate holds: Present, and the end card.
 *
 * Nothing here touches the app. The only files it writes are the video, the frames, a throwaway
 * Chrome profile and two temporary .origami.html files, all under the scratchpad.
 */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACT1,
  ACT2,
  CHARTS_SCENE,
  COPPER_THEME,
  DRAW_SCENE,
  GANTT_SAVE,
  GANTT_SCENE,
  HANDOFF_BUILD,
  HANDOFF_FINISHED_FOLD,
  HANDOFF_PROPOSAL,
  bindRefs,
  learnRefs,
} from './scenes.mjs';
import { IMAGE_BYTES } from './paper-image.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const SCRATCH = join(tmpdir(), 'origami-reel');
const WORK = join(SCRATCH, 'reel-work');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const PACE = Number(arg('pace', '1'));
const OUT_MP4 = arg('out', join(homedir(), 'Downloads', 'origami-reel.mp4'));
const OUT_WEBM = OUT_MP4.replace(/\.mp4$/i, '.webm');

const W = 1920;
const H = 1080;
/** Where the cursor waits while the agent is working: off the content, on the desk. */
const PARK = { x: 1856, y: 1020 };
/** The one beat after a settled repaint. The no-still-frame-over-2s budget lives here. */
const BEAT = 2000;

const CHROME_ARGS = ['--enable-features=WebMCP', `--window-size=${W},${H}`, '--window-position=0,0'];

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const hold = (ms) => sleep(ms * PACE);

/* ---------------------------------------------------------------- the cursor ------------- */

/* Runs at document_start in every frame of every navigation, http and file:// alike. It draws a
   pointer and nothing else — the WebMCP surface here is Chrome's, not ours to stand in for. */
function cursorScript() {
  if (window.top !== window) return; // one frame draws it, so two frames cannot draw two

  const ARROW =
    '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 2 L3 27.5 L9.9 21.4 L14.4 31.6 L19.1 29.5 L14.7 19.5 L23.9 19.1 Z" ' +
    'fill="#1A1A1A" stroke="#FFFDF8" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  let x = -200;
  let y = -200;
  let node = null;

  const place = () => {
    if (node) node.style.transform = `translate3d(${x - 3}px, ${y - 2}px, 0)`;
  };

  const ensure = () => {
    if (!document.documentElement) return; // document_start: there is no root element yet
    if (node && node.isConnected) return;
    node = document.createElement('div');
    node.id = '__reel_cursor';
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText =
      'position:fixed;left:0;top:0;width:30px;height:38px;z-index:2147483647;pointer-events:none;' +
      'filter:drop-shadow(0 3px 5px rgba(0,0,0,.38));will-change:transform;';
    node.innerHTML = ARROW;
    // on <html>, not <body>: the deck runtime rebuilds body wholesale on every re-render
    document.documentElement.appendChild(node);
    place();
  };

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  window.__cursor = (nx, ny) => {
    x = nx;
    y = ny;
    ensure();
    place();
  };

  /** Glide the drawn cursor with the SAME easing the driver walks the real mouse with. */
  window.__glide = (tx, ty, ms) =>
    new Promise((done) => {
      ensure();
      const fx = x;
      const fy = y;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = ease(p);
        x = fx + (tx - fx) * e;
        y = fy + (ty - fy) * e;
        place();
        if (p < 1) requestAnimationFrame(step);
        else done(true);
      };
      requestAnimationFrame(step);
    });

  // LAST, so a throw in here can never leave __cursor/__glide undefined
  setInterval(ensure, 200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  ensure();
}

const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------------------------------------------------------------- the driver -------------- */

const marks = [];
let T0 = 0;
const mark = (label) => {
  const at = (Date.now() - T0) / 1000;
  marks.push({ at: Number(at.toFixed(2)), label });
  console.log(`  ${String(at.toFixed(1)).padStart(6)}s  ${label}`);
};

let mouse = { x: PARK.x, y: PARK.y };
let calls = 0;
/** Seconds of recorder lead-in before the cut starts — trimmed off in the encode. */
let lead = 0;

/** Move the drawn cursor and the real pointer together. The real one is what fires :hover. */
async function glide(page, x, y, ms) {
  const from = { ...mouse };
  const anim = page.evaluate(([tx, ty, t]) => window.__glide(tx, ty, t), [x, y, ms]).catch(() => {});
  const steps = Math.max(8, Math.round(ms / 35));
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = EASE(p);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e).catch(() => {});
    await sleep(t0 + ms * p - Date.now());
  }
  mouse = { x, y };
  await anim;
}

const park = (page) => glide(page, PARK.x, PARK.y, 460);

/** Glide onto an element and click it, without the pointer ever teleporting. */
async function clickAt(page, locator, ms = 850) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to click — the locator has no box');
  await glide(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), ms);
  await hold(260);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

/**
 * ONE TOOL CALL, THROUGH CHROME'S OWN WebMCP SURFACE.
 *
 * getTools() is re-read on every call rather than cached: it is one cheap round trip, and it
 * means each call in the reel is proof that the browser still holds the registration.
 */
async function drive(page, name, args, note) {
  const raw = await page.evaluate(
    async ([n, a]) => {
      const ctx = document.modelContext;
      if (!ctx) throw new Error('document.modelContext is absent — Chrome was launched without --enable-features=WebMCP');
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
  if (envelope.isError) throw new Error(`${name} refused: ${text.slice(0, 400)}`);
  calls++;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  console.log(`      · ${name.padEnd(15)} ${note ?? ''}`);
  return body;
}

/* ---------------------------------------------------------------- the preview ------------- */

async function previewFrame(page) {
  const el = await page.$('[data-testid="preview"]');
  if (!el) return null;
  return el.contentFrame();
}

/**
 * Wait until the preview has actually repainted, then hold one beat.
 *
 * src/app/preview.ts re-renders by replacing the iframe's srcdoc behind a 30 ms debounce, so a
 * fixed sleep after a call either races the remount or wastes the difference. This waits for the
 * NEW document to publish the viewer the runtime installs (`window.__origami`) and to lay a fold
 * out, then gives it two animation frames, and only then spends what is left of the beat.
 */
async function settle(page, beat = BEAT) {
  const t0 = Date.now();
  await sleep(120); // past the app's own re-render debounce
  try {
    const frame = await previewFrame(page);
    if (frame) {
      await frame.waitForFunction(
        () => !!window.__origami?.viewer && (document.querySelector('.o-stage')?.childElementCount ?? 0) > 0,
        null,
        { timeout: 6000 }
      );
      await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
  } catch {
    /* the frame was mid-swap or this page has no preview; the beat below still applies */
  }
  await hold(beat - (Date.now() - t0));
}

/** Play a recorded list, binding the ids earlier calls minted, pacing off the real repaint. */
async function play(page, list, refs = {}, beat = BEAT) {
  for (const step of list) {
    if (step.tool === '@theme-copper') {
      await drive(page, 'set_deck_meta', { themeName: 'origami-copper', themeTokens: COPPER_THEME }, step.note);
    } else if (step.tool === '@theme-green') {
      // the deck's OWN palette, captured off a real deck before the take — never a guess at it
      await drive(page, 'set_deck_meta', { themeName: 'origami-default', themeTokens: refs['@palette'] }, step.note);
    } else {
      const body = await drive(page, step.tool, bindRefs(step.args, refs), step.note);
      learnRefs(step.tool, body, refs);
      if (step.tool === 'add_chunk' || step.tool === 'write_chunk') {
        const active = body.activeContent ?? [];
        if (active.length) console.log(`        activeContent: ${JSON.stringify(active)}`);
      }
    }
    await settle(page, beat);
  }
  return refs;
}

/** Take the preview to a fold by index, through the app's own bridge — no mouse, no scrollbar. */
async function goFold(page, index) {
  await page.evaluate((i) => {
    document.getElementById('preview')?.contentWindow?.postMessage({ type: 'origami-goto', index: i, id: '' }, '*');
  }, index);
}

/**
 * THE CAMERA. One pass, top to bottom, inside the preview.
 *
 * It runs when the document is FINISHED and nothing else is happening. That is not a stylistic
 * choice: every write replaces the iframe's srcdoc, which destroys the document being scrolled
 * and puts the reader back at the top — a scroll interleaved with the build doubles back on
 * itself at every call. The easing is smoothstep, which is monotonic, so the scroll position
 * never decreases frame over frame.
 */
async function scrollThrough(page, ms) {
  const frame = await previewFrame(page);
  if (!frame) return { scrolled: 0 };
  return frame.evaluate(
    (ms) =>
      new Promise((done) => {
        const pick = () => {
          let best = null;
          let room = 0;
          for (const c of [document.scrollingElement, document.body, document.querySelector('.o-stage')]) {
            if (!c) continue;
            const r = c.scrollHeight - c.clientHeight;
            if (r > room) {
              room = r;
              best = c;
            }
          }
          return { best, room };
        };
        const { best, room } = pick();
        if (!best || room < 40) return done({ scrolled: 0, room });
        const from = best.scrollTop;
        const t0 = performance.now();
        const smooth = (p) => p * p * (3 - 2 * p); // monotonic on [0,1]
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          best.scrollTop = from + (room - from) * smooth(p);
          if (p < 1) requestAnimationFrame(step);
          else done({ scrolled: Math.round(best.scrollTop), room: Math.round(room) });
        };
        requestAnimationFrame(step);
      }),
    ms * PACE
  );
}

async function waitConnected(page) {
  await page.getByTestId('mcp-status').waitFor();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="mcp-status"]')?.textContent ?? '').includes('connected'),
    null,
    { timeout: 20_000 }
  );
}

/* ---------------------------------------------------------------- scenes ------------------ */

/** Land on the flower BEFORE the clock starts, so frame one of the cut is the home page and not
    the browser's blank tab. What the recorder caught before this is trimmed off in the encode. */
async function preroll(page, base) {
  await page.goto(`${base}/`);
  await page.getByTestId('flower').waitFor();
  await page.evaluate(([x, y]) => window.__cursor(x, y), [1560, 1000]);
  mouse = { x: 1560, y: 1000 };
  await sleep(400);
}

async function coldOpen(page, base) {
  mark('cold open — the flower');
  await hold(1300);

  // sweep three petals: the lift and the accent label have to be readable in the frames
  for (const [petal, dwell] of [['charts', 1100], ['draw', 1100], ['folio', 1500]]) {
    const box = await page.locator(`[data-petal="${petal}"] a`).boundingBox();
    await glide(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height * 0.6), 820);
    await hold(dwell);
  }
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await page.waitForURL(/\/folio\/$/);
  await page.getByTestId('empty-state').waitFor();
  await waitConnected(page);
  await hold(900);
}

async function folioAct1(page, palette) {
  mark('FOLIO ACT 1 — the presentation');
  await park(page);
  const refs = { '@palette': palette };
  // everything up to the measurement…
  await play(page, ACT1.slice(0, 13), refs);
  // …then the camera tours the finished deck while the agent checks and saves it, so the last
  // beats of the act are the deck itself rather than a still frame of whatever landed last
  const tour = (async () => {
    for (const i of [0, 1, 2, 3, 4]) {
      await goFold(page, i);
      await hold(1900);
    }
  })();
  await play(page, ACT1.slice(13), refs);
  await tour;
  return refs;
}

async function folioAct2(page) {
  mark('FOLIO ACT 2 — the scroll');
  const refs = {};
  await play(page, ACT2.slice(0, 2), refs);           // these two change the visible top
  await play(page, ACT2.slice(2, 6), refs, 1500);     // these four append below the fold
  await play(page, ACT2.slice(6), refs, 1800);
  await goFold(page, 0); // the build left the reader at the top; make that explicit before the pass
  await hold(700);
  mark('ACT 2 — one continuous pass down the document');
  const moved = await scrollThrough(page, 23_000);
  console.log(`      · camera: scrolled ${moved.scrolled} of ${moved.room}px, one monotonic pass`);
  await hold(900);
}

async function mini(page, base, path, list, label, beat) {
  mark(label);
  await page.goto(`${base}${path}`);
  await page.getByTestId('preview').waitFor();
  await waitConnected(page);
  await settle(page, 1200);
  return play(page, list, {}, beat);
}

async function ganttHumanBeat(page) {
  // the filter chips belong to the DECK, inside the preview — a human hand on the same surface
  const chips = page.frameLocator('[data-testid="preview"]').locator('.o-gantt-chip');
  const n = await chips.count();
  if (n === 0) {
    console.log('      ! no .o-gantt-chip in the preview — the human filter beat is skipped');
    return 0;
  }
  let clicked = 0;
  for (const idx of [1, 2, 0].filter((i) => i < n)) {
    await clickAt(page, chips.nth(idx), 620);
    clicked++;
    await hold(1700);
  }
  await park(page);
  return clicked;
}

async function handoffClose(page, base, draftPath) {
  mark('CLOSE — the hand-off');
  await page.goto(`${base}/folio/`);
  await waitConnected(page);
  await hold(600);

  /* The human drops the half-made deck onto the stage. dragenter/dragover/drop are dispatched
     with a real DataTransfer carrying a real File, so the app's own handler runs: the veil
     flashes and shell.ts reads the file exactly as it would from a desktop drag. */
  const text = await readFile(draftPath, 'utf8');
  await glide(page, 940, 600, 780);
  await page.evaluate(async (payload) => {
    const stage = document.getElementById('stage');
    const dt = new DataTransfer();
    dt.items.add(new File([payload], 'weekly-review-w36.origami.html', { type: 'text/html' }));
    const ev = (type) => new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 940, clientY: 600 });
    stage.dispatchEvent(ev('dragenter'));
    stage.dispatchEvent(ev('dragover'));
    await new Promise((r) => setTimeout(r, 850));
    stage.dispatchEvent(ev('drop'));
  }, text);
  await page.getByTestId('deck-name').filter({ hasText: 'Weekly review' }).waitFor({ timeout: 10_000 });
  await park(page);
  await settle(page, 1100);

  // the agent reads the human's file, then STAGES a finishing edit rather than applying it
  const toc = await drive(page, 'list_chunks', {}, 'read the human deck');
  await settle(page, 1500);
  const rough = toc.chunks.find((c) => /tidy up/i.test(c.label ?? '')) ?? toc.chunks[toc.chunks.length - 1];
  await drive(page, 'propose_chunk', { chunkId: rough.id, html: HANDOFF_FINISHED_FOLD, ...HANDOFF_PROPOSAL }, 'PROPOSE the finishing edit');
  await page.getByTestId('proposal-card').waitFor();
  await hold(1500);

  // …and a HUMAN accepts it, by hand, on camera
  await clickAt(page, page.getByTestId('accept-proposal'), 800);
  await page.getByTestId('proposal-card').waitFor({ state: 'detached' });
  await park(page);
  await settle(page, 1300);

  await drive(page, 'save_deck', {}, 'save the finished deck');
  await settle(page, 1200);
  return (await drive(page, 'export_deck', {}, 'take the finished bytes')).text;
}

async function standaloneAndEndCard(page, deckText) {
  mark('CLOSE — the file, standing on its own');
  const file = join(WORK, 'weekly-review-finished.origami.html');
  await writeFile(file, deckText, 'utf8');
  await page.goto(`file:///${file.replace(/\\/g, '/')}`);
  await page.locator('.o-present-btn').waitFor({ timeout: 10_000 });
  await hold(700);

  const state = { presented: false, bare: false };
  try {
    // the deck opens on its COVER and stays there — the close shows nothing the reel already showed
    await clickAt(page, page.locator('.o-present-btn'), 700);
    await page.waitForFunction(() => document.documentElement.classList.contains('o-present'), null, { timeout: 4000 });
    state.presented = true;
    await hold(700);

    /* The chrome does not leave on its own. vendor/runtime-dist: a pointerdown on `.o-top`
       followed by a move UP of more than 24 px adds `o-chrome-hidden`. The same handler REVEALS
       it again the moment a move lands at clientY <= 4, so the drag must stop short of the top
       edge — ending it at y=0 is what silently undid this on take 2. */
    const top = await page.locator('.o-top').boundingBox();
    const startY = Math.round(top.y + top.height - 6);
    await glide(page, 940, startY, 600);
    await page.mouse.down();
    for (const y of [startY - 8, startY - 20, startY - 34, 22, 20]) {
      await page.mouse.move(940, y);
      await page.evaluate(([x, yy]) => window.__cursor(x, yy), [940, y]);
      await sleep(55);
    }
    await page.mouse.up();
    mouse = { x: 940, y: 20 };
    // a press-and-drag across text leaves a browser text selection painted over the cover; it is
    // an artefact of driving the gesture, not part of the deck, so the camera clears it
    await page.evaluate(() => {
      document.getSelection()?.removeAllRanges();
      document.activeElement?.blur?.();
    });
    state.bare = await page.evaluate(() => document.documentElement.classList.contains('o-chrome-hidden'));
    await glide(page, 1420, 880, 560);
    await hold(2000); // deliberate hold #1
    await page.keyboard.press('Escape'); // reveals the chrome
    await sleep(280);
    await page.keyboard.press('Escape'); // leaves present mode
    await hold(500);
  } catch (e) {
    console.log(`      ! Present beat incomplete: ${String(e).split('\n')[0]}`);
  }
  console.log(`      · presented: ${state.presented}   deck chrome hidden: ${state.bare}`);

  mark('end card');
  await page.goto(`file:///${join(HERE, 'end-card.html').replace(/\\/g, '/')}`);
  await page.evaluate(() => window.__cursor(-300, -300));
  await hold(3600); // deliberate hold #2
  return state;
}

/* ---------------------------------------------------------------- Chrome ------------------ */

/** Launch the INSTALLED stable Chrome with WebMCP on, in a throwaway profile under the scratchpad. */
async function launchChrome(recordDir) {
  const profile = await mkdtemp(join(WORK, 'chrome-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
    args: CHROME_ARGS,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    ...(recordDir ? { recordVideo: { dir: recordDir, size: { width: W, height: H } } } : {}),
  });
  const version = ctx.browser()?.version() ?? '0';
  if (Number(version.split('.')[0]) < 146) {
    await ctx.close();
    throw new Error(`installed Chrome is ${version}; WebMCP needs >= 146`);
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  return { ctx, page, version, profile };
}

async function dropProfile(dir) {
  // Chrome on Windows keeps a handle on the profile for a while after close
  for (let i = 0; i < 10; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300 * (i + 1));
    }
  }
}

/* ---------------------------------------------------------------- setup pass -------------- */

/**
 * Off camera: build the half-made human deck, and read the deck theme's real token values.
 *
 * The palette matters. set_deck_meta MERGES the tokens it is given onto the ones in force, so
 * flipping to copper and back needs the exact set the deck started with — and that set lives in
 * the deck's own <style id="origami-theme-css">, not in this repo's source. Reading it here keeps
 * the recorded take free of a call that would change nothing a viewer could see.
 */
async function setupPass(base) {
  const { ctx, page, version, profile } = await launchChrome(null);
  try {
    await page.goto(`${base}/folio/`);
    await waitConnected(page);
    const pill = await page.getByTestId('mcp-status').textContent();
    console.log(`  Chrome ${version} — ${pill}`);
    if (!/connected via document\.modelContext/.test(pill ?? '')) {
      throw new Error(`the native WebMCP surface did not come up: "${pill}"`);
    }

    const refs = {};
    for (const step of HANDOFF_BUILD) {
      const body = await drive(page, step.tool, bindRefs(step.args, refs), step.note);
      learnRefs(step.tool, body, refs);
    }
    const draft = (await drive(page, 'export_deck', {}, 'the human saves it')).text;
    const out = join(WORK, 'weekly-review-draft.origami.html');
    await writeFile(out, draft, 'utf8');

    // a throwaway deck, purely to read the stock palette off the format itself
    await drive(page, 'create_deck', { title: 'palette probe', discard: true }, 'read the stock palette');
    const meta = await drive(page, 'set_deck_meta', { themeName: 'origami-default' }, '(off camera)');
    const palette = meta.theme.tokens;
    console.log(`  draft deck: ${out} (${draft.length.toLocaleString()} bytes); palette tokens: ${Object.keys(palette).length}`);
    return { draftPath: out, palette, version };
  } finally {
    await ctx.close().catch(() => {});
    await dropProfile(profile);
  }
}

/* ---------------------------------------------------------------- plumbing ---------------- */

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${(r.stderr ?? '').slice(-1200)}`);
  return r.stdout;
}

/* ---------------------------------------------------------------- main -------------------- */

async function main() {
  await mkdir(WORK, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(REPO, 'tests/e2e/static-server.mjs'), String(port)], { stdio: 'ignore' });
  await sleep(800);
  console.log(`\n  serving dist/ on ${base}   pace x${PACE}   embedded image ${IMAGE_BYTES} bytes\n`);

  let videoPath = null;
  let session = null;
  const errors = [];
  let railAgent = 0;
  let railHuman = 0;
  let chips = 0;
  let present = { presented: false, bare: false };
  let scrollProof = null;

  try {
    const { draftPath, palette, version } = await setupPass(base);

    const videoDir = join(WORK, 'video');
    await rm(videoDir, { recursive: true, force: true });
    session = await launchChrome(videoDir);
    const page = session.page;
    await page.addInitScript(cursorScript);
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
    const video = page.video();
    if (!video) throw new Error('the chrome channel produced no video — STOP, do not fall back to a shim');

    const tRecord = Date.now();
    await preroll(page, base);
    T0 = Date.now();
    lead = (T0 - tRecord) / 1000;
    await coldOpen(page, base);
    await folioAct1(page, palette);
    railAgent = await page.locator('[data-testid="activity-row"][data-source="agent"]').count();
    await folioAct2(page);

    await mini(page, base, '/draw/', DRAW_SCENE, 'DRAW', 1380);
    await mini(page, base, '/charts/', CHARTS_SCENE, 'CHARTS', 2000);
    await mini(page, base, '/gantt/', GANTT_SCENE, 'GANTT', 1950);
    chips = await ganttHumanBeat(page);
    await play(page, GANTT_SAVE, {}, 1650);

    const deckText = await handoffClose(page, base, draftPath);
    railHuman = await page.locator('[data-testid="activity-row"][data-source="human"]').count();
    present = await standaloneAndEndCard(page, deckText);
    mark('END');
    scrollProof = { version };

    console.log(`\n  transport:  Chrome ${version}, document.modelContext.executeTool — ${calls} calls, no shim`);
    console.log(`  rail:       ${railAgent} agent rows after act 1, ${railHuman} human rows at the close`);
    console.log(`  gantt chips clicked: ${chips}   present: ${present.presented}   chrome hidden: ${present.bare}`);
    if (errors.length) console.log(`  PAGE ERRORS (${errors.length}): ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
    else console.log('  page errors: none');

    await session.ctx.close();
    videoPath = await video.path();
    await dropProfile(session.profile);
    session = null;
  } finally {
    if (session) {
      await session.ctx.close().catch(() => {});
      await dropProfile(session.profile);
    }
    server.kill();
  }

  if (!videoPath || !existsSync(videoPath)) throw new Error('Playwright wrote no video');

  await copyFile(videoPath, OUT_WEBM);
  run('ffmpeg', [
    // -ss BEFORE -i drops the recorder's lead-in, so frame one of the cut is the flower
    '-y', '-ss', lead.toFixed(3), '-i', OUT_WEBM,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-vf', `scale=${W}:${H}`, '-fps_mode', 'cfr', '-r', '30',
    '-movflags', '+faststart', '-an', OUT_MP4,
  ]);

  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', OUT_MP4]));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const dur = Number(probe.format.duration);

  const sheet = join(WORK, 'reel-sheet.png');
  run('ffmpeg', ['-y', '-i', OUT_MP4, '-vf', 'fps=1/2,scale=480:-1,tile=8x10', '-frames:v', '1', sheet]);
  const shots = [];
  for (const [i, m] of marks.entries()) {
    if (m.label === 'END') continue;
    const at = Math.min(dur - 0.5, m.at + 2.5);
    const png = join(WORK, `reel-scene-${String(i).padStart(2, '0')}-${m.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    run('ffmpeg', ['-y', '-ss', String(at), '-i', OUT_MP4, '-frames:v', '1', '-q:v', '2', png]);
    shots.push(png);
  }
  await writeFile(
    join(WORK, 'marks.json'),
    JSON.stringify({ marks, lead, duration: dur, calls, railAgent, railHuman, chips, present, ...scrollProof }, null, 2),
    'utf8'
  );

  console.log('\n  ' + '='.repeat(70));
  console.log(`  mp4:       ${OUT_MP4}`);
  console.log(`  webm:      ${OUT_WEBM}`);
  console.log(`  duration:  ${dur.toFixed(2)}s   ${v.width}x${v.height}   ${v.codec_name} / ${v.pix_fmt}`);
  console.log(`  budget:    ${dur >= 145 && dur <= 155 ? 'IN (145-155s)' : 'OUT OF BUDGET'}`);
  console.log(`  sheet:     ${sheet}`);
  console.log(`  frames:    ${shots.length} scene stills in ${WORK}`);
  console.log('  ' + '='.repeat(70) + '\n');
}

main().catch((e) => {
  console.error(`\n  REEL FAILED: ${e.message}\n`);
  process.exit(1);
});
