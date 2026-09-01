import { expect, test, type Page } from '@playwright/test';

/**
 * The tool console's two new halves: the GROUPED list, and the argument FORM.
 *
 * The rule the form must never break — the JSON textarea is what gets sent. So every check
 * here ends by reading that box, not by trusting the controls.
 */

async function openConsole(page: Page): Promise<void> {
  const toggle = page.getByTestId('console-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('tool-list')).toBeVisible();
}

/** The textarea's value, read without an actionability check — it is hidden in Form mode. */
const argsJson = (page: Page) => page.getByTestId('tool-args').evaluate((el) => (el as HTMLTextAreaElement).value);

async function pick(page: Page, tool: string): Promise<void> {
  await openConsole(page);
  await page.getByTestId(`tool-${tool}`).click();
  await expect(page.getByTestId('tool-name')).toHaveText(tool);
}

/** Type a call in JSON, read it back through the form, and return what the box then holds. */
async function roundTrip(page: Page, tool: string, args: Record<string, unknown>): Promise<unknown> {
  await pick(page, tool);
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2));
  await page.getByTestId('btn-mode-form').click();
  await expect(page.getByTestId('btn-mode-form'), `${tool}: the form refused the JSON`).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('btn-mode-json').click();
  return JSON.parse(await argsJson(page));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/folio/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('the tool list is grouped by what a call is for, and a grouped tool still invokes', async ({ page }) => {
  await page.goto('/folio/index.html');
  await openConsole(page);

  // the four headers from the design spec, in order, in the same list as the tools
  const headers = page.locator('.tool-group');
  await expect(headers).toHaveText(['Learn', 'Author', 'Review', 'File']);
  // every registered tool is under one of them — a tool the grouping forgot would appear
  // under "Other", and nothing may be missing from the list at all
  const count = Number(await page.getByTestId('tool-count').textContent());
  await expect(page.locator('.tool-list button[data-tool]')).toHaveCount(count);
  await expect(page.getByTestId('tool-group-other')).toHaveCount(0);

  // a tool in the FILE group runs, and lands in the feed — the grouping is presentation only
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-create_deck').click();
  await page.getByTestId('tool-args').fill('{"title":"Grouped Deck","discard":true}');
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText('ok');

  await page.getByTestId('tool-export_deck').click();
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText('ok');
  await expect(page.getByTestId('tool-result')).toContainText('grouped-deck.origami.html');
});

test('a call typed as JSON survives a trip through the form unchanged', async ({ page }) => {
  /* No registered tool carries a string, an integer AND an enum at once, so the three tools
     below cover every control the spec names: text, textarea (html), number, checkbox, select
     and a nested-JSON box. Each must come back byte-for-byte as the call that went in. */
  await page.goto('/folio/index.html');

  const created = { title: 'Round Trip', foldType: 'scroll', discard: true }; // string + enum + boolean
  expect(await roundTrip(page, 'create_deck', created)).toEqual(created);
  // and the controls really do hold it — not just the box the form wrote
  await page.getByTestId('btn-mode-form').click();
  await expect(page.getByTestId('field-title')).toHaveValue('Round Trip');
  await expect(page.getByTestId('field-foldType')).toHaveValue('scroll');
  await expect(page.getByTestId('field-discard')).toBeChecked();

  const moved = { chunkId: 's1a2b3c4d', position: 3 }; // string + integer
  expect(await roundTrip(page, 'move_chunk', moved)).toEqual(moved);
  await page.getByTestId('btn-mode-form').click();
  await expect(page.getByTestId('field-position')).toHaveValue('3');

  const staged = { chunkId: 's1a2b3c4d', mode: 'delete', author: 'agent:test' }; // enum + strings
  expect(await roundTrip(page, 'propose_delete', staged)).toEqual(staged);

  // the payload kinds: an html textarea and an object box
  const added = { kind: 'free', html: '<div class="slide-inner"><h2>Round trip</h2></div>', position: 1, fields: { a: 1 }, dryRun: true };
  expect(await roundTrip(page, 'add_chunk', added)).toEqual(added);

  // an optional boolean the human never touched stays OUT of the call — a form that posted
  // dryRun:false on every add would be sending a different call from the one on screen
  await pick(page, 'add_chunk');
  expect(JSON.parse(await argsJson(page))).toEqual({});
});

test('what the form is edited to is what gets sent', async ({ page }) => {
  await page.goto('/folio/index.html');
  await pick(page, 'create_deck');

  // Form mode is the default, so this is the plain path: fill a control, press Invoke
  await expect(page.getByTestId('btn-mode-form')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('field-title').fill('Built From The Form');
  await page.getByTestId('field-discard').check();
  expect(JSON.parse(await argsJson(page))).toEqual({ title: 'Built From The Form', discard: true });

  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText('ok');
  await expect(page.getByTestId('deck-name')).toHaveText('Built From The Form');
  // and the call is in the feed as a CONSOLE call, exactly as a hand-typed one is
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'console');
});

test('a half-typed JSON field blocks Invoke instead of sending the last good args', async ({ page }) => {
  /* The nested boxes (object/array properties) are the one place the form can hold something it
     cannot serialize. The JSON box then still holds the PREVIOUS call — so Invoke has to be
     shut, or pressing it would send args the screen no longer shows. */
  await page.goto('/folio/index.html');
  await pick(page, 'set_header');
  await page.getByTestId('field-subtitle').fill('A masthead line');
  await expect(page.getByTestId('btn-invoke')).toBeEnabled();

  await page.getByTestId('field-chips').fill('["one",');
  await expect(page.getByTestId('run-state')).toContainText('"chips" is not valid JSON');
  await expect(page.getByTestId('btn-invoke')).toBeDisabled();

  // finish the value and the console comes back, with what the form now says
  await page.getByTestId('field-chips').fill('["one","two"]');
  await expect(page.getByTestId('btn-invoke')).toBeEnabled();
  expect(JSON.parse(await argsJson(page))).toEqual({ subtitle: 'A masthead line', chips: ['one', 'two'] });
});

test('a call the form cannot show keeps the console in JSON rather than dropping it', async ({ page }) => {
  /* The form is generated from the schema, so an argument the schema does not name has nowhere
     to go. Silently dropping it would send a different call than the one on screen. */
  await page.goto('/folio/index.html');
  await pick(page, 'create_deck');
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill('{"title":"Keep me","unknownKey":42}');

  await page.getByTestId('btn-mode-form').click();
  await expect(page.getByTestId('btn-mode-json')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('run-state')).toContainText('"unknownKey"');
  await expect(page.getByTestId('tool-args')).toBeVisible();
  expect(JSON.parse(await argsJson(page))).toEqual({ title: 'Keep me', unknownKey: 42 });
});
