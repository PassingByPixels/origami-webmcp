import { expect, test, type Page } from '@playwright/test';
import { CHARTS_MODE, DRAW_MODE, GANTT_MODE, type ToolMode } from '../../src/core/modes.js';

/**
 * The three mini tool pages (docs/SITE.md, "Mini tools"), in real Chromium against the real
 * dist/ — the same bytes the zip carries.
 *
 * Each page is the Folio shell scoped to ONE block. What has to be true of every one of them:
 * it mints its own document on load with no landing to click through, it registers its own
 * toolset and says so honestly in its status line, its typed tools really change the file, and
 * the rail and the save path work exactly as they do on /folio/.
 *
 * The mode objects are imported rather than restated, so the header this asserts is the same
 * declaration src/core/modes.ts holds and build.mjs's TOOL_PAGES table fills into the HTML —
 * a drift between those two shows up here.
 */

interface Page_ {
  mode: ToolMode;
  path: string;
  /** Tools registered on this page. */
  count: number;
  title: string;
}

const PAGES: Page_[] = [
  { mode: DRAW_MODE, path: '/draw/', count: 13, title: 'Untitled drawing' },
  { mode: CHARTS_MODE, path: '/charts/', count: 12, title: 'Untitled chart' },
  { mode: GANTT_MODE, path: '/gantt/', count: 11, title: 'Untitled roadmap' },
];

async function openConsole(page: Page): Promise<void> {
  const toggle = page.getByTestId('console-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('tool-list')).toBeVisible();
}

/** Drive one tool the way a human does — the same registry.invoke a WebMCP agent reaches. */
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

/** A recording modelContext host, so the WebMCP surface can be inspected per page. */
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

/**
 * Empty this origin's browser storage, ONCE.
 *
 * It is done from the home page rather than with addInitScript: an init script runs on every
 * navigation, which would wipe the autosave slot between two gotos and silently defeat the one
 * test that is about storage surviving a page change.
 */
async function clearStorage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

/** Land on a mini page with its seeded document open and nothing left over from a prior test. */
async function land(page: Page, path: string, title: string): Promise<void> {
  // a mini page RESUMES unsaved work from browser storage, so a record left behind would give
  // the next test someone else's document
  await clearStorage(page);
  await page.goto(path);
  await expect(page.getByTestId('deck-name')).toHaveText(title);
  await expect(page.getByTestId('preview')).toBeVisible();
}

for (const p of PAGES) {
  test(`${p.path} mints its own document on load — no landing to click through`, async ({ page }) => {
    await land(page, p.path, p.title);

    // the header names the tool, and it is the SAME string src/core/modes.ts declares
    await expect(page.getByTestId('subbrand')).toHaveText(p.mode.tag);
    expect(await page.title()).toContain(p.mode.tag);
    // the wordmark is the way home
    await expect(page.locator('a.brand')).toHaveAttribute('href', '../');

    // none of the landing's controls exists here — the canvas IS the landing
    for (const gone of ['btn-replay', 'btn-sample', 'btn-blank', 'btn-connect', 'replaybar', 'resume-slot']) {
      await expect(page.getByTestId(gone), gone).toHaveCount(0);
    }

    // ONE fold, and it really renders (measured off-screen by the deck's own runtime)
    const shape = await invoke(page, 'inspect_render');
    expect(shape.measured).toBe(true);
    expect(shape.folds).toHaveLength(1);
    expect(shape.folds[0].blocks, 'the seeded block painted something').toBeGreaterThan(0);

    // the mint is in the feed as a human action, chipped NEW
    const first = page.getByTestId('activity-row').last();
    await expect(first).toContainText('NEW');
    await expect(first).toHaveAttribute('data-source', 'human');
  });

  test(`${p.path} registers its own ${p.count} tools and says so`, async ({ page }) => {
    await installHost(page);
    await land(page, p.path, p.title);

    // the status line counts THIS page's registry, never a constant
    await expect(page.getByTestId('mcp-status')).toHaveText(`WebMCP: connected via document.modelContext — ${p.count} tools`);
    await page.getByTestId('mcp-status').click();
    await expect(page.getByTestId('mcp-popover')).toContainText(`${p.count} tools registered`);
    await page.keyboard.press('Escape');
    await openConsole(page);
    await expect(page.getByTestId('tool-count')).toHaveText(String(p.count));

    const names = await page.evaluate(() => (window as any).__mcp.registered.map((d: any) => d.name));
    expect(names.sort()).toEqual([...p.mode.tools!].sort());
    // the multi-fold tools are absent from the WebMCP surface too, not merely hidden in the UI
    for (const absent of ['create_deck', 'add_chunk', 'list_chunks', 'propose_chunk']) {
      expect(names, `${absent} must not be registered`).not.toContain(absent);
    }

    // the console groups its own block first, then the shared headings
    const groups = await page.locator('.tool-group').allTextContents();
    expect(groups).toEqual(p.mode.consoleGroups!.map(([heading]) => heading));
  });

  test(`${p.path} guide, save and the rail behave like the rest of the app`, async ({ page }) => {
    await land(page, p.path, p.title);

    // the scoped guide names every tool this page has, and only those
    const guide = await invoke(page, 'origami_guide');
    expect(Object.keys(guide.tools).sort()).toEqual([...p.mode.tools!].sort());
    expect(guide.block.kind).toBe(p.mode.blockKinds![0]);
    expect(guide.notAvailableHere.openTheFullEditor).toContain('/folio/');

    // save_deck banks the whole Fold in OPFS — the same backstop /folio/ has
    const saved = await invoke(page, 'save_deck');
    expect(saved.validated).toBe(true);
    expect(saved.opfs.written, 'the Fold reached this browser\'s private file system').toBe(true);
    expect(saved.opfs.path).toContain(`saves-${p.mode.storageNs}/`);
    expect(saved.saved, 'no file handle, so it must NOT claim a save').toBe(false);

    // …and every call left a row in the rail
    const rows = await page.getByTestId('activity-row').allTextContents();
    expect(rows.join('\n')).toContain('origami_guide');
    expect(rows.join('\n')).toContain('save_deck');
    await expect(page.getByTestId('activity-row').first()).toContainText('SAVE');
  });
}

test('/draw/ — add_element twice, and both shapes are in the exported file', async ({ page }) => {
  await land(page, '/draw/', 'Untitled drawing');

  const before = await invoke(page, 'list_elements');
  const rect = await invoke(page, 'add_element', {
    type: 'rect', x: 300, y: 260, width: 180, height: 90, stroke: '#B3402A', fill: '#F2C94C', fillStyle: 'hachure', strokeWidth: 2,
  });
  expect(rect.added).toMatch(/^e[0-9a-f]{8}$/);
  const label = await invoke(page, 'add_element', {
    id: 'shipped-label', type: 'text', x: 320, y: 295, width: 150, height: 28, stroke: '#2F4A6B',
    text: 'Shipped by an agent', fontSize: 20, font: 'inter', textAlign: 'center',
  });
  expect(label.added).toBe('shipped-label');

  const after = await invoke(page, 'list_elements');
  expect(after.count).toBe(before.count + 2);

  // the FILE an agent would hand on carries both — not just the tool's own answer
  const exported = await invoke(page, 'export_deck');
  expect(exported.text).toContain('shipped-label');
  expect(exported.text).toContain('Shipped by an agent');
  expect(exported.text).toContain(rect.added);
  expect(exported.slides).toBe(1);

  // and an unknown id is refused, with the ids that do exist
  const bad = await invoke(page, 'update_element', { id: 'nope', patch: { x: 1 } });
  expect(bad.error).toContain('unknown element "nope"');
  expect(bad.availableIds).toContain('shipped-label');

  await expect(page.getByTestId('activity-row').first()).toContainText('update_element');
});

test('/charts/ — set_chart puts a real bar chart in the file, and set_venn swaps the figure', async ({ page }) => {
  await land(page, '/charts/', 'Untitled chart');

  const set = await invoke(page, 'set_chart', {
    chart: {
      type: 'bar',
      labels: ['Draw', 'Charts', 'Gantt'],
      series: [{ name: 'Tools on the page', color: '#3D8B5A', values: [13, 12, 11] }],
      yMax: null,
      title: 'Tools per mini page',
    },
    caption: 'One block, one toolset',
  });
  expect(set).toMatchObject({ kind: 'chart', type: 'bar' });

  const exported = await invoke(page, 'export_deck');
  for (const bit of ['"Draw"', '"Charts"', '"Gantt"', 'Tools on the page', 'One block, one toolset']) {
    expect(exported.text, bit).toContain(bit);
  }
  expect(exported.text).toContain('data-chart-mount');

  // the refusal path, on the user's real surface: 3 labels, 2 values
  const bad = await invoke(page, 'set_chart', {
    chart: { type: 'bar', labels: ['A', 'B', 'C'], series: [{ name: 'x', color: '#4A8CC4', values: [1, 2] }], yMax: null },
  });
  expect(bad.violations.map((v: any) => v.rule)).toContain('chart.series.values');
  expect((await invoke(page, 'get_data')).data.labels, 'nothing was applied').toEqual(['Draw', 'Charts', 'Gantt']);

  // the venn swap — the figure changes kind, and the chart mount goes with it
  await invoke(page, 'set_venn', {
    venn: { count: 2, sets: [{ label: 'Human', color: '#557A4E' }, { label: 'Agent', color: '#4A8CC4' }], overlaps: [{ sets: [0, 1], label: 'This page', x: 50, y: 52 }] },
  });
  const asVenn = await invoke(page, 'get_data');
  expect(asVenn.kind).toBe('venn');
  expect(asVenn.data.sets.map((s: any) => s.label)).toEqual(['Human', 'Agent']);
  const swapped = await invoke(page, 'export_deck');
  expect(swapped.text).toContain('data-venn-mount');
  expect(swapped.text).toContain('This page');
  expect(swapped.text, 'the chart it replaced is gone').not.toContain('Tools on the page');
});

test('/gantt/ — set_roadmap puts real lanes and cards in the file', async ({ page }) => {
  await land(page, '/gantt/', 'Untitled roadmap');

  const res = await invoke(page, 'set_roadmap', {
    roadmap: {
      totalWeeks: 10,
      startDate: '2026-09-07',
      lenses: [{ name: 'Build', color: '#4a8cc4' }, { name: 'Launch', color: '#3d8b5a' }],
      swimlanes: [{ name: 'Mini tools', owner: 'Origami' }],
      cards: [
        { id: 'C01', title: 'Ship draw, charts, gantt', swimlane: 'Mini tools', start: 'W1', durationWeeks: 4, lens: 'Build', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
        { id: 'C02', title: 'Cut the zip', swimlane: 'Mini tools', start: 'W6', durationWeeks: 1, lens: 'Launch', type: 'Process', effort: 'EASY', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false },
      ],
      milestones: [{ label: 'origami.gratis', week: 7, color: '#3d8b5a' }],
    },
    caption: 'The mini tools',
  });
  expect(res).toMatchObject({ swimlanes: 1, cards: 2 });

  const exported = await invoke(page, 'export_deck');
  for (const bit of ['Mini tools', 'Ship draw, charts, gantt', 'Cut the zip', 'origami.gratis', 'The mini tools']) {
    expect(exported.text, bit).toContain(bit);
  }
  expect(exported.text).toContain('data-gantt-mount');

  // a card naming a lane that does not exist is refused, and the roadmap survives intact
  const bad = await invoke(page, 'set_roadmap', {
    roadmap: {
      totalWeeks: 4, startDate: null,
      lenses: [{ name: 'Build', color: '#4a8cc4' }],
      swimlanes: [{ name: 'Only lane', owner: '' }],
      cards: [{ id: 'C01', title: 'x', swimlane: 'Ghost', start: 'W1', durationWeeks: 1, lens: 'Build', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false }],
      milestones: [],
    },
  });
  expect(bad.violations.map((v: any) => v.rule)).toContain('gantt.card.swimlane');
  expect((await invoke(page, 'get_roadmap')).roadmap.swimlanes[0].name).toBe('Mini tools');
});

test('a WebMCP agent drives a mini page end to end, and the human watches it happen', async ({ page }) => {
  /* The console proves the registry. THIS proves the surface an agent actually reaches: the
     registered execute() callbacks, with no click anywhere in the app. */
  await installHost(page);
  await land(page, '/draw/', 'Untitled drawing');
  await expect(page.getByTestId('mcp-status')).toContainText('connected');

  const call = (name: string, args: unknown = {}): Promise<any> =>
    page
      .evaluate(([n, a]) => (window as any).__mcp.registered.find((d: any) => d.name === n).execute(a), [name, args] as const)
      .then((res: any) => JSON.parse(res.content[0].text));

  const guide = await call('origami_guide');
  expect(guide.block.kind).toBe('draw');
  await call('add_element', { id: 'agent-box', type: 'diamond', x: 600, y: 250, width: 120, height: 80, stroke: '#557A4E' });
  await call('set_caption', { caption: 'Drawn over WebMCP' });

  /* The human's page shows it: the preview re-rendered, and the rail names the agent. Scoped to
     .o-stage — the runtime also keeps a hidden .o-print copy of every fold, so a bare
     `figcaption` locator matches three elements and fails strict mode rather than the check. */
  await expect(page.frameLocator('[data-testid="preview"]').locator('.o-stage figcaption')).toContainText('Drawn over WebMCP');
  await expect(page.getByTestId('activity-row').first()).toHaveAttribute('data-source', 'agent');
  await expect(page.getByTestId('activity-row').first()).toContainText('set_caption');

  const exported = await call('export_deck');
  expect(exported.text).toContain('agent-box');
});

test('the pages do not share an autosave slot — /charts/ never resumes the drawing', async ({ page }) => {
  /* localStorage is per ORIGIN and origami.gratis serves four tool pages from one. Before the
     namespacing, landing on /charts/ after using /draw/ would have opened the drawing. */
  await land(page, '/draw/', 'Untitled drawing');
  await invoke(page, 'add_element', { id: 'only-on-draw', type: 'rect', x: 500, y: 300, width: 40, height: 40, stroke: '#B3402A' });
  // the autosave debounce is 700 ms; wait for the record to actually exist
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('origami-webmcp:autosave/v1:draw') !== null), { timeout: 5000 })
    .toBe(true);

  // straight to /charts/ WITHOUT clearing storage — the real journey a human takes from the home page
  await page.goto('/charts/');
  await expect(page.getByTestId('deck-name')).toHaveText('Untitled chart');
  const data = await invoke(page, 'get_data');
  expect(data.kind).toBe('chart');
  expect((await invoke(page, 'export_deck')).text).not.toContain('only-on-draw');

  // and back on /draw/, the drawing is still there — the namespacing preserves work, it does
  // not merely hide it
  await page.goto('/draw/');
  await expect(page.getByTestId('deck-name')).toHaveText('Untitled drawing');
  await expect(page.getByTestId('activity-row').last()).toContainText('OPEN');
  expect((await invoke(page, 'list_elements')).elements.some((e: any) => e.id === 'only-on-draw')).toBe(true);
});

test('a page that cannot fetch the viewer runtime says so, instead of showing a dead canvas', async ({ page }) => {
  /* The document is minted in the browser and needs the viewer IIFE beside the page. If that
     request fails — a half-uploaded zip, a host that rewrites unknown paths — the page must say
     what went wrong and stay usable, not sit on an empty stage for ever. */
  await clearStorage(page);
  await page.route('**/origami-runtime.iife.js', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/draw/');

  const toast = page.getByTestId('app-message');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Could not start a drawing');
  await expect(toast).toContainText('404');
  // the failure is in the feed as a failed human action, and the stage still offers a way on
  await expect(page.getByTestId('activity-row').first()).toContainText('NEW');
  await expect(page.getByTestId('activity-row').first()).toHaveClass(/bad/);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('btn-new')).toBeEnabled();

  // …and once the asset is reachable again, New succeeds
  await page.unroute('**/origami-runtime.iife.js');
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('deck-name')).toHaveText('Untitled drawing');
  await expect(page.getByTestId('preview')).toBeVisible();
});

test('New mints a fresh seeded document, discarding the one on screen', async ({ page }) => {
  await land(page, '/charts/', 'Untitled chart');
  await invoke(page, 'set_chart', {
    chart: { type: 'pie', labels: ['Kept?'], series: [{ name: 's', color: '#4A8CC4', values: [1] }], yMax: null },
  });
  expect((await invoke(page, 'export_deck')).text).toContain('Kept?');

  page.on('dialog', (d) => void d.accept()); // the unsaved-changes guard
  await page.getByTestId('btn-new').click();
  await expect(page.getByTestId('deck-name')).toHaveText('Untitled chart');
  await expect.poll(async () => (await invoke(page, 'get_data')).data.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  expect((await invoke(page, 'export_deck')).text).not.toContain('Kept?');
});
