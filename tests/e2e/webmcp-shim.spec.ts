import { expect, test, type Page } from '@playwright/test';

/**
 * The connected branch of the WebMCP shim.
 *
 * Stock Chromium has no modelContext, and there is no Canary on the build machine, so the host
 * is stood up in the page before the app boots: a minimal object with the one method the shim
 * uses, recording what it is handed. That tests OUR shim — the probe order, the registration
 * payload and the result envelope an agent would receive — not Chrome's implementation, which
 * is not ours to test. The real-browser claim in README.md is marked untested for that reason.
 */
/** Install a recording host on `document`, on `navigator`, or on both. Each is readable in the
    page as `__mcp_document` / `__mcp_navigator`; `__mcp` aliases the first one installed. */
function installFakeHost(page: Page, where: Array<'document' | 'navigator'>) {
  return page.addInitScript((targets: string[]) => {
    for (const target of targets) {
      const registered: any[] = [];
      const ctx = {
        registered,
        async registerTool(def: any) {
          registered.push(def);
          return undefined;
        },
      };
      (window as any)[`__mcp_${target}`] = ctx;
      (window as any).__mcp ??= ctx;
      Object.defineProperty(target === 'document' ? document : navigator, 'modelContext', {
        value: ctx,
        configurable: true,
      });
    }
  }, where);
}

test('registers every tool on document.modelContext and reports it', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/index.html');

  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 14 tools');

  const defs = await page.evaluate(() =>
    (window as any).__mcp.registered.map((d: any) => ({
      name: d.name,
      hasDescription: typeof d.description === 'string' && d.description.length > 40,
      schemaType: d.inputSchema?.type,
      executable: typeof d.execute === 'function',
    }))
  );
  expect(defs).toHaveLength(14);
  expect(defs.map((d: any) => d.name)).toContain('propose_chunk');
  expect(defs.map((d: any) => d.name)).not.toContain('accept_proposal');
  expect(defs.every((d: any) => d.hasDescription && d.schemaType === 'object' && d.executable)).toBe(true);
});

test('falls back to navigator.modelContext when document has none', async ({ page }) => {
  await installFakeHost(page, ['navigator']);
  await page.goto('/index.html');
  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via navigator.modelContext — 14 tools');
  expect(await page.evaluate(() => (window as any).__mcp_navigator.registered.length)).toBe(14);
});

test('prefers document.modelContext when BOTH surfaces exist', async ({ page }) => {
  await installFakeHost(page, ['document', 'navigator']);
  await page.goto('/index.html');
  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 14 tools');
  // registered once, on the spec surface only — never double-registered across both
  expect(await page.evaluate(() => (window as any).__mcp_document.registered.length)).toBe(14);
  expect(await page.evaluate(() => (window as any).__mcp_navigator.registered.length)).toBe(0);
});

test('a tool called through the host edits the deck the human is watching', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/index.html');
  await expect(page.getByTestId('mcp-status')).toContainText('connected');

  // the "agent" drives the registered execute() callbacks — never the page's own UI
  const call = (name: string, args: unknown) =>
    page.evaluate(
      ([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a),
      [name, args] as const
    );

  const created = JSON.parse((await call('create_deck', { title: 'Agent Deck' })).content[0].text);
  expect(created.title).toBe('Agent Deck');
  await expect(page.getByTestId('deck-name')).toContainText('Agent Deck');

  const marker = `Agent wrote this ${Date.now()}`;
  const written = await call('write_chunk', {
    chunkId: created.chunks[0].id,
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2></div>`,
  });
  expect(written.content[0].type).toBe('text');
  expect(written.isError).toBeFalsy();
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText(marker);

  // and a refusal comes back as an isError envelope, not a thrown exception
  const bad = await call('write_chunk', { chunkId: created.chunks[0].id, html: '<div><template>x</template></div>' });
  expect(bad.isError).toBe(true);
  expect(JSON.parse(bad.content[0].text).error).toContain('would break the deck structure');
});

test('a proposal from the host still needs a human click', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/index.html');
  await expect(page.getByTestId('mcp-status')).toContainText('connected');

  const call = (name: string, args: unknown) =>
    page.evaluate(
      ([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a),
      [name, args] as const
    );

  const created = JSON.parse((await call('create_deck', { title: 'Agent PR' })).content[0].text);
  const marker = `Only after a click ${Date.now()}`;
  await call('propose_chunk', {
    chunkId: created.chunks[0].id,
    html: `<div class="slide-inner"><h2>${marker}</h2></div>`,
    title: 'Agent proposal',
  });

  await expect(page.getByTestId('proposal-card')).toHaveCount(1);
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).not.toContainText(marker);

  // there is no tool the agent could have used to do this itself
  const names = await page.evaluate(() => (window as any).__mcp.registered.map((d: any) => d.name));
  expect(names).not.toContain('accept_proposal');
  expect(names).not.toContain('reject_proposal');

  await page.getByTestId('accept-proposal').click();
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText(marker);
});
