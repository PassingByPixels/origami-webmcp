/* Static build. One esbuild bundle + a handful of copies; the output in dist/ is uploadable
   to any static host as-is. No CDN, no runtime npm dependency, no server.

   dist/ is the WHOLE origami.gratis site (docs/SITE.md):
     index.html · privacy/ · design/   the static pages, built from src/site/
     folio/                            the Folio Web app, self-contained under its own path
     draw/ · charts/ · gantt/          the mini tools — the same app, mode-scoped to one block
   Every path the pages use is relative, so the same zip hosts at a domain root or a subpath.

   EVERY TOOL PAGE IS SELF-CONTAINED. Each gets its own bundle, its own styles.css and its own
   copy of the viewer IIFE, so a directory can be lifted out whole and still work, and so no page
   can break another by moving a shared chunk. That costs disk (four copies of a 240 KB runtime)
   and buys the property docs/SITE.md asks for. */
import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { CRANE_FILE, renderPage } from './src/site/parts.mjs';
import { scanExternalUrls } from './src/site/guard.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const folio = join(dist, 'folio');
const serve = process.argv.includes('--serve');

/* The three mini tool pages. `tag` is the subbrand in the shell header and must equal the
   matching mode's `tag` in src/core/modes.ts — tests/e2e/mini.spec.ts imports MODES and asserts
   the rendered header against it, so the two declarations cannot drift unnoticed. */
const TOOL_PAGES = [
  { dir: 'draw', entry: 'src/app/draw.ts', tag: 'Draw', title: 'Origami Draw', noun: 'drawing' },
  { dir: 'charts', entry: 'src/app/charts.ts', tag: 'Charts', title: 'Origami Charts', noun: 'chart' },
  { dir: 'gantt', entry: 'src/app/gantt.ts', tag: 'Gantt', title: 'Origami Gantt', noun: 'roadmap' },
];

/* Deck payloads, not app code: the guard's rules do not apply to a .origami.html a user made
   or to the viewer IIFE the runtime ships (one copy per tool page). */
const NOT_APP_CODE = (rel) => rel.startsWith('folio/sample/') || /(^|\/)origami-runtime\.iife\.js$/.test(rel);

await rm(dist, { recursive: true, force: true });
await mkdir(join(folio, 'sample'), { recursive: true });

/** One page's esbuild options. Every tool page is bundled into its OWN directory. */
const bundleFor = (entry, outdir) => ({
  entryPoints: [join(root, entry)],
  outdir,
  entryNames: 'app',
  // @origami/runtime is a 340 KB dynamic import used only by create_deck — code-split so the
  // page that only OPENS a Fold never downloads it.
  chunkNames: 'chunk-[hash]',
  splitting: true,
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: !serve,
  sourcemap: serve,
  legalComments: 'none',
  logLevel: 'info',
});

const BUNDLES = [bundleFor('src/app/main.ts', folio), ...TOOL_PAGES.map((p) => bundleFor(p.entry, join(dist, p.dir)))];

async function copyStatics() {
  /* ---- the Folio app, whole, one directory down ---- */
  await cp(join(root, 'src/app/index.html'), join(folio, 'index.html'));
  await appAssets(folio);
  // a Fold to open with one click, so the app is testable with nothing else on disk
  await cp(join(root, 'sample/welcome.origami.html'), join(folio, 'sample/welcome.origami.html'));

  /* ---- the mini tools: one shell template, three pages ---- */
  const shell = await readFile(join(root, 'src/app/mini.html'), 'utf8');
  for (const p of TOOL_PAGES) {
    const out = join(dist, p.dir);
    await mkdir(out, { recursive: true });
    await writeFile(
      join(out, 'index.html'),
      shell.replaceAll('__TITLE__', p.title).replaceAll('__TAG__', p.tag).replaceAll('__NOUN__', p.noun),
      'utf8'
    );
    await appAssets(out);
  }

  /* ---- the site ---- */
  await writeFile(join(dist, 'favicon.svg'), CRANE_FILE, 'utf8');
  await writeFile(join(dist, 'site.css'), await siteCss(), 'utf8');
  await page('index.html', join(dist, 'index.html'), '');
  await page('privacy.html', join(dist, 'privacy/index.html'), '../');
  await page('design.html', join(dist, 'design/index.html'), '../');
}

/** The three files every tool page needs beside its bundle. */
async function appAssets(out) {
  await cp(join(root, 'src/app/styles.css'), join(out, 'styles.css'));
  await writeFile(join(out, 'favicon.svg'), CRANE_FILE, 'utf8');
  // the viewer IIFE is fetched at runtime when a Fold is minted (see src/core/blank-deck.ts)
  await cp(join(root, 'vendor/runtime-dist/origami-runtime.iife.js'), join(out, 'origami-runtime.iife.js'));
}

/** The site's stylesheet, with the app's own token block spliced in — one source for both. */
async function siteCss() {
  const app = await readFile(join(root, 'src/app/styles.css'), 'utf8');
  const tokens = app.match(/^:root \{[\s\S]*?^\}/m);
  if (!tokens) throw new Error('build: no :root token block in src/app/styles.css — site.css would ship without tokens');
  const css = await readFile(join(root, 'src/site/site.css'), 'utf8');
  if (!css.includes('/*TOKENS*/')) throw new Error('build: src/site/site.css lost its /*TOKENS*/ marker');
  return css.replace('/*TOKENS*/', tokens[0]);
}

/** Render one static page: the shared header/footer, the flower and the cards come from
    src/site/parts.mjs, so the petal config is the only place a tool is declared. */
async function page(src, out, up) {
  const html = await readFile(join(root, 'src/site', src), 'utf8');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderPage(html, up), 'utf8');
}

await copyStatics();

if (serve) {
  // Every page is watched; the FIRST context serves dist/, which holds all of them.
  const ctxs = await Promise.all(BUNDLES.map((o) => esbuild.context(o)));
  for (const ctx of ctxs) await ctx.watch();
  const { host, port } = await ctxs[0].serve({ servedir: dist, host: '127.0.0.1', port: 5173 });
  console.log(`\n  origami.gratis  →  http://${host}:${port}/          (Folio: /folio/ · ${TOOL_PAGES.map((p) => `/${p.dir}/`).join(' · ')})\n`);
} else {
  for (const o of BUNDLES) await esbuild.build(o);
  await report();
}

async function report() {
  let total = 0;
  const rows = [];
  for (const rel of await walk(dist)) {
    const bytes = (await stat(join(dist, rel))).size;
    total += bytes;
    rows.push([rel, bytes]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log('\n  dist/');
  for (const [rel, bytes] of rows) console.log(`    ${(bytes / 1024).toFixed(1).padStart(9)} KB  ${rel}`);
  console.log(`    ${'─'.repeat(9)}`);
  console.log(`    ${(total / 1024 / 1024).toFixed(2).padStart(9)} MB  total\n`);

  // fail the build rather than silently shipping a CDN reference (rules in src/site/guard.mjs)
  const offenders = [];
  for (const rel of await walk(dist)) {
    if (NOT_APP_CODE(rel)) continue;
    offenders.push(...scanExternalUrls(rel, await readFile(join(dist, rel), 'utf8')));
  }
  if (offenders.length) {
    console.error('\n  BUILD FAILED — external URL references:');
    for (const o of offenders) console.error(`    ${o}`);
    console.error('');
    process.exitCode = 1;
    throw new Error(`${offenders.length} external URL reference(s) in dist/`);
  }
  console.log('  no external URL references beyond the vendored allowlist.\n');
}

async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}
