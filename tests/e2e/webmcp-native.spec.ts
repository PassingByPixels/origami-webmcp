import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * THE REAL THING — no mock host anywhere in this file.
 *
 * Launches the INSTALLED stable Chrome (channel: 'chrome') with WebMCP switched on from the
 * command line, and drives the app through Chrome's OWN `document.modelContext`: the app calls
 * the native `registerTool`, and this spec calls the native `getTools()` / `executeTool()`.
 * `webmcp-shim.spec.ts` proves the shim against a recording stand-in; this proves the browser.
 *
 * HOW THE FLAG WAS FOUND. chrome://flags/#enable-webmcp-testing has no documented base::Feature
 * name, so it was determined empirically against this machine's Chrome 151.0.7922.174: strings
 * in chrome.dll gave the candidates `WebMCP` and `WebMCPTesting`, and a launch matrix showed
 *   --enable-features=WebMCP  ->  document.modelContext AND navigator.modelContext both present
 *   (no flag)                 ->  neither present
 * on a secure-context page. `WebMCPTesting` additionally exposes navigator.modelContextTesting,
 * a separate test-harness surface this app does not use. The first probe run reported "not
 * available" for every candidate because it tested `about:blank`; the API needs a real page.
 *
 * PROFILE SAFETY: every launch gets a FRESH temporary user-data-dir created under the repo and
 * deleted afterwards. The user's own Chrome profile is never opened, read, or written.
 */

const FEATURE_ARGS = ['--enable-features=WebMCP'];
const MIN_MAJOR = 146; // WebMCP shipped behind the flag in Chrome 146 stable

interface Chrome {
  ctx: BrowserContext;
  page: Page;
  version: string;
  dir: string;
}

async function launchChrome(args: string[]): Promise<Chrome | { skip: string }> {
  const dir = await mkdtemp(join(process.cwd(), '.tmp-chrome-'));
  let ctx: BrowserContext;
  try {
    ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, args });
  } catch (e) {
    await cleanup(dir);
    return { skip: `stable Chrome could not be launched (channel:"chrome"): ${(e as Error).message.split('\n')[0]}` };
  }
  const version = ctx.browser()?.version() ?? '0';
  const major = Number(version.split('.')[0]);
  if (!Number.isFinite(major) || major < MIN_MAJOR) {
    await ctx.close();
    await cleanup(dir);
    return { skip: `installed Chrome is ${version}; WebMCP needs >= ${MIN_MAJOR}` };
  }
  return { ctx, page: await ctx.newPage(), version, dir };
}

async function cleanup(dir: string): Promise<void> {
  // Chrome on Windows keeps a handle on the profile for a while after close — 4 quick retries
  // was not enough and left a .tmp-chrome-* directory behind in the repo. Back off further, and
  // sweep any survivors on the next run (see the beforeAll below) so junk cannot accumulate.
  for (let i = 0; i < 12; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  console.log(`  note: could not remove the throwaway profile ${dir} — it is gitignored and the next run sweeps it`);
}

/** Delete throwaway profiles a previous run could not (Windows file locks). */
async function sweepStaleProfiles(): Promise<void> {
  for (const name of await readdir(process.cwd())) {
    if (name.startsWith('.tmp-chrome-')) await rm(join(process.cwd(), name), { recursive: true, force: true }).catch(() => {});
  }
}

/** Skip in a way nobody can miss: every reporter shows stdout, not every reporter shows the
    skip annotation. A machine with no Chrome >= 146 must be TOLD why the native proof did not
    run, or a skipped suite reads as a passing one. */
function skipLoudly(reason: string): never {
  const line = '='.repeat(78);
  console.log(`
${line}
  NATIVE WebMCP PROOF SKIPPED — ${reason}
  This suite proves the app against Chrome's OWN modelContext. Everything else still
  ran; only the native-browser evidence is missing on this machine.
${line}
`);
  test.skip(true, reason);
  throw new Error('unreachable');
}

async function close(c: Chrome): Promise<void> {
  await c.ctx.close();
  await cleanup(c.dir);
}

/** Whether the page has a NATIVE modelContext — read before the app's script can add anything. */
const nativeSurface = (page: Page) =>
  page.evaluate(() => ({
    document: 'modelContext' in document,
    navigator: 'modelContext' in navigator,
    secureContext: isSecureContext,
  }));

/** Drive one tool through Chrome's own executeTool. */
async function nativeTool(page: Page, name: string, args: unknown = {}): Promise<{ isError: boolean; body: any }> {
  const raw = await page.evaluate(
    async ([n, a]) => {
      const ctx = (document as any).modelContext;
      const tools = await ctx.getTools();
      const t = tools.find((x: any) => x.name === n);
      if (!t) throw new Error(`tool not registered on the native surface: ${n}`);
      const r = await ctx.executeTool(t, JSON.stringify(a));
      return typeof r === 'string' ? r : JSON.stringify(r);
    },
    [name, args] as const
  );
  const envelope = JSON.parse(raw);
  return { isError: !!envelope.isError, body: JSON.parse(envelope.content[0].text) };
}

const preview = (page: Page) => page.frameLocator('[data-testid="preview"]').locator('body');
const deckTextNow = async (page: Page): Promise<string> => (await page.getByTestId('preview').getAttribute('srcdoc')) ?? '';

const URL = 'http://127.0.0.1:5174/index.html';
// A page with no app on it: proves the surface is the BROWSER's, not something this app defines.
const BLANK = 'http://127.0.0.1:5174/favicon.svg';

test.describe('native WebMCP in the installed stable Chrome', () => {
  test.beforeAll(sweepStaleProfiles);
  test.afterAll(sweepStaleProfiles);

  test('the flag is what turns document.modelContext on — control vs treatment', async () => {
    const off = await launchChrome([]);
    if ('skip' in off) skipLoudly(off.skip);
    const withoutFlag = await (async () => {
      const c = off as Chrome;
      await c.page.goto(BLANK);
      const s = await nativeSurface(c.page);
      const v = c.version;
      await close(c);
      return { s, v };
    })();

    const on = await launchChrome(FEATURE_ARGS);
    if ('skip' in on) skipLoudly(on.skip);
    const c = on as Chrome;
    await c.page.goto(BLANK);
    const withFlag = await nativeSurface(c.page);
    await close(c);

    console.log(`  installed Chrome ${withoutFlag.v}`);
    console.log(`  no flags                  -> ${JSON.stringify(withoutFlag.s)}`);
    console.log(`  --enable-features=WebMCP  -> ${JSON.stringify(withFlag)}`);

    expect(withoutFlag.s.secureContext, 'localhost must be a secure context').toBe(true);
    expect(withoutFlag.s.document, 'modelContext must be absent without the flag').toBe(false);
    expect(withoutFlag.s.navigator).toBe(false);
    expect(withFlag.document, '--enable-features=WebMCP must expose document.modelContext').toBe(true);
    expect(withFlag.navigator).toBe(true);
  });

  test('the app registers all 24 tools on Chrome\'s own modelContext', async () => {
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);

      // the app's own status line, read from the real browser
      await expect(c.page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 24 tools');

      // and Chrome agrees: its registry holds them
      const tools = await c.page.evaluate(async () => {
        const t = await (document as any).modelContext.getTools();
        return t.map((x: any) => ({ name: x.name, hasDescription: typeof x.description === 'string' && x.description.length > 40, schema: typeof x.inputSchema }));
      });
      expect(tools).toHaveLength(24);
      expect(tools.map((t: any) => t.name).sort()).toEqual([
        'accept_proposal', 'add_chunk', 'add_custom_fold', 'create_deck', 'define_block', 'delete_block',
        'delete_chunk', 'get_kind_schema', 'inspect_render', 'list_block_defs', 'list_chunks', 'list_proposals', 'list_starters', 'origami_guide',
        'propose_add', 'propose_chunk', 'propose_delete', 'read_chunk', 'reject_proposal', 'save_deck',
        'set_fold_type', 'set_header', 'undo', 'write_chunk',
      ]);
      expect(tools.every((t: any) => t.hasDescription)).toBe(true);
      console.log(`  Chrome ${c.version} getTools() -> ${tools.length} tools; inputSchema arrives as "${tools[0].schema}"`);
    } finally {
      await close(c);
    }
  });

  test('does Chrome hand tool ANNOTATIONS back to the agent?', async () => {
    /* An empirical question, not an assertion about this app. The app registers readOnlyHint /
       destructiveHint on 11 tools (proved against a recording host in webmcp-shim.spec.ts). What
       a real host DOES with them is the browser's business, and the honest thing is to measure it
       and print the answer rather than assume either way. Whatever the result, the annotations
       stay: a host that reads them gets them, and one that drops them is no worse off. */
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);
      await expect(c.page.getByTestId('mcp-status')).toContainText('connected');

      const seen = await c.page.evaluate(async () => {
        const tools = await (document as any).modelContext.getTools();
        const guide = tools.find((t: any) => t.name === 'origami_guide');
        const del = tools.find((t: any) => t.name === 'delete_chunk');
        return {
          keysOnATool: Object.keys(guide).sort(),
          annotationsOnReadOnly: guide.annotations ?? null,
          annotationsOnDestructive: del.annotations ?? null,
          anyToolHasAnnotations: tools.some((t: any) => t.annotations != null),
        };
      });

      console.log(`  Chrome ${c.version} getTools() exposes per-tool keys: ${JSON.stringify(seen.keysOnATool)}`);
      console.log(`  annotations survive registration? ${seen.anyToolHasAnnotations ? 'YES' : 'NO — Chrome drops them'}`);
      console.log(`    origami_guide.annotations -> ${JSON.stringify(seen.annotationsOnReadOnly)}`);
      console.log(`    delete_chunk.annotations  -> ${JSON.stringify(seen.annotationsOnDestructive)}`);

      /* MEASURED on Chrome 151.0.7922.174: annotations DO survive, but Chrome normalises them
         into its own vocabulary. readOnlyHint comes back; destructiveHint is discarded outright,
         and an untrustedContentHint this app never sent is added, defaulted to false:
           origami_guide -> {"readOnlyHint":true,"untrustedContentHint":false}
           delete_chunk  -> {"readOnlyHint":false,"untrustedContentHint":false}
         The consequence is the reason this test exists: a Chrome-hosted agent is never told a
         tool is destructive by the annotation, so that warning has to be in the description. */
      expect(seen.keysOnATool).toContain('name');
      expect(seen.keysOnATool).toContain('description');
      expect(seen.anyToolHasAnnotations, 'Chrome 151 returned annotations; if this flips, re-report it').toBe(true);
      expect(seen.annotationsOnReadOnly?.readOnlyHint, 'readOnlyHint must survive registration').toBe(true);
      // destructiveHint is NOT asserted absent: Chrome gaining support for it would be a good
      // change, and a test that failed on it would be pinning a browser bug in place. The log
      // line above is the record, and the description carries the warning either way.
      expect(seen.annotationsOnDestructive?.readOnlyHint, 'a destructive tool must never come back read-only').toBe(false);
    } finally {
      await close(c);
    }
  });

  test('an unattended agent runs the whole job through Chrome\'s executeTool', async () => {
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    const page = c.page;
    try {
      await page.goto(URL);
      await expect(page.getByTestId('mcp-status')).toContainText('connected via document.modelContext');

      // onboard
      const guide = await nativeTool(page, 'origami_guide');
      expect(guide.body.formatVersion).toBe('1');
      const schema = await nativeTool(page, 'get_kind_schema', { kind: 'venn' });
      expect(schema.body.schema.join(' ')).toMatch(/data-odata="venn"/);

      // build
      const created = await nativeTool(page, 'create_deck', { title: 'Native Agent Run', foldType: 'scroll', discard: true });
      expect(created.body.foldType).toBe('scroll');
      const coverId = created.body.chunks[0].id;

      const { VENN_INNER, FLOW_INNER } = await import('../fixtures.js');
      expect((await nativeTool(page, 'add_chunk', { kind: 'venn', html: VENN_INNER, label: 'What a Fold is' })).isError).toBe(false);
      expect((await nativeTool(page, 'add_chunk', { kind: 'flow', html: FLOW_INNER, label: 'The review path' })).isError).toBe(false);

      // propose then resolve, with no human anywhere
      const marker = `Native run ${Date.now()}`;
      const staged = await nativeTool(page, 'propose_chunk', {
        chunkId: coverId,
        html: `<div class="slide-inner"><h2 data-oedit="title">${marker}</h2></div>`,
        author: 'agent:native',
      });
      await expect(page.getByTestId('proposal-card')).toHaveCount(1);
      expect(await deckTextNow(page)).not.toContain(marker);

      const accepted = await nativeTool(page, 'accept_proposal', { proposalId: staged.body.proposalId });
      expect(accepted.body).toMatchObject({ action: 'edit', applied: coverId, remainingProposals: 0 });
      await expect(page.getByTestId('proposal-card')).toHaveCount(0);

      // the Fold the human would save
      await expect.poll(() => deckTextNow(page), { timeout: 5000 }).toContain(marker);
      const text = await deckTextNow(page);
      expect(text).toContain('data-odata="venn"');
      expect(text).toContain('data-odata="flow"');
      expect(text).toContain('"foldType": "scroll"');

      // and it really rendered
      await expect(preview(page)).toContainText(marker);
      await expect(page.frameLocator('[data-testid="preview"]').locator('.o-venn svg').first()).toBeAttached();

      const saved = await nativeTool(page, 'save_deck');
      expect(saved.isError).toBe(false);
      expect(saved.body).toMatchObject({ saved: false, validated: true, title: 'Native Agent Run', slides: 3 });
      console.log(`  drove ${8} native executeTool calls on Chrome ${c.version}; final Fold ${saved.body.bytes} bytes`);
    } finally {
      await close(c);
    }
  });

  test('a table baked by the real calc engine, through the native surface', async () => {
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);
      await expect(c.page.getByTestId('mcp-status')).toContainText('connected');
      await nativeTool(c.page, 'create_deck', { title: 'Native Ledger', discard: true });
      const added = await nativeTool(c.page, 'add_chunk', { kind: 'table', label: 'Budget' });
      expect(added.isError).toBe(false);

      // the built-in starter: 3*4, 2*5, SUM
      await expect
        .poll(
          async () => {
            const m = /data-odata="table"[^>]*>([\s\S]*?)<\/script>/.exec(await deckTextNow(c.page));
            if (!m) return null;
            try {
              return JSON.parse(m[1]!.replace(/\\u003c/g, '<')).rows.map((r: string[]) => r[3]);
            } catch {
              return null;
            }
          },
          { timeout: 5000 }
        )
        .toEqual(['12', '10', '22']);
    } finally {
      await close(c);
    }
  });
});
