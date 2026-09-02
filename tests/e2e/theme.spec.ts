import { expect, test, type Page } from '@playwright/test';

/**
 * The Theme button — the human's way into list_themes / apply_theme / save_theme / delete_theme
 * from the topbar, without a second code path: every click here goes through the SAME registry
 * an agent's call would, so the rail narrates it and Undo works exactly as it does for a console
 * or agent apply_theme.
 *
 * Real Chromium, the real dist/ build, the real sample Fold.
 */

async function openConsole(page: Page): Promise<void> {
  const toggle = page.getByTestId('console-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('tool-list')).toBeVisible();
}

async function invoke(page: Page, tool: string, args: unknown = {}): Promise<any> {
  await openConsole(page);
  await page.getByTestId(`tool-${tool}`).click();
  await expect(page.getByTestId('tool-name')).toHaveText(tool);
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2));
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText(/ok|error/);
  return JSON.parse((await page.getByTestId('tool-result').textContent())!);
}

const foldIndex = (page: Page) => page.getByTestId('preview').getAttribute('data-fold-index');

async function openSample(page: Page) {
  await page.goto('/folio/index.html');
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await expect.poll(() => foldIndex(page), { timeout: 10_000 }).toBe('0');
}

async function themeSrcdocBlock(page: Page): Promise<string> {
  const srcdoc = (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';
  const m = /<style id="origami-theme-css">[\s\S]*?<\/style>/.exec(srcdoc);
  return m ? m[0] : '';
}

test.beforeEach(async ({ page }) => {
  await page.goto('/folio/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('the Theme button reads the deck, offers every preset, applies one through the registry, and Undo reverses it', async ({ page }) => {
  await openSample(page);

  const btn = page.getByTestId('btn-theme');
  const panel = page.getByTestId('theme-popover');

  // welcome.origami.html's own <style id="origami-theme-css"> is the origami-default preset's
  // 14 tokens byte for byte (checked against vendor/runtime-dist's THEMES[0]) — measured, not
  // assumed, by the assertion right below: if that ever drifts the label changes with it.
  await expect(btn).toContainText('Paper');
  await expect(btn).toBeEnabled();

  await btn.click();
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('theme-row');
  // the four runtime presets — a fresh browser (localStorage cleared in beforeEach) has no
  // saved themes yet, so this is the whole catalog
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Paper' })).toHaveAttribute('aria-current', 'true');
  await expect(rows.filter({ hasText: 'Boardroom' })).not.toHaveAttribute('aria-current', 'true');

  // this call is itself routed through the registry as a human READ — it lands in the feed too
  await expect(page.getByTestId('activity-row').first()).toContainText('list_themes');
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'human');

  await rows.filter({ hasText: 'Boardroom' }).click();
  await expect(panel).toBeHidden(); // applying closes the card

  // the preview debounces its re-render (Preview.schedule, 30ms) — poll rather than race it
  await expect
    .poll(() => themeSrcdocBlock(page), { timeout: 5000 })
    .toContain('--accent: #38628F;');

  const top = page.getByTestId('activity-row').first();
  await expect(top).toContainText('apply_theme');
  await expect(top).toHaveAttribute('data-source', 'human');
  await expect(page.getByTestId('btn-undo')).toHaveCount(1);

  await expect(btn).toContainText('Boardroom');

  await page.getByTestId('btn-undo').click();
  await expect(btn).toContainText('Paper');
  await expect.poll(() => themeSrcdocBlock(page), { timeout: 5000 }).toContain('--accent: #3F7268;');
});

test('a theme saved through the console survives a reload and shows up in the popover, tagged saved', async ({ page }) => {
  const saved = await invoke(page, 'save_theme', { name: 'house-navy', label: 'House Navy', tokens: { accent: '#123456' } });
  expect(saved.saved).toBe('house-navy');

  await page.reload();
  await openSample(page);

  await page.getByTestId('btn-theme').click();
  const panel = page.getByTestId('theme-popover');
  await expect(panel).toBeVisible();

  const row = panel.getByTestId('theme-row').filter({ hasText: 'House Navy' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('saved');
  await expect(row.getByTestId('theme-row-delete')).toBeVisible();

  // deleting is a store write, not a Fold edit — no undo is offered for it, and it says so
  await expect(row.getByTestId('theme-row-delete')).toHaveAttribute('title', /cannot be undone/);
  await row.getByTestId('theme-row-delete').click();
  await expect(panel.getByTestId('theme-row').filter({ hasText: 'House Navy' })).toHaveCount(0);
  await expect(panel).toBeVisible(); // deleting keeps the card open, it does not close it
});

test('the button is disabled with no Fold open', async ({ page }) => {
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('btn-theme')).toBeDisabled();
});
