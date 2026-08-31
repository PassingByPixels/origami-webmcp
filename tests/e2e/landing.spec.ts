import { expect, test, type Page } from '@playwright/test';
import { DEMO_CALLS, DEMO_FOLDS } from '../../src/app/demo-script.js';

/**
 * The landing and the replay — the two things a first-time visitor meets.
 *
 * Real Chromium, the real dist/ build. The replay is not stubbed anywhere: the button drives
 * the SAME recorded call list `npm run demo` plays through Chrome's native WebMCP surface,
 * through the same registry, and the folds it makes are the deck rendering itself.
 *
 * `?replayDelay=<ms>` is the app's own test hook (src/app/main.ts) — it changes the pacing and
 * nothing else, so these tests prove the real path without sitting through eleven seconds of it.
 */

const foldIndex = (page: Page) => page.getByTestId('preview').getAttribute('data-fold-index');
const replayRows = (page: Page) => page.locator('[data-testid="activity-row"][data-source="replay"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/folio/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('the landing says what a Fold is and offers the three ways in', async ({ page }) => {
  await page.goto('/folio/index.html');
  const empty = page.getByTestId('empty-state');
  await expect(empty).toBeVisible();
  await expect(empty.locator('h1')).toHaveText('Open a Fold.');
  await expect(empty).toContainText('single .origami.html files that play anywhere');
  await expect(empty).toContainText('Nothing leaves this machine.');

  // the three ways in, on one row
  await expect(page.getByTestId('btn-replay')).toContainText('Watch an agent build a deck');
  await expect(page.getByTestId('btn-sample')).toBeVisible();
  await expect(page.getByTestId('btn-blank')).toBeVisible();

  // the quiet line opens the SAME agent-access card the status dot owns — not a second copy
  await expect(page.getByTestId('mcp-popover')).toBeHidden();
  await page.getByTestId('btn-connect').click();
  await expect(page.getByTestId('mcp-popover')).toBeVisible();
  await expect(page.getByTestId('mcp-popover')).toContainText('WebMCP');
});

test('the landing fits its column at 1440 and at 860, with no sideways scroll', async ({ page }) => {
  /* The action row is three buttons wide. At 860 the rail is still beside the stage, so the
     column it has to fit in is ~500px — the row must WRAP rather than push the page sideways. */
  for (const width of [1440, 860]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/folio/index.html');
    await expect(page.getByTestId('empty-state')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: (() => {
        const el = document.getElementById('stage')!;
        return el.scrollWidth - el.clientWidth;
      })(),
    }));
    expect(overflow.doc, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    expect(overflow.stage, `the stage scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);

    // and the buttons are all reachable — a wrapped row is fine, a clipped one is not
    for (const id of ['btn-replay', 'btn-sample', 'btn-blank']) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x, `${id} starts off-screen at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${id} runs off the right at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
});

test('the landing never grows over the tool console', async ({ page }) => {
  /* THE regression this landing caused once: a stage that will not shrink below its content
     pushed itself down over the console — and, being position:relative, painted on top of the
     tool list and ate every click on it. A short window with the console open is where it bit. */
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/folio/index.html');
  await page.getByTestId('console-toggle').click();
  await expect(page.getByTestId('tool-list')).toBeVisible();

  const stage = (await page.locator('#stage').boundingBox())!;
  const list = (await page.getByTestId('tool-list').boundingBox())!;
  expect(stage.y + stage.height, 'the stage overlaps the console').toBeLessThanOrEqual(list.y + 1);

  // and the proof that matters: a tool in the list still takes the click
  await page.getByTestId('tool-list_chunks').click();
  await expect(page.getByTestId('tool-name')).toHaveText('list_chunks');
});

test('the replay builds the recorded deck, and every call lands in the feed as a replay', async ({ page }) => {
  await page.goto('/folio/index.html?replayDelay=0');
  await page.getByTestId('btn-replay').click();

  await expect(page.getByTestId('app-message')).toContainText(
    `Built by replaying ${DEMO_CALLS.length} recorded tool calls — every step is in the Activity feed.`,
    { timeout: 30_000 }
  );

  // the deck the tools built: the demo's six folds, rendering themselves
  const frame = page.frameLocator('[data-testid="preview"]');
  await expect(frame.locator('.o-tab')).toHaveCount(DEMO_FOLDS);
  expect(DEMO_FOLDS).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('deck-name')).toHaveText('A Fold, Written by an Agent');

  // every recorded call is one row, and each is labelled as the replay — not as an agent
  await expect(replayRows(page)).toHaveCount(DEMO_CALLS.length);
  await expect(page.locator('[data-testid="activity-row"][data-source="agent"]')).toHaveCount(0);

  // the review loop really ran: the ACCEPTED cover wording is the one on screen
  await expect(frame.locator('body')).toContainText('Nothing was uploaded. No server saw it.');
});

test('the preview follows the replay to the fold each call touched', async ({ page }) => {
  /* At the replay's own 900 ms pace — and at any pace a human could watch — the preview walks
     the deck as it is built. MEASURED at three delays: at 120 ms the frame reports
     0,0,0,1,2,3,0,0,4,5 (the dip back to 0 is the accepted proposal, which edits the cover),
     and it ends on the last fold. At the test hook's `replayDelay=0` it stays on fold 1: the
     srcdoc swaps land faster than the frame can load and report its position, so the follow
     has nothing to answer. That is the pre-existing bridge behaviour, not the replay's, and
     0 ms is not a pace anyone watches — so the follow is proven here at a real one. */
  await page.goto('/folio/index.html?replayDelay=120');
  await page.getByTestId('btn-replay').click();

  // it leaves the cover while the deck is still being written
  await expect.poll(async () => Number((await foldIndex(page)) ?? -1), { timeout: 25_000 }).toBeGreaterThan(0);

  await expect(page.getByTestId('app-message')).toContainText('Built by replaying', { timeout: 30_000 });
  await expect.poll(() => foldIndex(page), { timeout: 10_000 }).toBe(String(DEMO_FOLDS - 1));
});

test('Stop ends the replay where it stands and keeps what it built', async ({ page }) => {
  await page.goto('/folio/index.html?replayDelay=400');
  await expect(page.getByTestId('replaybar')).toBeHidden();
  await page.getByTestId('btn-replay').click();

  // let it get a few folds in, so stopping proves it stopped rather than never started
  await expect(page.getByTestId('replaybar')).toBeVisible();
  await expect.poll(async () => await replayRows(page).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await page.getByTestId('btn-stop-replay').click();

  const stoppedAt = await replayRows(page).count();
  expect(stoppedAt).toBeLessThan(DEMO_CALLS.length); // it really was mid-run
  await expect(page.getByTestId('replaybar')).toBeHidden();
  await expect(page.getByTestId('app-message')).toContainText(`Replay stopped after ${stoppedAt} of ${DEMO_CALLS.length} calls`);

  // nothing more is invoked after the click — three step-lengths later the feed is where it was
  await page.waitForTimeout(1400);
  expect(await replayRows(page).count()).toBe(stoppedAt);

  // and what it managed to build is still open, not rolled back
  await expect(page.getByTestId('deck-name')).toHaveText('A Fold, Written by an Agent');
  await expect(page.frameLocator('[data-testid="preview"]').locator('.o-tab').first()).toBeVisible();
});
