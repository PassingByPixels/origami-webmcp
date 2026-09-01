import { expect, test } from '@playwright/test';

/*
 * The site around the tools (docs/SITE.md): the flower home page, privacy, and the Design
 * coming-soon page. Real Chromium against the real dist/ — the same bytes the zip carries.
 *
 * The three mini tools were the sockets this suite used to pin as deliberate 404s. They are
 * built now (tests/e2e/mini.spec.ts drives them), so the hrefs test below asserts the stronger
 * thing: EVERY href the flower offers resolves, with nothing left pending.
 */

/** Every href the petals and the cards carry. All of them are real pages in dist/. */
const LIVE = ['folio/', 'draw/', 'charts/', 'gantt/', 'design/'];
const BMC = 'https://buymeacoffee.com/passingbypixels';
/* Support moved off a mailbox and onto the Labs site. One address, asserted in both the places
   the site names it: the footer of every page, and the privacy copy. */
const SUPPORT = 'https://origamilabs.nl/support';

test('the flower has eight petals — five links and three left to grow into', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('flower')).toBeVisible();
  await expect(page.getByTestId('petal')).toHaveCount(8);
  await expect(page.getByTestId('petal-link')).toHaveCount(5);
  await expect(page.locator('.petal-idle')).toHaveCount(3);
  // an idle petal is not a link and cannot be tabbed to
  await expect(page.locator('.petal-idle a')).toHaveCount(0);
});

test('every petal href is matched by a tool card with the same href, in the same order', async ({ page }) => {
  await page.goto('/');
  const petals = await page.getByTestId('petal-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const cards = await page.getByTestId('tool-card').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(petals).toEqual(['folio/', 'draw/', 'charts/', 'gantt/', 'design/']);
  expect(cards).toEqual(petals);
});

test('every href the flower offers resolves — no petal points at a 404', async ({ page, request }) => {
  await page.goto('/');
  for (const href of LIVE) {
    // the petal and the card both offer it…
    await expect(page.locator(`[data-testid="petal-link"][href="${href}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="tool-card"][href="${href}"]`)).toHaveCount(1);
    // …and it is a real page in dist/, served the way a static host serves a directory
    const res = await request.get(href);
    expect(res.status(), `${href} should be a real page in dist/`).toBe(200);
    expect(await res.text(), `${href} should be an HTML document`).toContain('<!DOCTYPE html>');
  }
});

/* The flower now lies on a .plate that draws its contact shadows as pseudo-elements. One of
   them is painted AFTER the flower and covers the middle of it, so a petal can be present,
   labelled and correctly linked and still be un-clickable. Only a real click proves it. */
test('a petal is really clickable — the shadows under the flower do not cover it', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-petal="folio"] a').click();
  await expect(page).toHaveURL(/\/folio\/$/);
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

test('the ring alternates, so no two blank petals ever sit side by side', async ({ page }) => {
  await page.goto('/');
  const ring = await page.getByTestId('petal').evaluateAll((els) =>
    els.map((e) => ({
      petal: e.getAttribute('data-petal'),
      angle: Number(/rotate\((-?[\d.]+)/.exec(e.getAttribute('transform') ?? 'rotate(0')![1]),
    })),
  );
  expect(ring).toEqual([
    { petal: 'folio', angle: 0 },
    { petal: 'draw', angle: 45 },
    { petal: 'empty-2', angle: 90 },
    { petal: 'charts', angle: 135 },
    { petal: 'empty-4', angle: 180 },
    { petal: 'gantt', angle: 225 },
    { petal: 'empty-6', angle: 270 },
    { petal: 'design', angle: 315 },
  ]);
  // the requirement itself, read off the ring: a blank never neighbours a blank, wrap included
  const blank = ring.map((r) => r.petal!.startsWith('empty'));
  for (let i = 0; i < blank.length; i++) {
    expect(blank[i] && blank[(i + 1) % blank.length], `petals ${i} and ${(i + 1) % blank.length}`).toBe(false);
  }
});

test('the Design petal is filled pale sage with a dashed crease and a "soon" chip', async ({ page }) => {
  await page.goto('/');
  const design = page.locator('[data-petal="design"]');
  await expect(design.locator('.petal-chip')).toHaveText(/soon/);
  // filled, not hollow — a hole would break the ring
  await expect(design.locator('.facet')).toHaveCount(2);
  const fills = await design.locator('.facet').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(fills.some((f) => f === 'none' || f === null)).toBe(false);
  await expect(design.locator('.crease')).toHaveAttribute('stroke-dasharray', '5 4');
  await expect(page.locator('[data-testid="tool-card"][href="design/"] .tool-chip')).toHaveText('soon');
});

test('every named petal is labelled without a mouse; hover and keyboard focus lift it and mark the label', async ({ page }) => {
  const INK_SOFT = 'rgb(90, 85, 77)'; // --ink-soft
  const ACCENT = 'rgb(85, 122, 78)'; // --accent
  await page.goto('/');

  // permanent labels: the flower names its tools with nothing hovered
  const labels = await page.locator('.petal-label').allTextContents();
  expect(labels).toEqual(['Folio', 'Draw', 'Charts', 'Gantt', 'Design']);
  await expect(page.locator('.petal-idle .petal-label')).toHaveCount(0);

  const folio = page.locator('[data-petal="folio"]');
  const label = folio.locator('.petal-label');
  expect(await label.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await label.evaluate((el) => getComputedStyle(el).fill)).toBe(INK_SOFT);

  await folio.locator('a').hover();
  await expect.poll(() => label.evaluate((el) => getComputedStyle(el).fill)).toBe(ACCENT);
  const lifted = await folio.locator('.lift').evaluate((el) => getComputedStyle(el).transform);
  expect(lifted, 'the petal lifts along its own axis').not.toBe('none');

  // tab to the same petal from the top of the page — a keyboard user gets the same feedback
  await page.mouse.move(0, 0);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Folio') break;
  }
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Folio');
  await expect.poll(() => label.evaluate((el) => getComputedStyle(el).fill)).toBe(ACCENT);
  expect(await folio.locator('.lift').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
});

test('the footer links out to Buy me a coffee as a plain link, and loads nothing from it', async ({ page }) => {
  await page.goto('/');
  const bmc = page.getByTestId('bmc-link');
  await expect(bmc).toHaveAttribute('href', BMC);
  await expect(bmc).toHaveAttribute('target', '_blank');
  await expect(bmc).toHaveAttribute('rel', 'noopener');
  // no widget: nothing on the page fetches anything from buymeacoffee
  const html = await page.content();
  expect(html.match(/buymeacoffee/g)).toHaveLength(1);
  await expect(page.getByTestId('privacy-link')).toHaveAttribute('href', 'privacy/');
  await expect(page.getByTestId('support-link')).toHaveAttribute('href', SUPPORT);
  await expect(page.getByTestId('support-link')).toHaveText('Support');
  await expect(page.locator('.site-foot .colophon')).toHaveText('Origami Labs');
  // the old mailbox is gone from the page, not just from the footer
  expect(await page.content()).not.toContain('support@origami.gratis');
});

for (const width of [1440, 860, 390]) {
  test(`the home page never scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, 'no horizontal overflow').toBeLessThanOrEqual(0);
    await expect(page.getByTestId('flower')).toBeVisible();
    const box = await page.getByTestId('flower').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
  });
}

test('the privacy page states the whole truth in its own words', async ({ page }) => {
  await page.goto('/privacy/');
  await expect(page.locator('h1')).toHaveText('Privacy');
  const body = await page.locator('main').innerText();
  expect(body).toContain('There is no server that belongs to us');
  expect(body).toContain('We run no analytics');
  expect(body).toContain('Your document is never sent to us');
  expect(body).toContain('WebMCP runs inside your browser');
  expect(body).toContain('Questions about it go to origamilabs.nl/support');
  expect(body).toContain('Effective 1 September 2026');
  // the contact is a real link out, not prose a reader has to retype
  await expect(page.getByTestId('support-inline')).toHaveAttribute('href', SUPPORT);
  expect(body).not.toContain('support@origami.gratis');
  await expect(page.locator('.brand')).toHaveAttribute('href', '../');
});

test('the design page promises one thing and shows no fake UI', async ({ page }) => {
  await page.goto('/design/');
  await expect(page.locator('h1')).toHaveText('Origami Design');
  await expect(page.locator('main')).toContainText('A canvas for pages and posters. One file, like everything here. Coming soon.');
  await expect(page.locator('svg.motif')).toBeVisible();
  await expect(page.locator('.backhome')).toHaveAttribute('href', '../');
  await expect(page.locator('button')).toHaveCount(0);
});

test('the Folio app still lives at its own path, with its own shell', async ({ page }) => {
  await page.goto('/folio/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.locator('.subbrand')).toHaveText('Folio');
  // the wordmark is the way home here too (docs/SITE.md: "Every page links home via the brand
  // wordmark") — it was the one tool page whose brand was an inert <div>
  await expect(page.locator('a.brand')).toHaveAttribute('href', '../');
  await expect(page.locator('a.brand')).toBeVisible();
  // and a keyboard reaches it: it is the first stop in the shell, with a visible focus ring
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('brand');
  expect(await page.locator('a.brand').evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('2px');
});

test('the home page points at the Folio browser extension, as a plain link out', async ({ page }) => {
  await page.goto('/');
  const ext = page.getByTestId('extension-link');
  await expect(ext).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/origami-folio/flhbdfakcooaomfaehhgenmmnlglhehk');
  await expect(ext).toHaveAttribute('target', '_blank');
  await expect(ext).toHaveAttribute('rel', 'noopener');
  await expect(ext).toHaveText('get Origami Folio from the Chrome Web Store');
});

test('the home page says the tools run both ways — by hand and by agent', async ({ page }) => {
  await page.goto('/');
  const agents = page.locator('.notes > div', { hasText: 'Agents included' });
  const body = await agents.innerText();
  expect(body).toContain('A human can drive the same tools by hand, on the same page, in the same order.');
  expect(body).toContain('fold a deck yourself — here, or with the extension — then Open it on any tool page');
  // the enable steps stay the column's last line, folded away until they are wanted
  await expect(agents.locator('.connect summary')).toHaveText('Connect your agent');
  expect(body.trim().endsWith('Connect your agent')).toBe(true);
});

test('every card names its action, and Design offers only a look', async ({ page }) => {
  await page.goto('/');
  const actions = await page.locator('[data-testid="tool-card"] .tool-go').allTextContents();
  expect(actions).toEqual(['Open →', 'Open →', 'Open →', 'Open →', 'Take a look →']);
  // the status chips come off the same config row as the petal colours
  for (const href of ['folio/', 'draw/', 'charts/', 'gantt/']) {
    await expect(page.locator(`[data-testid="tool-card"][href="${href}"] .tool-chip`), href).toHaveText('live');
  }
  await expect(page.locator('[data-testid="tool-card"][href="design/"] .tool-chip')).toHaveText('soon');
  // and every card carries its petal's own colour, so a card can never mislabel a tool
  const swatches = await page
    .locator('[data-testid="tool-card"] .tool-swatch')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(swatches).toEqual([
    'rgb(63, 95, 57)', // Folio, accent shaded
    'rgb(138, 69, 34)', // Draw, copper
    'rgb(23, 23, 23)', // Charts, ink
    'rgb(124, 150, 115)', // Gantt, sage
    'rgb(183, 202, 176)', // Design, pale sage
  ]);
});

test('the "start here" note aims at the Folio card, and leaves the page when the desk reflows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const note = page.locator('.note');
  await expect(note).toBeVisible();
  const arrow = (await note.locator('svg').boundingBox())!;
  const folio = (await page.locator('.slot-folio').boundingBox())!;
  // the arrow ends above the Folio card's top edge — over the card horizontally, clear of the
  // name and the LIVE chip vertically
  expect(arrow.y + arrow.height, 'arrowhead sits above the card').toBeLessThan(folio.y);
  expect(arrow.x, 'arrow reaches over the card').toBeGreaterThan(folio.x);
  expect(arrow.x).toBeLessThan(folio.x + folio.width);

  // below 760px the cards are no longer beside the flower, so the arrow would point at nothing
  await page.setViewportSize({ width: 759, height: 900 });
  await expect(note).toBeHidden();
});

test('on a phone the desk stacks: the flower, then the cards in the order the flower names them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const order = await page
    .locator('.desk > *:not(.note):not(.prop-plane)')
    .evaluateAll((els) => els.map((e) => e.className.replace('tool-card ', '')));
  expect(order).toEqual(['slot-flower', 'slot-folio', 'slot-draw', 'slot-charts', 'slot-gantt', 'slot-design']);
  // one column: every card is laid out at the same x. offsetLeft, not the bounding box — the
  // per-card tilt moves the box by a fraction of a pixel and would make this flaky.
  const xs = await page.getByTestId('tool-card').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft));
  expect(new Set(xs).size, `cards share one column, got ${xs}`).toBe(1);
  // the scatter flattens in the hand, but the paper is still not printed square
  const tilts = await page
    .getByTestId('tool-card')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--tilt').trim()));
  expect(tilts).toEqual(['-0.5deg', '0.5deg', '0.5deg', '-0.5deg', '0.5deg']);
});

test('every tool page carries the support slot — one plain link, no widget', async ({ page }) => {
  for (const path of ['/folio/', '/draw/', '/charts/', '/gantt/']) {
    await page.goto(path);
    const slot = page.getByTestId('rail-support');
    await expect(slot, path).toHaveAttribute('href', 'https://buymeacoffee.com/passingbypixels');
    await expect(slot, path).toHaveAttribute('rel', 'noopener');
    await expect(slot, path).toHaveAttribute('target', '_blank');
    await expect(slot, path).toContainText('Coffee helps');
  }
  // the slot is a link and nothing else: no script/iframe/img anywhere near it
  const html = await page.content();
  expect(html).not.toContain('buymeacoffee.com/widget');
});

/* PRESENT. The button belongs to the deck runtime, not to this shell: vendor/runtime-dist
   `present()` adds `html.o-present` and calls `documentElement.requestFullscreen()`. The preview
   frame is sandboxed onto an opaque origin, and a frame with no fullscreen permission rejects
   that call ("Disallowed by permissions policy") while the runtime swallows the error — so the
   button did nothing a reader could see. This drives the REAL button inside the REAL frame and
   asserts both halves of the presented state, on every page that has a preview. */
test("the deck's own Present button really presents, in every tool page's preview", async ({ page }) => {
  // one origin for the whole site, so a Fold left in storage by another spec would decide what
  // these pages open
  await page.goto('/folio/');
  await page.evaluate(() => localStorage.clear());

  for (const path of ['/folio/', '/draw/', '/charts/', '/gantt/']) {
    await page.goto(path);
    // the minis mint their document on load; /folio/ is a landing until a Fold is opened
    if (path === '/folio/') await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('preview'), path).toBeVisible();

    const frame = (await (await page.getByTestId('preview').elementHandle())!.contentFrame())!;
    const present = page.frameLocator('[data-testid="preview"]').locator('.o-present-btn');
    await expect(present, path).toBeVisible();
    expect(await frame.evaluate(() => document.fullscreenElement !== null), `${path} starts unpresented`).toBe(false);

    await present.click();

    // the deck is really fullscreen — not just wearing the class inside a 900px pane
    await expect
      .poll(() => frame.evaluate(() => document.fullscreenElement?.tagName ?? null), { message: `${path} enters fullscreen` })
      .toBe('HTML');
    expect(await frame.evaluate(() => document.documentElement.classList.contains('o-present')), `${path} presented class`).toBe(true);
    expect(
      await frame.evaluate(() => window.innerWidth === screen.width && window.innerHeight === screen.height),
      `${path} fills the screen`,
    ).toBe(true);

    // and Esc comes back out: the runtime's own fullscreenchange handler drops the class with it
    await page.keyboard.press('Escape');
    await expect
      .poll(() => frame.evaluate(() => document.fullscreenElement?.tagName ?? null), { message: `${path} leaves fullscreen` })
      .toBe(null);
    expect(await frame.evaluate(() => document.documentElement.classList.contains('o-present')), `${path} class cleared`).toBe(false);
  }
});
