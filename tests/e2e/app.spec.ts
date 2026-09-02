import { expect, test, type Page } from '@playwright/test';

/* Real Chromium, the real dist/ build, the real sample Fold. Nothing is stubbed: the tools
   run in the page, the preview is the deck rendering itself on its own embedded engine. */

/** The tool console is collapsed on load now (design spec: it is a surface, not the furniture),
    so every console-driven step opens it first. Idempotent — a reload re-collapses it. */
async function openConsole(page: Page): Promise<void> {
  const toggle = page.getByTestId('console-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('tool-list')).toBeVisible();
}

/** Drive one tool through the test console exactly as a human would, and return its result.
    The console opens in Form mode, so this switches to JSON first — the same click a human
    makes to type a call by hand. The textarea is what gets sent in either mode. */
async function invoke(page: Page, tool: string, args: unknown): Promise<any> {
  await openConsole(page);
  await page.getByTestId(`tool-${tool}`).click();
  await expect(page.getByTestId('tool-name')).toHaveText(tool);
  await page.getByTestId('btn-mode-json').click();
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2));
  await page.getByTestId('btn-invoke').click();
  await expect(page.getByTestId('run-state')).toContainText(/ok|error/);
  const text = await page.getByTestId('tool-result').textContent();
  return { state: await page.getByTestId('run-state').textContent(), body: JSON.parse(text!) };
}

const preview = (page: Page) => page.frameLocator('[data-testid="preview"]').locator('body');

/** The bytes the preview is rendering right now — the deck as it stands, without a tool call. */
const deckTextNow = async (page: Page): Promise<string> => (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';

async function openSample(page: Page) {
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('btn-sample').click();
  await expect(page.getByTestId('preview')).toBeVisible();
  // The topbar centre now carries the DECK's title; the filename it would be written to moved
  // into the Save menu, next to the state that decides whether writing it is needed.
  await expect(page.getByTestId('deck-name')).toHaveText('Welcome to Origami');
  await expect(page.getByTestId('save-file')).toHaveText('welcome.origami.html');
}

test.beforeEach(async ({ page }) => {
  // a leftover autosave from a previous spec must not change what the next one opens
  await page.goto('/folio/index.html');
  await page.evaluate(() => localStorage.clear());
});

test('boots with the tools registered and reports the WebMCP surface honestly', async ({ page }) => {
  await page.goto('/folio/index.html');
  await expect(page.getByTestId('tool-count')).toHaveText('38');
  // plain Chromium, no --enable-features flag: the status line must SAY so rather than pretend
  await expect(page.getByTestId('mcp-status')).toContainText('WebMCP: not available (console only)');
  await expect(page.getByTestId('mcp-status')).toContainText('38 tools registered locally');
  // an agent can run the whole loop, review included — and so can a human, once the console is
  // opened (it ships collapsed now, so this is the click that reveals the list, not a shortcut)
  await openConsole(page);
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

test('a guide recipe, copied verbatim, mounts and runs in the real deck', async ({ page }) => {
  /* The unit suite proves every recipe validates. This proves the one thing a validator cannot:
     that the markup actually RENDERS on the deck's own engine. stat-cards is the sharpest probe
     — its number is written as the literal "0" with the real value in data-count-to, so a .big
     reading 42 in the frame means the runtime found the block and animated it. An agent that
     had guessed and put "42" in the text node would see it overwritten with 0. */
  await page.goto('/folio/index.html');
  // the default guide only points at the recipe cards; an agent fetches them by topic
  const guide = await invoke(page, 'origami_guide', { topic: 'recipes' });
  const recipe = guide.body.recipes.cards['stat-cards'];
  expect(recipe.html).toContain('data-count-to="42"');

  await invoke(page, 'create_deck', { title: 'Recipe Mount' });
  const added = await invoke(page, 'add_chunk', { kind: 'free', html: recipe.html, label: 'Stats' });
  expect(added.state).toContain('ok');
  expect(added.body.activeContent).toEqual([]); // a recipe must never put the deck behind the padlock

  const frame = page.frameLocator('[data-testid="preview"]');
  await expect(frame.locator('.card-grid .stat-card')).toHaveCount(2);
  await expect.poll(async () => (await frame.locator('.stat-card .big').first().textContent())?.trim(), { timeout: 5000 }).toBe('42');
  await expect(preview(page)).toContainText('What success measures');

  // and the multi-column recipe carries the attribute the schema never spells out
  const cols = guide.body.recipes.cards['text-columns-3'];
  await invoke(page, 'add_chunk', { kind: 'free', html: cols.html, label: 'Columns' });
  await expect(frame.locator('.o-tcols[data-ocols="3"] > .o-text')).toHaveCount(3);
});

test('inspect_render measures a REAL layout and names two real defects', async ({ page }) => {
  /* The unit suite proves the RULES against numbers handed straight in. This proves the numbers
     are real: a deck is built with two defects that genuinely render wrong, and inspect_render
     has to find both by laying the actual Fold out in an actual browser.

     Defect 2 is the one no VALIDATOR can catch: a fold whose markup is perfectly legal and
     whose data blocks all pass their schemas, and which still paints nothing — here an empty
     .slide-inner. (The other route to a blank fold, an empty data block, is now refused at
     write time by the data gate; that refusal is asserted below and in tests/unit/tools.test.ts.
     Layout, not schema, is what is left, and only a real render can see it.) */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Inspect Me', discard: true });
  await invoke(page, 'set_header', { subtitle: 'A masthead subtitle line', chips: ['Chip one', 'Chip two', 'Q3 2026'] });

  const dataBlock = (kind: string, data: unknown) =>
    `<script type="application/json" data-odata="${kind}">${JSON.stringify(data).replace(/</g, '\u003c')}</script>`;

  // an empty data block is REFUSED now — same verdict, same rule, at authoring time
  const refused = await invoke(page, 'add_chunk', {
    kind: 'flow',
    label: 'Blank flow',
    html: `<figure class="o-flowfig anim">${dataBlock('flow', { nodes: [], edges: [] })}<div class="o-flow" data-flow-mount></div></figure>`,
  });
  expect(refused.state).toContain('error');
  expect(JSON.stringify(refused.body.violations)).toContain('flow.nodes.count');

  // what a validator still cannot see: legal markup that paints nothing
  const blank = await invoke(page, 'add_chunk', { kind: 'free', label: 'Blank card', html: '<div class="slide-inner"></div>' });
  expect(blank.state, 'an empty card is legal markup — that is the point').toContain('ok');

  const tall = await invoke(page, 'add_chunk', {
    kind: 'free',
    label: 'Overflowing',
    html:
      '<div class="slide-inner"><h2>Tall</h2>' +
      Array.from({ length: 60 }, (_, i) => `<p>Line ${i} — padding padding padding padding padding padding</p>`).join('') +
      '</div>',
  });

  const res = await invoke(page, 'inspect_render', { viewport: { width: 940, height: 471 } });
  expect(res.state).toContain('ok');
  expect(res.body.viewport).toEqual({ width: 940, height: 471 });
  expect(res.body.measured, JSON.stringify(res.body).slice(0, 400)).toBe(true);
  expect(res.body.folds).toHaveLength(3);

  // every fold reached the stage and produced a real number
  for (const f of res.body.folds) {
    expect(f.measured, `${f.label} was not measured`).toBe(true);
    expect(f.contentHeight).toBeGreaterThan(0);
  }

  const issues = res.body.warnings.map((w: any) => `${w.issue}:${w.fold}`);
  expect(issues, JSON.stringify(res.body.warnings)).toContain(`overflow:${tall.body.chunkId}`);
  expect(issues, JSON.stringify(res.body.warnings)).toContain(`empty-fold:${blank.body.chunkId}`);
  expect(res.body.clean).toBe(false);

  // the blank fold is reported blank and NOT as clipped: with no ink there is no contentTop,
  // and the 0 fallback must not be dressed up as "hidden behind the masthead"
  const blankGeo = res.body.folds.find((f: any) => f.id === blank.body.chunkId);
  expect(blankGeo.rendersAnything).toBe(false);
  expect(res.body.warnings.filter((w: any) => w.fold === blank.body.chunkId).map((w: any) => w.issue)).toEqual(['empty-fold']);

  // the cover, which is fine, is reported fine — a tool that warns about everything says nothing
  const cover = res.body.folds.find((f: any) => f.label === 'Cover');
  expect(cover.rendersAnything).toBe(true);
  expect(cover.fits).toBe(true);
  expect(cover.contentTop).toBeGreaterThanOrEqual(cover.mastheadBottom);
  expect(res.body.warnings.filter((w: any) => w.fold === cover.id)).toEqual([]);

  const tallGeo = res.body.folds.find((f: any) => f.id === tall.body.chunkId);
  console.log(
    `  measured render @${res.body.viewport.width}x${res.body.viewport.height}: ` +
      `cover contentTop=${cover.contentTop}px vs mastheadBottom=${cover.mastheadBottom}px; ` +
      `blank flow paints nothing; overflowing fold contentHeight=${tallGeo.contentHeight}px`
  );

  // and this deck SAVES: every data block passes its schema. A blank fold is a layout defect,
  // which is why inspect_render is the only thing that reports it.
  const saved = await invoke(page, 'save_deck', {});
  expect(saved.state).toContain('ok');
  expect(saved.body.validated).toBe(true);

  // and the measuring frame cleaned itself up — it must never linger next to the preview
  await expect(page.locator('[data-testid="measure-frame"]')).toHaveCount(0);
});

test('inspect_render is viewport-dependent, and says which viewport it used', async ({ page }) => {
  /* MEASURED. This fold is a plain free-kind card (a heading plus body copy), and at these
     sizes it never paints above the masthead, so inspect_render correctly declines to warn.
     A BARE flow/graph-kind fold is a separate, now-real case — see
     knownIssues.flowKindMastheadClip in origami_guide, re-measured after the 2026-09-02 runtime
     refresh. What is real here is that geometry moves a lot with the screen, which is why the
     viewport is a parameter and is named in every result. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Viewport', discard: true });
  await invoke(page, 'set_header', { subtitle: 'A masthead subtitle line', chips: ['Chip one', 'Chip two', 'Q3 2026'] });
  await invoke(page, 'add_chunk', {
    kind: 'free',
    label: 'Some copy',
    html: '<div class="slide-inner"><h2>Heading</h2>' + Array.from({ length: 14 }, (_, i) => `<p>Line ${i} of body copy.</p>`).join('') + '</div>',
  });

  const short = await invoke(page, 'inspect_render', { viewport: { width: 940, height: 300 } });
  const tallView = await invoke(page, 'inspect_render', { viewport: { width: 1280, height: 900 } });
  expect(short.body.viewport).toEqual({ width: 940, height: 300 });
  expect(tallView.body.viewport).toEqual({ width: 1280, height: 900 });

  const pick = (r: any) => r.body.folds.find((f: any) => f.label === 'Some copy');
  expect(pick(short).fits, 'the copy fold must NOT fit on a 300px screen').toBe(false);
  expect(pick(tallView).fits, 'the same fold must fit on a 900px screen').toBe(true);
  // same deck, same bytes, opposite verdict — which is why a verdict without a viewport is noise
  expect(short.body.clean).toBe(false);
  expect(tallView.body.clean).toBe(true);

  // no masthead clip at EITHER size: the deck's own layout keeps content below the bar
  for (const r of [short, tallView]) expect(r.body.warnings.filter((w: any) => w.issue === 'masthead-clip')).toEqual([]);
  console.log(
    `  same deck: 300px -> fits=${pick(short).fits} (content ${pick(short).contentHeight}px), ` +
      `900px -> fits=${pick(tallView).fits} (content ${pick(tallView).contentHeight}px)`
  );
});

test('inspect_render reports a clean deck as clean, and never touches the preview', async ({ page }) => {
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Tidy', discard: true });
  const before = await page.getByTestId('preview').getAttribute('srcdoc');

  const res = await invoke(page, 'inspect_render', {});
  expect(res.body.measured).toBe(true);
  expect(res.body.warnings, JSON.stringify(res.body.warnings)).toEqual([]);
  expect(res.body.clean).toBe(true);

  // measuring is READ-ONLY: same bytes in the preview, and the Fold is not marked dirty by it
  expect(await page.getByTestId('preview').getAttribute('srcdoc')).toBe(before);
});

test('create_deck mints a blank Fold in the tab and add_chunk extends it', async ({ page }) => {
  await page.goto('/folio/index.html');
  const created = await invoke(page, 'create_deck', { title: 'Playwright Deck', subtitle: 'A real cover line' });
  expect(created.state).toContain('ok');
  expect(created.body.title).toBe('Playwright Deck');
  await expect(page.getByTestId('deck-name')).toHaveText('Playwright Deck');
  await expect(page.getByTestId('save-file')).toHaveText('playwright-deck.origami.html');
  // the first fold is a real COVER carrying the deck's own title, not a placeholder to overwrite
  expect(created.body.chunks[0].kind).toBe('cover');
  await expect(preview(page)).toContainText('Playwright Deck');
  await expect(preview(page)).toContainText('A real cover line');
  await expect(preview(page)).not.toContainText('New fold');

  const marker = `Second fold ${Date.now()}`;
  const added = await invoke(page, 'add_chunk', {
    label: 'Second',
    html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2></div>`,
  });
  expect(added.body.index).toBe(1);

  const toc = await invoke(page, 'list_chunks', {});
  expect(toc.body.chunks.map((c: any) => c.label)).toEqual(['Cover', 'Second']);
});

test('a staged proposal survives a real reload, and a conflict survives with it', async ({ page }) => {
  /* Through an ACTUAL page reload, not a store round trip: stage a proposal, reload, press
     Resume, and the card is back. Then the sharper half — the chunk is edited BEFORE the
     reload, so the restored proposal is stale, and accepting it after the reload must still
     refuse with `conflicted` rather than quietly overwriting the newer content. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Survives Reload', discard: true });
  const toc = await invoke(page, 'list_chunks', {});
  const first = toc.body.chunks[0].id;

  await invoke(page, 'propose_chunk', {
    chunkId: first,
    html: '<div class="slide-inner"><h2>Staged before the reload</h2></div>',
    title: 'Rewrite the cover',
    author: 'agent:reload',
  });
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);

  // the human edits the same chunk directly, so the staged proposal is now stale
  const marker = `Edited while staged ${Date.now()}`;
  await invoke(page, 'write_chunk', { chunkId: first, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });

  // wait for the debounced autosave to carry BOTH the deck and the queue into storage
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('origami-webmcp:autosave/v1');
          return raw ? (JSON.parse(raw).proposals ?? []).length : -1;
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  await page.reload();
  await page.getByTestId('btn-resume').click();

  // the queue is back, with its author and title intact
  const card = page.getByTestId('proposal-card');
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId('proposal-count')).toHaveText('1');
  await expect(card).toContainText('Rewrite the cover');
  await expect(card).toContainText('agent:reload');

  // list_proposals sees it too, and already flags the conflict
  const queue = await invoke(page, 'list_proposals', {});
  expect(queue.body.proposals).toHaveLength(1);
  expect(queue.body.proposals[0].conflicted).toBe(true);

  // and accepting it REFUSES rather than overwriting the newer content
  const accepted = await invoke(page, 'accept_proposal', { proposalId: queue.body.proposals[0].id });
  expect(accepted.state).toContain('error');
  expect(accepted.body.conflicted).toBe(true);
  await expect(preview(page)).toContainText(marker);
  await expect(preview(page)).not.toContainText('Staged before the reload');
  await expect(page.getByTestId('proposal-card')).toHaveCount(1); // still there to re-review
});

test('a reloaded proposal against an unchanged chunk still applies', async ({ page }) => {
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Clean Reload', discard: true });
  const toc = await invoke(page, 'list_chunks', {});
  const marker = `Applied after the reload ${Date.now()}`;
  await invoke(page, 'propose_chunk', { chunkId: toc.body.chunks[0].id, html: `<div class="slide-inner"><h2>${marker}</h2></div>` });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('origami-webmcp:autosave/v1');
          return raw ? (JSON.parse(raw).proposals ?? []).length : -1;
        }),
      { timeout: 5000 }
    )
    .toBe(1);

  await page.reload();
  await page.getByTestId('btn-resume').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);

  // the human clicks Accept on the restored card — the same code path an agent uses
  await page.getByTestId('accept-proposal').click();
  await expect(preview(page)).toContainText(marker);
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);
});

test('save_deck banks the Fold in browser storage, and the human can get it back out', async ({ page }) => {
  /* The route back out of OPFS. save_deck always writes the whole Fold into the origin's private
     file system, which is real storage but INVISIBLE — nothing outside this page can read it. So
     "it is saved in the browser" would be true and useless without this button. */
  await page.goto('/folio/index.html');
  /* The affordance moved into the Save menu, whose chevron is never disabled — so this opens
     the menu to look, exactly as a human would, rather than asserting the trivial truth that a
     closed menu hides everything in it. */
  await page.getByTestId('btn-savemenu').click();
  await expect(page.locator('#save-popover')).toBeVisible();
  await expect(page.getByTestId('btn-lastsave')).toBeHidden(); // nothing banked yet
  await page.keyboard.press('Escape');

  await invoke(page, 'create_deck', { title: 'Banked Deck', discard: true });
  await invoke(page, 'add_chunk', { starter: 'flowchart' });
  const saved = await invoke(page, 'save_deck', {});

  // no picker was clicked, so it must NOT claim a save — but the bytes are not lost either
  expect(saved.body.saved).toBe(false);
  expect(saved.body.opfs.written).toBe(true);
  expect(saved.body.opfs.path).toBe('saves/banked-deck.origami.html');
  expect(saved.body.opfs.bytes).toBe(saved.body.bytes);
  expect(saved.body.durability).toMatch(/in this browser only/);

  // the affordance appears in the Save menu, named with the real size
  await page.getByTestId('btn-savemenu').click();
  const btn = page.getByTestId('btn-lastsave');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Download last save');

  // and clicking it hands back the SAME bytes save_deck banked
  const [download] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  expect(download.suggestedFilename()).toBe('banked-deck.origami.html');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(Buffer.byteLength(text, 'utf8')).toBe(saved.body.bytes);
  expect(text).toContain('data-odata="flow"');
  expect(text).toContain('id="origami-manifest"');
});

test('a fold composed by add_fold FITS a 1280x720 screen — measured, not asserted from a model', async ({ page }) => {
  /* The composer's one visual promise: the reference card — an eyebrow, a heading and ONE
     chart — has to be inside the screen it is read on. The chart schema's own plotHeight
     default (318) puts it 22px past 720, which is exactly what a cold agent hit in trial; the
     composer's default was measured against this test, not chosen.

     The diagram case is here too, and — since the 2026-09-02 runtime refresh — it now PASSES
     the same bar instead of failing it on purpose. The runtime's flow layout sizes its viewBox
     to content instead of a fixed 1200x660, so a small flow composed on its own fold fits
     alongside the chart and the ledger. add_fold no longer hands back a layoutWarning for it. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Composed fit', discard: true });

  const chart = await invoke(page, 'add_fold', {
    title: 'Revenue by quarter',
    eyebrow: 'Q3 review',
    blocks: [{ chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19, 15, 24] }], yMax: null }, caption: 'Revenue by quarter, EUR m' }],
  });
  expect(chart.state).toContain('ok');

  const ledger = await invoke(page, 'add_ledger', {
    title: 'Q3 budget',
    eyebrow: 'Ledger',
    columns: [{ label: 'Line' }, { label: 'Plan', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Delta', align: 'right' }],
    rows: [['Engineering', '120000', '118400', ''], ['Design', '42000', '39800', ''], ['Marketing', '55000', '61200', ''], ['Ops', '28000', '27100', ''], ['Total', '', '', '']],
    formulas: { D1: '=B1-C1', D2: '=B2-C2', D3: '=B3-C3', D4: '=B4-C4', B5: '=SUM(B1:B4)', C5: '=SUM(C1:C4)', D5: '=SUM(D1:D4)' },
    caption: 'Plan against actual, EUR',
  });
  expect(ledger.state).toContain('ok');

  const flow = await invoke(page, 'add_fold', {
    title: 'How a fold ships',
    eyebrow: 'Process',
    blocks: [{ flow: { nodes: [{ id: 'draft', label: 'Draft', shape: 'pill', tone: 'accent' }, { id: 'review', label: 'Review', shape: 'diamond', tone: 'amber' }, { id: 'ship', label: 'Ship', shape: 'pill', tone: 'green' }], edges: [{ from: 'draft', to: 'review', label: '' }, { from: 'review', to: 'ship', label: 'yes' }] }, caption: 'Three steps' }],
  });
  expect(flow.body.layoutWarning, 'the diagram trap is gone — the runtime sizes to content now').toBeUndefined();

  const res = await invoke(page, 'inspect_render', { viewport: { width: 1280, height: 720 } });
  expect(res.body.measured).toBe(true);
  const fold = (id: string) => res.body.folds.find((f: any) => f.id === id);

  expect(fold(chart.body.chunkId).fits, `chart fold measured ${fold(chart.body.chunkId).contentHeight}px`).toBe(true);
  expect(fold(chart.body.chunkId).rendersAnything).toBe(true);
  expect(fold(ledger.body.chunkId).fits, `ledger fold measured ${fold(ledger.body.chunkId).contentHeight}px`).toBe(true);
  expect(fold(ledger.body.chunkId).rendersAnything).toBe(true);

  // the diagram fold FITS too, now that the runtime sizes the flow's viewBox to content
  const flowGeo = fold(flow.body.chunkId);
  console.log(
    `  add_fold @1280x720: chart fits=${fold(chart.body.chunkId).fits}, ledger fits=${fold(ledger.body.chunkId).fits}, ` +
      `flow fits=${flowGeo.fits} (content ${flowGeo.contentHeight}px vs 720px — content-fit viewBox)`
  );
  expect(flowGeo.fits, `flow fold measured ${flowGeo.contentHeight}px`).toBe(true);
  expect(flowGeo.rendersAnything).toBe(true);

  // every fold the composer built carries a real label, so the tabs read as words
  const chunks = await invoke(page, 'list_chunks', {});
  expect(chunks.body.chunks.map((c: any) => c.label)).toEqual(['Cover', 'Revenue by quarter', 'Q3 budget', 'How a fold ships']);

  // and the whole thing is a saveable Fold
  const saved = await invoke(page, 'save_deck', {});
  expect(saved.body.validated).toBe(true);
});

test('a saved theme survives a real page reload, and apply_theme restyles the deck on screen', async ({ page }) => {
  /* save_theme is the only tool whose result outlives the session, so it is the only one whose
     promise a unit test cannot keep: the store is injected there. This drives the REAL page,
     which puts it in localStorage, and reloads the browser to check. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Theme persistence', discard: true });

  const saved = await invoke(page, 'save_theme', { name: 'house-navy', label: 'House navy', tokens: { accent: '#1F3A5F' }, basedOn: 'boardroom' });
  expect(saved.state).toContain('ok');
  expect(saved.body.tokens.bg, 'basedOn brought the rest of boardroom with it').toBe('#F3F5F8');
  expect(saved.body.contrast.warnings).toEqual([]);

  // the tool never touched the deck
  expect(await deckTextNow(page)).toContain('#3F7268');

  await page.reload();
  await expect(page.getByTestId('mcp-status')).toBeVisible();
  const listed = await invoke(page, 'list_themes', {});
  const mine = listed.body.themes.find((t: any) => t.name === 'house-navy');
  expect(mine, 'the saved theme came back after a reload').toBeTruthy();
  expect(mine.source).toBe('saved');
  expect(mine.tokens.accent).toBe('#1F3A5F');

  // and it restyles the Fold the human is looking at
  await invoke(page, 'create_deck', { title: 'Theme persistence', discard: true });
  const applied = await invoke(page, 'apply_theme', { name: 'house-navy' });
  expect(applied.body.applied).toBe('house-navy');
  await expect.poll(() => deckTextNow(page), { timeout: 5000 }).toContain('#1F3A5F');
  await expect(page.frameLocator('[data-testid="preview"]').locator('#origami-theme-css')).toBeAttached();

  const gone = await invoke(page, 'delete_theme', { name: 'house-navy' });
  expect(gone.body.deleted).toBe('house-navy');
  expect((await invoke(page, 'list_themes', {})).body.themes.some((t: any) => t.name === 'house-navy')).toBe(false);
  // the deck keeps the colours: a theme is applied by value
  expect(await deckTextNow(page)).toContain('#1F3A5F');
});

test('a composed chart fold fits 1280x720 even when the card also carries prose', async ({ page }) => {
  /* S6. Haiku's trial fold added a lede above its chart and went over: the paragraph is height
     the chart no longer has. MEASURED at 1280x720 on the same fold: 849px at plotHeight 318,
     781 at 250, 751 at 220, 731 at 200, and it FITS at 180. So a paragraph costs the chart
     107px, which is more than the distance from the no-prose default to the floor — any prose on
     the card puts the chart at the 180 floor, and that is what has to fit. */
  await page.goto('/folio/index.html');
  await invoke(page, 'create_deck', { title: 'Prose fit', subtitle: 'A cover, not a placeholder', eyebrow: 'S6', discard: true });

  const CHART = { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Revenue', color: '#38628F', values: [12, 19, 15, 24] }], yMax: null };

  const withProse = await invoke(page, 'add_fold', {
    title: 'Revenue by quarter',
    eyebrow: 'Q3 review',
    blocks: [
      { text: '<p class="lede">Revenue held; the cost of delivery did not. This is the paragraph that pushed the trial fold over.</p>' },
      { chart: CHART, caption: 'EUR m' },
    ],
  });
  expect(withProse.state).toContain('ok');

  const alone = await invoke(page, 'add_fold', { title: 'Chart only', eyebrow: 'Control', blocks: [{ chart: CHART, caption: 'EUR m' }] });

  const res = await invoke(page, 'inspect_render', { viewport: { width: 1280, height: 720 } });
  expect(res.body.measured).toBe(true);
  const fold = (id: string) => res.body.folds.find((f: any) => f.id === id);

  expect(fold(withProse.body.chunkId).fits, `prose+chart measured ${fold(withProse.body.chunkId).contentHeight}px`).toBe(true);
  expect(fold(withProse.body.chunkId).rendersAnything).toBe(true);
  expect(fold(alone.body.chunkId).fits).toBe(true);

  // the cover is a real fold with real content on it, and it fits too
  const cover = res.body.folds[0];
  expect(cover.rendersAnything).toBe(true);
  expect(cover.fits).toBe(true);
  expect(await deckTextNow(page)).not.toContain('New fold');
  expect(await deckTextNow(page)).toContain('A cover, not a placeholder');

  console.log(`  add_fold @1280x720: prose+chart fits=${fold(withProse.body.chunkId).fits}, chart alone fits=${fold(alone.body.chunkId).fits}, cover fits=${cover.fits}`);
  expect((await invoke(page, 'save_deck', {})).body.validated).toBe(true);
});
