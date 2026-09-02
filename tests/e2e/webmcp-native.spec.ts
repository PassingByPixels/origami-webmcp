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
    ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, args, acceptDownloads: true });
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

const URL = 'http://127.0.0.1:5174/folio/index.html';
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

  test('the app registers all 38 tools on Chrome\'s own modelContext', async () => {
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);

      // the app's own status line, read from the real browser
      await expect(c.page.getByTestId('mcp-status')).toHaveText('WebMCP: connected via document.modelContext — 38 tools');

      // and Chrome agrees: its registry holds them
      const tools = await c.page.evaluate(async () => {
        const t = await (document as any).modelContext.getTools();
        return t.map((x: any) => ({ name: x.name, hasDescription: typeof x.description === 'string' && x.description.length > 40, schema: typeof x.inputSchema }));
      });
      expect(tools).toHaveLength(38);
      expect(tools.map((t: any) => t.name).sort()).toEqual([
        'accept_proposal', 'add_chunk', 'add_custom_fold', 'add_fold', 'add_ledger', 'apply_theme', 'create_deck', 'define_block', 'delete_block',
        'delete_chunk', 'delete_theme', 'export_deck', 'get_block', 'get_kind_schema', 'inspect_render', 'list_activity', 'list_block_defs', 'list_chunks', 'list_proposals', 'list_starters', 'list_themes',
        'move_chunk', 'origami_guide', 'propose_add', 'propose_chunk', 'propose_delete', 'read_chunk', 'reject_proposal', 'run_batch', 'save_deck',
        'save_theme', 'set_block', 'set_chunk_meta', 'set_deck_meta', 'set_fold_type', 'set_header', 'undo', 'write_chunk',
      ]);
      expect(tools.every((t: any) => t.hasDescription)).toBe(true);
      console.log(`  Chrome ${c.version} getTools() -> ${tools.length} tools; inputSchema arrives as "${tools[0].schema}"`);
    } finally {
      await close(c);
    }
  });

  test('does Chrome hand tool ANNOTATIONS back to the agent?', async () => {
    /* An empirical question, not an assertion about this app. The app registers readOnlyHint /
       destructiveHint on 14 tools (proved against a recording host in webmcp-shim.spec.ts). What
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

  /* ---------------------------------------------------------------------------------------
     THE SAVE INVESTIGATION.

     The challenge that started it: "you were able to save the demo html without me, so it must
     be possible." It was, and it is worth being exact about how. demo/author-demo.mjs drives the
     page from NODE; it reads the finished deck out of the preview's srcdoc and then calls
     node:fs writeFile itself. Those bytes were written by a process on the machine, not by the
     page. Nothing inside the sandbox gained a new power.

     What the PAGE can do is measured below, on the installed stable Chrome, rather than assumed.
     --------------------------------------------------------------------------------------- */

  test('SAVE (b): a programmatic download with NO user activation', async () => {
    /* The trap this test exists to avoid: page.evaluate() runs WITH transient user activation, so
       the obvious version of this measurement passes for the wrong reason. The first attempt at it
       reported isActive:true and proved nothing. Everything here is therefore scheduled from a
       timer at page load — no evaluate, no click, nothing that hands the page activation at the
       moment of the attempt — and the activation state is recorded at the call itself. */
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    const started: string[] = [];
    c.page.on('download', (d) => started.push(d.suggestedFilename()));
    try {
      await c.page.addInitScript(() => {
        (window as any).__save = { stage: 'scheduled' };
        setTimeout(() => {
          const p = (window as any).__save;
          p.activationAtCall = {
            isActive: navigator.userActivation?.isActive,
            hasBeenActive: navigator.userActivation?.hasBeenActive,
          };
          for (const n of [1, 2]) {
            try {
              // window.URL, not URL: this file has a module-level `URL` const for the app's
              // address, and inside addInitScript tsc resolves the bare name to that string.
              const url = window.URL.createObjectURL(new Blob(['deck bytes ' + n], { type: 'text/html' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'gestureless-' + n + '.origami.html';
              document.body.append(a);
              a.click();
              a.remove();
              p['attempt' + n] = 'no throw';
            } catch (e) {
              p['attempt' + n] = 'threw: ' + String(e);
            }
          }
          p.stage = 'done';
        }, 6500); // well past the ~5s transient-activation window
      });
      await c.page.goto(URL);
      await c.page.waitForFunction(() => (window as any).__save?.stage === 'done', null, { timeout: 30_000 });
      await c.page.waitForTimeout(1500);
      const probe = await c.page.evaluate(() => (window as any).__save);

      console.log(`  SAVE (b) on Chrome ${c.version}, headless:`);
      console.log(`    userActivation at the call -> ${JSON.stringify(probe.activationAtCall)}`);
      console.log(`    attempt 1 -> ${probe.attempt1};  attempt 2 -> ${probe.attempt2}`);
      console.log(`    downloads the browser actually STARTED -> ${started.length} ${JSON.stringify(started)}`);
      console.log('    CAVEAT: Playwright runs with acceptDownloads, so a "Download multiple files?"');
      console.log('    prompt that a default profile might raise is auto-accepted here. This proves Chrome');
      console.log('    STARTS the download with no gesture, not that an un-automated profile never asks.');

      expect(probe.activationAtCall.isActive, 'the measurement is void if activation was present').toBe(false);
      expect(probe.attempt1).toBe('no throw');
      expect(probe.attempt2).toBe('no throw');
      // both, not just the first: the second is where multiple-download gating would bite
      expect(started, 'Chrome started BOTH gesture-less downloads').toHaveLength(2);
    } finally {
      await close(c);
    }
  });

  test('SAVE (c): save_deck writes the OPFS backstop and reports each outcome truthfully', async () => {
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);
      await expect(c.page.getByTestId('mcp-status')).toContainText('connected');
      await nativeTool(c.page, 'create_deck', { title: 'Save Investigation', discard: true });
      await nativeTool(c.page, 'add_chunk', { starter: 'venn' });

      const saved = await nativeTool(c.page, 'save_deck');
      console.log(
        `  SAVE (c) save_deck -> ${JSON.stringify({
          saved: saved.body.saved,
          opfs: saved.body.opfs,
          downloadStarted: saved.body.downloadStarted,
          durability: saved.body.durability,
        })}`
      );

      // no picker was ever clicked, so there is no handle and NOTHING may claim a file save
      expect(saved.body.saved, 'no handle was ever granted, so this must not claim a save').toBe(false);
      expect(saved.body.validated).toBe(true);
      expect(saved.body.durability).toMatch(/in this browser only/);

      // the backstop really wrote the whole Fold — read it back out of OPFS independently
      expect(saved.body.opfs.written).toBe(true);
      const readBack = await c.page.evaluate(async (path: string) => {
        const [dirName, fileName] = path.split('/');
        const root = await (navigator.storage as any).getDirectory();
        const dir = await root.getDirectoryHandle(dirName);
        const fh = await dir.getFileHandle(fileName);
        const f = await fh.getFile();
        const text = await f.text();
        return { size: f.size, hasVenn: text.includes('data-odata="venn"'), hasManifest: text.includes('id="origami-manifest"') };
      }, saved.body.opfs.path as string);

      console.log(`    OPFS read-back -> ${JSON.stringify(readBack)} (save_deck reported ${saved.body.bytes} bytes)`);
      expect(readBack.size).toBe(saved.body.bytes); // the same bytes, not a truncated copy
      expect(readBack.hasVenn, 'the OPFS copy is the WHOLE Fold, blocks included').toBe(true);
      expect(readBack.hasManifest).toBe(true);

      // and the human has a way back to those bytes — one click into the Save menu, whose
      // chevron stays enabled precisely so these bytes are reachable with no Fold open
      await c.page.getByTestId('btn-savemenu').click();
      await expect(c.page.getByTestId('btn-lastsave')).toBeVisible();
      await expect(c.page.getByTestId('btn-lastsave')).toContainText('Download last save');
    } finally {
      await close(c);
    }
  });

  test('SAVE (a): FSA handle persistence — what can and cannot be measured without a human', async () => {
    /* Honest limit. Whether a handle the human granted ONCE silently re-acquires write on a later
       visit needs someone to click a native Save-as dialog, which no automated browser can drive.
       What IS measurable without a human is measured; the rest is reported as unmeasured, with the
       exact experiment that would settle it. */
    const launched = await launchChrome(FEATURE_ARGS);
    if ('skip' in launched) skipLoudly(launched.skip);
    const c = launched as Chrome;
    try {
      await c.page.goto(URL);
      const facts = await c.page.evaluate(async () => {
        const root = await (navigator.storage as any).getDirectory();
        const fh = await root.getFileHandle('permission-probe.txt', { create: true });
        const est = await navigator.storage.estimate();
        return {
          showSaveFilePicker: typeof (window as any).showSaveFilePicker,
          showOpenFilePicker: typeof (window as any).showOpenFilePicker,
          queryPermissionOnHandle: typeof fh.queryPermission,
          requestPermissionOnHandle: typeof fh.requestPermission,
          permissionOfAnOpfsHandle: fh.queryPermission ? await fh.queryPermission({ mode: 'readwrite' }) : 'n/a',
          handleIsStructuredCloneable: (() => {
            try {
              structuredClone(fh);
              return true;
            } catch (e) {
              return String((e as Error).name);
            }
          })(),
          quotaMB: Math.round((est.quota ?? 0) / 1048576),
          storagePersisted: await navigator.storage.persisted?.(),
        };
      });

      console.log(`  SAVE (a) on Chrome ${c.version}: ${JSON.stringify(facts)}`);
      console.log('    MEASURED: the picker APIs exist, handles expose queryPermission/requestPermission,');
      console.log('    a handle is structured-cloneable (so it CAN be kept in IndexedDB between visits),');
      console.log(`    and the origin has a ${facts.quotaMB} MB quota against localStorage's ~5 MB.`);
      console.log('    NOT MEASURED: whether a handle granted by a human through showSaveFilePicker still');
      console.log('    reports "granted" on a LATER visit. That needs a real click on a native dialog, which');
      console.log('    no automated browser can drive. To settle it: press Save as... once, reload, and read');
      console.log('    handle.queryPermission({mode:"readwrite"}) before touching anything.');

      expect(facts.showSaveFilePicker).toBe('function');
      expect(facts.queryPermissionOnHandle).toBe('function');
      expect(facts.requestPermissionOnHandle).toBe('function');
      expect(facts.handleIsStructuredCloneable, 'a handle must be cloneable to survive in IndexedDB').toBe(true);
      expect(facts.quotaMB, 'OPFS must have far more room than the ~5 MB localStorage slot').toBeGreaterThan(100);
      // storage is NOT persistent by default — the caveat save_deck reports to the agent
      expect(facts.storagePersisted).toBe(false);
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
