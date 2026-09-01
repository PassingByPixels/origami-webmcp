/* Local harness so a text-only, shell-only agent can drive Origami WebMCP's real tool surface.
   Starts the same static server the e2e suite uses (serving dist/ untouched), launches headless
   Chromium via Playwright, installs the same recording `document.modelContext` shim
   tests/e2e/agent-run.spec.ts uses, and exposes the registered tools over a tiny loopback-only
   HTTP API. Nothing here touches src/ — it drives the SHIPPED bundle exactly like the e2e test does.

   Usage: node tools/agent-bridge.mjs [--page folio|charts|draw|gantt] [--static-port 5188] [--bridge-port 5189]
*/
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const OUT_DIR = join(HERE, 'out');

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PAGE = argVal('--page', 'folio');
const STATIC_PORT = Number(argVal('--static-port', '5188'));
const BRIDGE_PORT = Number(argVal('--bridge-port', '5189'));
const PAGES = new Set(['folio', 'charts', 'draw', 'gantt']);
if (!PAGES.has(PAGE)) {
  console.error(`[bridge] unknown --page "${PAGE}" — one of ${[...PAGES].join(', ')}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

/* ---------- static server (dist/, loopback only) ---------- */
const staticServer = spawn(process.execPath, [join(REPO_ROOT, 'tests/e2e/static-server.mjs'), String(STATIC_PORT)], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
});
staticServer.on('exit', (code) => {
  if (code !== null && code !== 0) console.error(`[bridge] static server exited with code ${code}`);
});
await new Promise((resolve, reject) => {
  const deadline = Date.now() + 10_000;
  (async function poll() {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${STATIC_PORT}/${PAGE}/index.html`);
        if (res.ok) return resolve();
      } catch {
        /* server not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    reject(new Error('static server did not come up in time'));
  })();
});

/* ---------- browser + recording host (same shape as tests/e2e/agent-run.spec.ts) ---------- */
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleLog = [];
function pushLog(entry) {
  consoleLog.push({ ts: Date.now(), ...entry });
  if (consoleLog.length > 200) consoleLog.shift();
}
page.on('console', (msg) => pushLog({ kind: 'console', type: msg.type(), text: msg.text() }));
page.on('pageerror', (err) => pushLog({ kind: 'pageerror', text: String(err?.stack ?? err) }));

await page.addInitScript(() => {
  const registered = [];
  Object.defineProperty(document, 'modelContext', {
    value: {
      registered,
      async registerTool(def) {
        registered.push(def);
      },
    },
    configurable: true,
  });
  window.__mcp = document.modelContext;
});

async function waitForRegistration() {
  await page.goto(`http://127.0.0.1:${STATIC_PORT}/${PAGE}/index.html`);
  await page.waitForFunction(() => Array.isArray(window.__mcp?.registered) && window.__mcp.registered.length > 0, {
    timeout: 15_000,
  });
}

try {
  await waitForRegistration();
} catch (err) {
  console.error('[bridge] registration never completed:', err?.message ?? err);
  console.error('[bridge] last console/page errors:', JSON.stringify(consoleLog.slice(-20), null, 2));
  await browser.close();
  staticServer.kill();
  process.exit(1);
}

async function listTools() {
  return page.evaluate(() =>
    window.__mcp.registered.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      annotations: d.annotations ?? null,
    }))
  );
}

/** Invoke a registered tool the way a WebMCP host would, timing the call INSIDE the page. */
async function callTool(name, args) {
  const { res, ms } = await page.evaluate(
    async ([n, a]) => {
      const def = window.__mcp.registered.find((d) => d.name === n);
      const t0 = performance.now();
      if (!def) {
        return { res: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: `no such tool: ${n}` }) }] }, ms: 0 };
      }
      const out = await def.execute(a);
      return { res: out, ms: performance.now() - t0 };
    },
    [name, args]
  );
  const isError = !!res.isError;
  const raw = res.content?.[0]?.text ?? '';
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  const roundedMs = Math.round(ms * 100) / 100;
  console.log(`[bridge] call ${name} ${roundedMs}ms isError=${isError}`);
  return { isError, body, ms: roundedMs };
}

let shotCounter = 0;

/* ---------- tiny loopback-only JSON API ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/tools') {
      return sendJson(res, 200, await listTools());
    }
    if (req.method === 'POST' && url.pathname === '/call') {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch (e) {
        return sendJson(res, 400, { error: `bad JSON body: ${e.message}` });
      }
      const { name, args } = parsed;
      if (typeof name !== 'string') return sendJson(res, 400, { error: 'body must be {name, args}' });
      const result = await callTool(name, args ?? {});
      return sendJson(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/screenshot') {
      shotCounter += 1;
      const path = join(OUT_DIR, `shot-${shotCounter}.png`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path });
      return sendJson(res, 200, { path });
    }
    if (req.method === 'GET' && url.pathname === '/deck') {
      const text = await page.getAttribute('[data-testid="preview"]', 'srcdoc').catch(() => null);
      const value = text ?? '';
      return sendJson(res, 200, { bytes: Buffer.byteLength(value, 'utf8'), text: value });
    }
    if (req.method === 'GET' && url.pathname === '/activity') {
      const result = await callTool('list_activity', {});
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      await waitForRegistration();
      return sendJson(res, 200, { ok: true, tools: (await listTools()).length });
    }
    if (req.method === 'GET' && url.pathname === '/console') {
      return sendJson(res, 200, consoleLog.slice(-200));
    }
    if (req.method === 'POST' && url.pathname === '/quit') {
      sendJson(res, 200, { ok: true });
      setTimeout(async () => {
        await browser.close().catch(() => {});
        staticServer.kill();
        server.close();
        process.exit(0);
      }, 50);
      return;
    }
    sendJson(res, 404, { error: `no such route: ${req.method} ${url.pathname}` });
  } catch (err) {
    sendJson(res, 500, { error: String(err?.stack ?? err) });
  }
});

server.listen(BRIDGE_PORT, '127.0.0.1', async () => {
  const tools = await listTools();
  console.log(`[bridge] ready: ${tools.length} tools on http://127.0.0.1:${BRIDGE_PORT}`);
});

process.on('SIGINT', async () => {
  await browser.close().catch(() => {});
  staticServer.kill();
  process.exit(0);
});
