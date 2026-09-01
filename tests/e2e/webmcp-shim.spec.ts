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
  await page.goto('/folio/index.html');

  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 29 tools');

  const defs = await page.evaluate(() =>
    (window as any).__mcp.registered.map((d: any) => ({
      name: d.name,
      hasDescription: typeof d.description === 'string' && d.description.length > 40,
      schemaType: d.inputSchema?.type,
      executable: typeof d.execute === 'function',
      annotations: d.annotations,
    }))
  );
  expect(defs).toHaveLength(29);
  const names = defs.map((d: any) => d.name);
  // the whole loop is reachable from the host — propose, review, resolve, save
  expect(names).toEqual(
    expect.arrayContaining(['propose_chunk', 'list_proposals', 'accept_proposal', 'reject_proposal', 'save_deck', 'define_block', 'add_custom_fold'])
  );
  expect(names).not.toContain('open_deck'); // filesystem-bound, deliberately absent
  expect(defs.every((d: any) => d.hasDescription && d.schemaType === 'object' && d.executable)).toBe(true);

  /* ANNOTATIONS reach the host. Chrome's own getTools() does not hand them back (measured in
     webmcp-native.spec.ts), so this recording host is the only place the registration payload
     itself can be inspected — without it, "the app sends annotations" would be an untested claim. */
  const byName = Object.fromEntries(defs.map((d: any) => [d.name, d.annotations]));
  expect(byName.origami_guide).toEqual({ readOnlyHint: true });
  expect(byName.inspect_render).toEqual({ readOnlyHint: true });
  expect(byName.list_starters).toEqual({ readOnlyHint: true });
  expect(byName.delete_chunk).toEqual({ destructiveHint: true });
  expect(byName.create_deck).toEqual({ destructiveHint: true });
  expect(byName.write_chunk, 'an unannotated tool must send no annotations key at all').toBeUndefined();
  expect(defs.filter((d: any) => d.annotations?.readOnlyHint)).toHaveLength(10);
  expect(defs.filter((d: any) => d.annotations?.destructiveHint)).toHaveLength(3);
});

test('falls back to navigator.modelContext when document has none', async ({ page }) => {
  await installFakeHost(page, ['navigator']);
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via navigator.modelContext — 29 tools');
  expect(await page.evaluate(() => (window as any).__mcp_navigator.registered.length)).toBe(29);
});

test('prefers document.modelContext when BOTH surfaces exist', async ({ page }) => {
  await installFakeHost(page, ['document', 'navigator']);
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 29 tools');
  // registered once, on the spec surface only — never double-registered across both
  expect(await page.evaluate(() => (window as any).__mcp_document.registered.length)).toBe(29);
  expect(await page.evaluate(() => (window as any).__mcp_navigator.registered.length)).toBe(0);
});

test('a tool called through the host edits the deck the human is watching', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/folio/index.html');
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

/* A proposal has two front doors. Both are exercised here, because both must keep working:
   the human's card for when someone is watching, and the tool for when nobody is. */

test('a HUMAN can resolve a proposal an agent staged, by clicking the card', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('mcp-status')).toContainText('connected');

  const call = agentCaller(page);
  const created = JSON.parse((await call('create_deck', { title: 'Agent PR' })).content[0].text);
  const marker = `Applied by a click ${Date.now()}`;
  await call('propose_chunk', {
    chunkId: created.chunks[0].id,
    html: `<div class="slide-inner"><h2>${marker}</h2></div>`,
    title: 'Agent proposal',
    author: 'agent:shim',
  });

  await expect(page.getByTestId('proposal-card')).toHaveCount(1);
  await expect(page.getByTestId('proposal-card')).toContainText('agent:shim');
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).not.toContainText(marker);

  await page.getByTestId('accept-proposal').click();
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText(marker);
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
});

test('an AGENT can resolve its own proposal with accept_proposal — no click anywhere', async ({ page }) => {
  await installFakeHost(page, ['document']);
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('mcp-status')).toContainText('connected');

  const call = agentCaller(page);
  const created = JSON.parse((await call('create_deck', { title: 'Unattended PR' })).content[0].text);
  const marker = `Applied by the agent ${Date.now()}`;
  const staged = JSON.parse(
    (
      await call('propose_chunk', {
        chunkId: created.chunks[0].id,
        html: `<div class="slide-inner"><h2>${marker}</h2></div>`,
        author: 'agent:shim',
      })
    ).content[0].text
  );
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);

  const accepted = JSON.parse((await call('accept_proposal', { proposalId: staged.proposalId })).content[0].text);
  expect(accepted).toMatchObject({ accepted: staged.proposalId, action: 'edit', remainingProposals: 0 });

  // the card clears and the deck updates — the same outcome the click produces
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).toContainText(marker);

  // reject is reachable too
  const second = JSON.parse(
    (await call('propose_chunk', { chunkId: created.chunks[0].id, html: '<div class="slide-inner"><h2>Dropped</h2></div>' })).content[0].text
  );
  await call('reject_proposal', { proposalId: second.proposalId });
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  await expect(page.frameLocator('[data-testid="preview"]').locator('body')).not.toContainText('Dropped');
});

function agentCaller(page: Page) {
  return (name: string, args: unknown): Promise<any> =>
    page.evaluate(
      ([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a),
      [name, args] as const
    );
}
