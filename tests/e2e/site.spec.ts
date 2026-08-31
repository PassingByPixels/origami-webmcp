import { expect, test } from '@playwright/test';

/*
 * The site around the tools (docs/SITE.md): the flower home page, privacy, and the Design
 * coming-soon page. Real Chromium against the real dist/ — the same bytes the zip carries.
 *
 * The three mini tools do not exist yet. This suite pins their hrefs so the slice that builds
 * them plugs into a socket that is already shaped, and says out loud that they 404 today.
 */

const LIVE = ['folio/', 'design/']; // built in this slice
const PENDING = ['draw/', 'charts/', 'gantt/']; // next slice
const BMC = 'https://buymeacoffee.com/passingbypixels';

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

test('the hrefs that are built resolve; the three that are not are exactly the sockets the next slice fills', async ({ page, request }) => {
  await page.goto('/');
  for (const href of LIVE) {
    const res = await request.get(href);
    expect(res.status(), `${href} should be a real page in dist/`).toBe(200);
  }
  for (const href of PENDING) {
    await expect(page.locator(`[data-testid="petal-link"][href="${href}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="tool-card"][href="${href}"]`)).toHaveCount(1);
    // honest about this slice: the mini tools are not built, so these 404 on purpose
    expect((await request.get(href)).status()).toBe(404);
  }
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
  await expect(page.locator('.site-foot .colophon')).toHaveText('Origami Labs · support@origami.gratis');
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
  expect(body).toContain('support@origami.gratis');
  expect(body).toContain('Effective 1 September 2026');
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
  await expect(page.locator('.subbrand')).toHaveText('Folio Web');
});
