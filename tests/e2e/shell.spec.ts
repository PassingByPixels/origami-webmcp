import { expect, test, type Page } from '@playwright/test';

/**
 * The shell: the Activity rail, the preview bridge, and the two things they must never do —
 * lose the reader's place, or leak a byte of themselves into a saved Fold.
 *
 * Real Chromium, the real dist/ build, the real sample Fold. Nothing here stubs the runtime:
 * the preview is the deck rendering itself, and the bridge drives the deck's OWN viewer.
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
  // the console opens in Form mode; JSON is the mode that takes a call typed by hand
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2));
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText(/ok|error/);
  return JSON.parse((await page.getByTestId('tool-result').textContent())!);
}

/** A recording modelContext host, so a call can be made with the source an AGENT would have. */
function installHost(page: Page) {
  return page.addInitScript(() => {
    const registered: any[] = [];
    Object.defineProperty(document, 'modelContext', {
      value: {
        registered,
        async registerTool(def: any) {
          registered.push(def);
        },
      },
      configurable: true,
    });
    (window as any).__mcp = (document as any).modelContext;
  });
}

const asAgent = (page: Page, name: string, args: unknown = {}) =>
  page
    .evaluate(
      ([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a),
      [name, args] as const
    )
    .then((res: any) => JSON.parse(res.content[0].text));

const foldIndex = (page: Page) => page.getByTestId('preview').getAttribute('data-fold-index');

async function openSample(page: Page) {
  await page.goto('/folio/index.html');
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await expect.poll(() => foldIndex(page), { timeout: 10_000 }).toBe('0');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/folio/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('every route into the tools lands in ONE feed, with the chip and the source that route earns', async ({ page }) => {
  await openSample(page);

  // the human's own open, which no tool made — the page pushes it itself
  const rows = page.getByTestId('activity-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('OPEN');
  await expect(rows.first()).toContainText('"welcome.origami.html"');
  // the chip already says OPEN — a summary that then says "open" again wastes the only line
  // the row has, and reads as a stutter
  await expect(rows.first()).not.toContainText('open —');
  await expect(rows.first()).toHaveAttribute('data-source', 'human');

  // a read-only tool from the console
  const toc = await invoke(page, 'list_chunks');
  const first = toc.chunks[0].id;
  await expect(rows.first()).toContainText('READ');
  await expect(rows.first()).toContainText('list_chunks');
  await expect(rows.first()).toHaveAttribute('data-source', 'console');

  // a write, summarised by the chunk it touched — and NEVER by the html it wrote
  const marker = `Feed check ${Date.now()}`;
  await invoke(page, 'write_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });
  await expect(rows.first()).toContainText('EDIT');
  await expect(rows.first()).toContainText(`write_chunk — ${first}`);
  await expect(rows.first()).not.toContainText(marker);
  await expect(rows.first()).toHaveAttribute('data-source', 'console');

  // a hide reads as HIDE, not DELETE: the two are not the same promise to the human
  const second = toc.chunks[1].id;
  await invoke(page, 'delete_chunk', { chunkId: second, mode: 'hide' });
  await expect(rows.first()).toContainText('HIDE');
  await expect(rows.first()).toContainText(`delete_chunk — hide ${second}`);
});

test('a card resolved by hand lands in the feed as a HUMAN action, not as a silent one', async ({ page }) => {
  /* Accept and Reject go through registry.invoke(..., 'human') rather than straight to the
     proposal store. The store would apply the same change either way — but only the registry
     route records it, and a human resolving a card has to leave the same trail an agent does. */
  await openSample(page);
  const toc = await invoke(page, 'list_chunks');
  const first = toc.chunks[0].id;

  const marker = `Accepted by hand ${Date.now()}`;
  await invoke(page, 'propose_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>`, author: 'agent:feed' });
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);

  await page.getByTestId('accept-proposal').click();
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText(marker);
  const top = page.getByTestId('activity-row').first();
  await expect(top).toContainText('REVIEW');
  await expect(top).toContainText('accept_proposal');
  await expect(top).toHaveAttribute('data-source', 'human');

  // and a rejection is recorded just as loudly — dropping a change is a decision, not a non-event
  await invoke(page, 'propose_chunk', { chunkId: first, html: '<div class="slide-inner"><h2>Never applied</h2></div>' });
  await page.getByTestId('reject-proposal').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  await expect(page.getByTestId('activity-row').first()).toContainText('reject_proposal');
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'human');
});

test('Undo is offered on exactly one entry, reverses the change, and logs itself', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks');
  const first = toc.chunks[0].id;
  const preview = page.frameLocator('[data-testid="preview"]').locator('body');

  const marker = `Undo me ${Date.now()}`;
  await invoke(page, 'write_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });
  await expect(preview).toContainText(marker);

  // two undoable writes are stacked, but undo can only reverse the top of the stack, so exactly
  // ONE button may be on screen — three buttons would promise three reversals it cannot give
  await invoke(page, 'set_chunk_meta', { chunkId: first, label: 'Relabelled' });
  await expect(page.getByTestId('btn-undo')).toHaveCount(1);
  await expect(page.getByTestId('activity-row').first()).toContainText('META');

  await page.getByTestId('btn-undo').click();
  // the undo is itself an entry — the feed shows the reversal, it does not silently rewrite
  await expect(page.getByTestId('activity-row').first()).toContainText('UNDO');
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'human');
  // and the button walked back one step with the stack, onto the write it can still reverse
  await expect(page.getByTestId('btn-undo')).toHaveCount(1);

  await page.getByTestId('btn-undo').click();
  await expect(preview).not.toContainText(marker);
  // the stack is empty now, so nothing may offer an Undo
  await expect(page.getByTestId('btn-undo')).toHaveCount(0);
});

test('clicking a feed entry that names a fold takes the preview there', async ({ page }) => {
  await openSample(page);
  const toc = await invoke(page, 'list_chunks');
  const third = toc.chunks[2].id;

  // a console call does NOT move the view: the person who made it is already looking where
  // they meant to. The row it leaves behind is the way back.
  await invoke(page, 'write_chunk', { chunkId: third, html: '<div class="slide-inner"><h2>Third fold</h2></div>' });
  expect(await foldIndex(page)).toBe('0');

  const row = page.locator(`[data-testid="activity-row"][data-target="${third}"]`).first();
  await row.click();
  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('2');
  await expect(page.frameLocator('[data-testid="preview"]').locator('.o-stage')).toContainText('Third fold');

  // a row that navigates is a control, so the keyboard reaches it too
  await page.locator('[data-testid="preview"]').evaluate((f: HTMLIFrameElement) =>
    f.contentWindow!.postMessage({ type: 'origami-goto', index: 0, id: '' }, '*')
  );
  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('0');
  await row.press('Enter');
  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('2');
});

test('the popovers open, close on a second click, on Escape, and on a click outside', async ({ page }) => {
  await page.goto('/folio/index.html');
  const dot = page.getByTestId('mcp-status');
  const card = page.getByTestId('mcp-popover');
  const menu = page.locator('#save-popover');

  await dot.click();
  await expect(card).toBeVisible();
  await expect(dot).toHaveAttribute('aria-expanded', 'true');
  // the same button closes it again — it is a toggle, not a one-way door
  await dot.click();
  await expect(card).toBeHidden();
  await expect(dot).toHaveAttribute('aria-expanded', 'false');

  await dot.click();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  await dot.click();
  await expect(card).toBeVisible();
  await page.getByTestId('empty-state').click({ position: { x: 5, y: 5 } });
  await expect(card).toBeHidden();

  // and only one card is ever open: the Save menu takes the screen off the status card
  await dot.click();
  await page.getByTestId('btn-savemenu').click();
  await expect(card).toBeHidden();
  await expect(menu).toBeVisible();
});

test('the preview keeps the reader on their fold across a re-render', async ({ page }) => {
  /* THE regression this bridge exists for. Every write re-mounts the whole deck from srcdoc, and
     a fresh mount starts on fold 1 — so before the bridge, an agent editing fold 5 yanked the
     human back to the cover on every call. */
  await openSample(page);
  const toc = await invoke(page, 'list_chunks');

  await page.locator('[data-testid="preview"]').evaluate((f: HTMLIFrameElement) =>
    f.contentWindow!.postMessage({ type: 'origami-goto', index: 3, id: '' }, '*')
  );
  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('3');

  // a write to a DIFFERENT fold, which re-renders everything
  await invoke(page, 'set_chunk_meta', { chunkId: toc.chunks[0].id, label: `Renamed ${Date.now()}` });
  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('3');
});

test('an AGENT write carries the preview to the fold it changed', async ({ page }) => {
  await installHost(page);
  await page.goto('/folio/index.html');
  await page.getByTestId('btn-sample').click();
  await expect.poll(() => foldIndex(page), { timeout: 10_000 }).toBe('0');

  const toc = await asAgent(page, 'list_chunks');
  const fourth = toc.chunks[3].id;
  const marker = `Written by an agent ${Date.now()}`;
  await asAgent(page, 'write_chunk', { chunkId: fourth, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });

  await expect.poll(() => foldIndex(page), { timeout: 5000 }).toBe('3');
  await expect(page.frameLocator('[data-testid="preview"]').locator('.o-stage')).toContainText(marker);
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'agent');
});

test('the preview bridge is in the srcdoc and in NOTHING that gets saved', async ({ page }) => {
  /* The bridge is a script this app injects. If a byte of it ever reached a saved Fold, the app
     would be shipping its own scaffolding inside the human's document. The srcdoc and the save
     path serialize separately, and this is the assertion that keeps them apart. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Bridge Separation', discard: true });
  await invoke(page, 'add_chunk', { starter: 'flowchart' });

  const srcdoc = (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';
  expect(srcdoc, 'the frame the human looks at DOES carry the bridge').toContain('origami-preview-bridge');

  // export_deck hands an agent the same bytes save_deck writes
  const exported = await invoke(page, 'export_deck');
  expect(JSON.stringify(exported)).not.toContain('origami-preview-bridge');

  // and the real file: save_deck banks the whole Fold in OPFS, and this is it coming back out
  const saved = await invoke(page, 'save_deck');
  expect(saved.opfs.written).toBe(true);
  await page.getByTestId('btn-savemenu').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('btn-lastsave').click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');

  expect(Buffer.byteLength(text, 'utf8')).toBe(saved.bytes);
  expect(text, 'the SAVED bytes must carry no trace of the shell').not.toContain('origami-preview-bridge');
  expect(text).toContain('id="origami-manifest"'); // a real Fold, not an empty file
});

test('the bridge is inert in any document that is not a preview frame', async ({ page }) => {
  /* Defence for the bytes escaping by a route the save path does not control. `demo/` builds its
     artifact by reading the preview's srcdoc — bridge included — so a Fold carrying this script
     CAN be opened on its own. When it is, the script must do nothing: no chatter, and above all
     it must not take the Edit button off a document that is not this app's preview. */
  await openSample(page);
  const srcdoc = (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';
  expect(srcdoc).toContain('origami-preview-bridge');

  const solo = await page.context().newPage();
  await solo.setContent(srcdoc); // the same bytes, TOP-LEVEL rather than framed
  await expect(solo.locator('.o-top')).toBeVisible();
  await expect(solo.locator('.o-edit-toggle')).toHaveCount(1);
  await solo.close();
});

test('the deck’s own Edit affordance is taken out of the preview', async ({ page }) => {
  /* MEASURED before it was removed (see preview.ts): clicking ✎ Edit inside the preview turned
     on the runtime's edit mode and its "changes live here until you save a copy" banner, typing
     changed the frame — and the parent's model never heard about it. The very next write tool
     re-rendered the frame and the typing was gone. A control that silently loses the human's
     work is a trap, so the bridge removes it. */
  await openSample(page);
  const frame = page.frameLocator('[data-testid="preview"]');
  await expect(frame.locator('.o-top')).toBeVisible(); // the runtime's chrome IS there
  await expect(frame.locator('.o-edit-toggle')).toHaveCount(0);
  await expect(frame.locator('.o-present-btn')).toHaveCount(1); // and only Edit was taken
});

test('a tool call in flight lights the rail, and settling puts it out', async ({ page }) => {
  await openSample(page);
  await openConsole(page);
  await expect(page.getByTestId('rail-live')).toBeHidden();

  // inspect_render lays the whole deck out in its own frame — a real call with a real duration
  await page.getByTestId('tool-inspect_render').click();
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill('{}');
  await page.getByTestId('btn-invoke').click();

  await expect(page.getByTestId('rail-live')).toBeVisible();
  await expect(page.getByTestId('rail-live')).toContainText('inspect_render');
  await expect(page.getByTestId('run-state')).toContainText(/ok|error/);
  await expect(page.getByTestId('rail-live')).toBeHidden();
});

test('a file that is not a Fold gets a toast that stays until it is dismissed', async ({ page }) => {
  await page.goto('/folio/index.html');

  const dt = await page.evaluateHandle(() => {
    const t = new DataTransfer();
    t.items.add(new File(['<p>not a fold at all</p>'], 'nope.origami.html', { type: 'text/html' }));
    return t;
  });
  await page.dispatchEvent('#stage', 'drop', { dataTransfer: dt });

  const toast = page.getByTestId('app-message');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Not a readable Origami Fold');
  // errors do NOT time out — the old status pill hid itself after 6s whether it had been read
  // or not, which is how a failed save became invisible
  await page.waitForTimeout(6000);
  await expect(toast).toBeVisible();

  // the refusal is in the feed too, as a failed human action
  await expect(page.getByTestId('activity-row').first()).toContainText('OPEN');
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'human');

  await page.getByTestId('toast-dismiss').click();
  await expect(page.getByTestId('toast-dismiss')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible(); // and nothing was opened
});
