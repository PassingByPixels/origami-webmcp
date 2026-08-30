import { expect, test, type Page } from '@playwright/test';

/* Real Chromium, the real dist/ build, the real sample Fold. Nothing is stubbed: the tools
   run in the page, the preview is the deck rendering itself on its own embedded engine. */

/** Drive one tool through the test console exactly as a human would, and return its result. */
async function invoke(page: Page, tool: string, args: unknown): Promise<any> {
  await page.getByTestId(`tool-${tool}`).click();
  await expect(page.getByTestId('tool-name')).toHaveText(tool);
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2));
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText(/ok|error/);
  const text = await page.getByTestId('tool-result').textContent();
  return { state: await page.getByTestId('run-state').textContent(), body: JSON.parse(text!) };
}

const preview = (page: Page) => page.frameLocator('[data-testid="preview"]').locator('body');

async function openSample(page: Page) {
  await page.goto('/index.html');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await expect(page.getByTestId('deck-name')).toContainText('welcome.origami.html');
}

test.beforeEach(async ({ page }) => {
  // a leftover autosave from a previous spec must not change what the next one opens
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('boots with the tools registered and reports the WebMCP surface honestly', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByTestId('tool-count')).toHaveText('22');
  // plain Chromium, no --enable-features flag: the status line must SAY so rather than pretend
  await expect(page.getByTestId('mcp-status')).toContainText('WebMCP: not available (console only)');
  await expect(page.getByTestId('mcp-status')).toContainText('22 tools registered locally');
  // an agent can run the whole loop, review included
  for (const name of ['propose_chunk', 'accept_proposal', 'reject_proposal', 'save_deck', 'define_block', 'add_custom_fold']) {
    await expect(page.getByTestId(`tool-${name}`), name).toBeVisible();
  }
  // the filesystem-bound trio stays out
  for (const name of ['list_decks', 'open_deck', 'refresh_sources']) {
    await expect(page.getByTestId(`tool-${name}`), name).toHaveCount(0);
  }
});

test('opens the sample Fold and renders it in the sandboxed iframe', async ({ page }) => {
  await openSample(page);
  // the deck renders itself: text from the sample file reaches the frame
  await expect(preview(page)).toContainText(/\S/);
  const sandbox = await page.getByTestId('preview').getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts');
  expect(sandbox).not.toContain('allow-same-origin');
});

test('list_chunks then write_chunk from the console re-renders the preview', async ({ page }) => {
  await openSample(page);

  const toc = await invoke(page, 'list_chunks', {});
  expect(toc.state).toContain('ok');
  expect(toc.body.chunks.length).toBeGreaterThan(0);
  const first = toc.body.chunks[0].id;

  const marker = `Written by Playwright ${Date.now()}`;
  const written = await invoke(page, 'write_chunk', {
    chunkId: first,
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2><p class="lede">Straight from the test console.</p></div>`,
  });
  expect(written.state).toContain('ok');
  expect(written.body.applied).toBe(first);

  // THE assertion: the deck the human is looking at now shows the new text
  await expect(preview(page)).toContainText(marker);
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
});

test('a policy violation is refused and the preview is untouched', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks', {});
  const first = toc.body.chunks[0].id;

  const marker = `Good content ${Date.now()}`;
  await invoke(page, 'write_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });
  await expect(preview(page)).toContainText(marker);

  const bad = await invoke(page, 'write_chunk', {
    chunkId: first,
    html: '<div class="slide-inner"><h2>Smuggled</h2><template>nope</template></div>',
  });
  expect(bad.state).toContain('error');
  expect(bad.body.error).toContain('would break the deck structure');
  expect(bad.body.violations.length).toBeGreaterThan(0);
  // rejected means rejected: the earlier content is still on screen
  await expect(preview(page)).toContainText(marker);
  await expect(preview(page)).not.toContainText('Smuggled');
});

test('propose_chunk raises a review card that only the human applies', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks', {});
  const first = toc.body.chunks[0].id;
  await expect(page.getByTestId('proposal-count')).toHaveText('0');

  const marker = `Proposed by an agent ${Date.now()}`;
  const staged = await invoke(page, 'propose_chunk', {
    chunkId: first,
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2></div>`,
    title: 'Rewrite the opening fold',
    author: 'agent:playwright',
  });
  expect(staged.state).toContain('ok');

  // the card is there, the deck is NOT changed
  const card = page.getByTestId('proposal-card');
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId('proposal-count')).toHaveText('1');
  await expect(card).toContainText('Rewrite the opening fold');
  await expect(card).toContainText('agent:playwright');
  await expect(card).toContainText('edit');
  await expect(preview(page)).not.toContainText(marker);

  // the human accepts
  await page.getByTestId('accept-proposal').click();
  await expect(preview(page)).toContainText(marker);
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  await expect(page.getByTestId('proposal-count')).toHaveText('0');
  await expect(page.getByTestId('app-message')).toContainText(`Accepted: edit on ${first}`);
});

test('Reject drops a proposal and leaves the Fold alone', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks', {});
  const first = toc.body.chunks[0].id;

  const marker = `Never applied ${Date.now()}`;
  await invoke(page, 'propose_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);

  await page.getByTestId('reject-proposal').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  await expect(preview(page)).not.toContainText(marker);

  const queue = await invoke(page, 'list_proposals', {});
  expect(queue.body.proposals).toHaveLength(0);
});

test('a refresh mid-edit offers the unsaved work back', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks', {});
  const marker = `Survives a refresh ${Date.now()}`;
  await invoke(page, 'write_chunk', {
    chunkId: toc.body.chunks[0].id,
    html: `<div class="slide-inner"><h2>${marker}</h2></div>`,
  });
  // autosave is debounced (700 ms) — wait for the record rather than for a fixed delay
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('origami-webmcp:autosave/v1') !== null), { timeout: 5000 })
    .toBe(true);

  await page.reload();
  await expect(page.getByTestId('empty-state')).toBeVisible();
  const resume = page.getByTestId('btn-resume');
  await expect(resume).toBeVisible();

  await resume.click();
  await expect(preview(page)).toContainText(marker);
  await expect(page.getByTestId('btn-resume')).toBeHidden();
});

test('create_deck mints a blank Fold in the tab and add_chunk extends it', async ({ page }) => {
  await page.goto('/index.html');
  const created = await invoke(page, 'create_deck', { title: 'Playwright Deck' });
  expect(created.state).toContain('ok');
  expect(created.body.title).toBe('Playwright Deck');
  await expect(page.getByTestId('deck-name')).toContainText('playwright-deck.origami.html');
  await expect(preview(page)).toContainText('New fold');

  const marker = `Second fold ${Date.now()}`;
  const added = await invoke(page, 'add_chunk', {
    label: 'Second',
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2></div>`,
  });
  expect(added.body.index).toBe(1);

  const toc = await invoke(page, 'list_chunks', {});
  expect(toc.body.chunks.map((c: any) => c.label)).toEqual(['Cover', 'Second']);
});
