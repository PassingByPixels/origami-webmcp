/* Static build. One esbuild bundle + a handful of copies; the output in dist/ is uploadable
   to any static host as-is. No CDN, no runtime npm dependency, no server. */
import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const serve = process.argv.includes('--serve');

/* The same crane the deck runtime stamps on a Fold (runtime-dist STATIC_CRANE_SVG). */
const CRANE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#557A4E"><polygon points="30,40 47,40 52,11" opacity="0.45"/><polygon points="26,40 48,40 43,7" opacity="0.92"/><polygon points="44,40 62,29 47,48" opacity="0.72"/><polygon points="28,39 48,41 36,55"/><polygon points="21,44 28,39 36,55" opacity="0.7"/><polygon points="9,12 15,13 28,41 22,44" opacity="0.85"/><polygon points="9,12 15,13 14,19 2,17"/></g></svg>';

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'sample'), { recursive: true });

const options = {
  entryPoints: [join(root, 'src/app/main.ts')],
  outdir: dist,
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
};

async function copyStatics() {
  await cp(join(root, 'src/app/index.html'), join(dist, 'index.html'));
  await cp(join(root, 'src/app/styles.css'), join(dist, 'styles.css'));
  await writeFile(join(dist, 'favicon.svg'), CRANE_SVG, 'utf8');
  // the viewer IIFE is fetched at runtime by create_deck (see src/core/blank-deck.ts)
  await cp(join(root, 'vendor/runtime-dist/origami-runtime.iife.js'), join(dist, 'origami-runtime.iife.js'));
  // a Fold to open with one click, so the app is testable with nothing else on disk
  await cp(join(root, 'sample/welcome.origami.html'), join(dist, 'sample/welcome.origami.html'));
}

await copyStatics();

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: dist, host: '127.0.0.1', port: 5173 });
  console.log(`\n  Origami Folio Web  →  http://${host}:${port}\n`);
} else {
  await esbuild.build(options);
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

  // fail loudly rather than silently shipping a CDN reference
  const offenders = [];
  for (const rel of await walk(dist)) {
    if (rel.startsWith('sample/') || rel === 'origami-runtime.iife.js') continue; // deck payloads, not app code
    const text = await readFile(join(dist, rel), 'utf8');
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) offenders.push(`${rel}: ${m[0]}`);
  }
  if (offenders.length) {
    console.log('  external URL references in app code:');
    for (const o of offenders) console.log(`    ${o}`);
  } else {
    console.log('  no external URL references in app code.\n');
  }
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
