import { expect, test, type Page } from '@playwright/test';
import { FLOW_INNER, VENN_INNER } from '../fixtures.js';

/**
 * An unattended agent builds a Fold from nothing. ZERO human clicks: nothing in this file
 * touches the page's UI. Every action goes through a tool registered on the WebMCP surface,
 * which is what Codex or any other in-browser agent would drive.
 *
 * The recording host stands in for Chrome's modelContext (no Canary on the build machine —
 * see README); the tools, the deck, the calc bake and the renderer are all real.
 */
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

/** Call a tool the way the host would, and parse its text payload. */
async function tool(page: Page, name: string, args: unknown = {}): Promise<any> {
  const res = await page.evaluate(
    ([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a),
    [name, args] as const
  );
  return { isError: !!res.isError, body: JSON.parse(res.content[0].text) };
}

const preview = (page: Page) => page.frameLocator('[data-testid="preview"]').locator('body');

/** The iframe's srcdoc IS the serialized Fold — the exact bytes Save writes. */
const deckTextNow = async (page: Page): Promise<string> => (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';

/** Re-render is debounced, so assertions on the serialized deck must retry. */
const expectDeck = (page: Page) => expect.poll(() => deckTextNow(page), { timeout: 5000 });

/** The one table block's data, parsed out of the serialized deck. Returns null rather than
    throwing: the embedded runtime carries the literal string `data-odata="table"` as a
    selector, so a poll that runs before the slide exists would otherwise match minified JS
    and blow up instead of retrying. */
async function tableData(page: Page): Promise<any> {
  const m = /data-odata="table"[^>]*>([\s\S]*?)<\/script>/.exec(await deckTextNow(page));
  if (!m) return null;
  try {
    return JSON.parse(m[1]!.replace(/\\u003c/g, '<'));
  } catch {
    return null;
  }
}

test('an agent builds a scroll Fold with two data kinds and resolves its own proposal', async ({ page }) => {
  await installHost(page);
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('mcp-status')).toContainText('connected via document.modelContext — 39 tools');

  /* 1. onboard — the default guide indexes the kinds; the schema itself lives behind the
     topic call and get_kind_schema, and both routes must agree in the SHIPPED bundle */
  const guide = await tool(page, 'origami_guide');
  expect(guide.body.formatVersion).toBe('1');
  const vennSchema = await tool(page, 'get_kind_schema', { kind: 'venn' });
  expect(vennSchema.isError).toBe(false);
  expect(vennSchema.body.name).toBe(guide.body.kinds.venn.name);
  const kindsTopic = await tool(page, 'origami_guide', { topic: 'kinds' });
  expect(vennSchema.body.schema).toEqual(kindsTopic.body.kinds.venn.schema);
  expect(vennSchema.body.schema.join(' ')).toMatch(/data-odata="venn"/);
  expect(Object.keys(guide.body.kinds)).toEqual(expect.arrayContaining(['venn', 'flow', 'table', 'document', 'chart']));

  /* 2. create a SCROLL deck, discarding nothing (fresh tab) */
  const created = await tool(page, 'create_deck', { title: 'Agent Built', foldType: 'scroll', discard: true });
  expect(created.body.foldType).toBe('scroll');
  const coverId = created.body.chunks[0].id;

  /* 3. two data kinds the agent has to hand-build from the schema */
  const venn = await tool(page, 'add_chunk', { kind: 'venn', html: VENN_INNER, label: 'What a Fold is' });
  expect(venn.isError).toBe(false);
  const flow = await tool(page, 'add_chunk', { kind: 'flow', html: FLOW_INNER, label: 'The review path' });
  expect(flow.isError).toBe(false);

  /* 4. propose, then resolve it WITHOUT a human */
  const marker = `Resolved by the agent ${Date.now()}`;
  const staged = await tool(page, 'propose_chunk', {
    chunkId: coverId,
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2><p class="lede">No human clicked anything.</p></div>`,
    title: 'Rewrite the cover',
    author: 'agent:e2e',
  });
  await expect(page.getByTestId('proposal-card')).toHaveCount(1); // the card exists for a human who IS there
  expect(await deckTextNow(page)).not.toContain(marker); // but nothing is applied yet

  const accepted = await tool(page, 'accept_proposal', { proposalId: staged.body.proposalId });
  expect(accepted.body).toMatchObject({ action: 'edit', applied: coverId, remainingProposals: 0 });
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);

  /* 5. the SERIALIZED deck carries the venn, the flow and the accepted change */
  await expectDeck(page).toContain(marker);
  const text = await deckTextNow(page);
  expect(text).toContain('data-odata="venn"');
  expect(text).toContain('data-odata="flow"');
  expect(text).toContain('A Fold');
  expect(text).toContain('Human or agent reviews');
  expect(text).toContain('"foldType": "scroll"');

  /* 6. and the iframe actually re-rendered it — the deck playing itself.
        Diagram node labels are wrapped into <tspan> lines by the runtime, so a substring of a
        multi-word label is not a safe assertion; the MOUNTED svg and the plain-HTML
        figcaptions are. */
  await expect(preview(page)).toContainText(marker);
  await expect(preview(page)).toContainText('Inert'); // a venn set label
  await expect(preview(page)).toContainText('What a Fold is'); // the venn figcaption
  await expect(preview(page)).toContainText('The review path'); // the flow figcaption
  const frame = page.frameLocator('[data-testid="preview"]');
  await expect(frame.locator('.o-venn svg').first()).toBeAttached();
  await expect(frame.locator('.o-flow svg').first()).toBeAttached();

  /* 7. the table of contents agrees */
  const toc = await tool(page, 'list_chunks');
  expect(toc.body.foldType).toBe('scroll');
  expect(toc.body.chunks.map((c: any) => c.kind)).toEqual(['cover', 'venn', 'flow']);
  expect(toc.body.chunks.map((c: any) => c.label)).toEqual(['Cover', 'What a Fold is', 'The review path']);

  /* 8. finish on save_deck — no writable handle in a fresh tab, so it must say so, not throw */
  const saved = await tool(page, 'save_deck');
  expect(saved.isError).toBe(false);
  expect(saved.body).toMatchObject({ saved: false, validated: true, title: 'Agent Built', slides: 3 });
  expect(saved.body.note).toMatch(/no writable handle|press Save/i);
  expect(saved.body.bytes).toBeGreaterThan(200_000);
});

test('an agent bakes a table through the real calc engine, in the browser', async ({ page }) => {
  await installHost(page);
  await page.goto('/folio/index.html');
  await tool(page, 'create_deck', { title: 'Agent Ledger', discard: true });

  const inner = `<div class="o-table-shell">
<script type="application/json" data-odata="table">
${JSON.stringify({
    columns: [{ label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'Unit', align: 'right' }, { label: 'Total', align: 'right' }],
    rows: [
      ['Widgets', '7', '3', '0'],
      ['Gadgets', '5', '4', '0'],
      ['Total', '', '', '0'],
    ],
    formulas: { D1: '=B1*C1', D2: '=B2*C2', D3: '=SUM(D1:D2)' },
  })}
</script>
  <div class="o-table" data-table-mount></div>
</div>`;

  const added = await tool(page, 'add_chunk', { kind: 'table', html: inner, label: 'Budget' });
  expect(added.isError).toBe(false);

  // the ARITHMETIC must be in the saved bytes, not just on screen: 7*3, 5*4, SUM
  await expect.poll(() => tableData(page).then((d) => d?.rows), { timeout: 5000 }).toEqual([
    ['Widgets', '7', '3', '21'],
    ['Gadgets', '5', '4', '20'],
    ['Total', '', '', '41'],
  ]);
  expect((await tableData(page)).formulas.D3).toBe('=SUM(D1:D2)'); // the formula rides along, inert
  await expect(preview(page)).toContainText('41');
});

test('an agent defines a composite block and places an instance', async ({ page }) => {
  await installHost(page);
  await page.goto('/folio/index.html');
  await tool(page, 'create_deck', { title: 'Agent Blocks', discard: true });

  const defined = await tool(page, 'define_block', {
    def: {
      kind: 'x.kpi',
      name: 'KPI card',
      version: 1,
      fields: [
        { name: 'value', type: 'text' },
        { name: 'label', type: 'text' },
      ],
      template: '<div class="stat-card"><div class="big">{{value}}</div><div class="lbl">{{label}}</div></div>',
    },
  });
  expect(defined.isError).toBe(false);

  const listed = await tool(page, 'list_block_defs');
  expect(listed.body.blocks.map((b: any) => b.kind)).toEqual(['x.kpi']);

  const placed = await tool(page, 'add_chunk', { block: 'x.kpi', fields: { value: '128', label: 'Deployments' } });
  expect(placed.isError).toBe(false);
  await expect(preview(page)).toContainText('128');
  await expect(preview(page)).toContainText('Deployments');
});
