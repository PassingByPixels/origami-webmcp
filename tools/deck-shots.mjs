/* Screenshot every fold of a .origami.html file, one PNG per fold, at a stated viewport.
   Usage: node tools/deck-shots.mjs <deck.origami.html> <outDir> [width height]
   Navigation uses the runtime's own viewer (window.__origami.viewer.go), the same hook the
   preview bridge uses, so what is captured is what a reader sees. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , deckPath, outDir, w = '1280', h = '720'] = process.argv;
if (!deckPath || !outDir) {
  console.error('usage: node tools/deck-shots.mjs <deck.origami.html> <outDir> [width height]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(pathToFileURL(resolve(deckPath)).href);
await page.waitForFunction(() => !!(window.__origami || window.__folio), { timeout: 10_000 });
await page.waitForTimeout(600);
const total = await page.evaluate(() => (window.__origami || window.__folio).viewer.visibleOrder.length);
const count = total || 1;
for (let i = 0; i < count; i++) {
  await page.evaluate((n) => (window.__origami || window.__folio).viewer.go(n), i);
  await page.waitForTimeout(450);
  const file = resolve(outDir, `fold-${i + 1}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
