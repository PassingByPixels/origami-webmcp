import { defineConfig, devices } from '@playwright/test';

/* Real Chromium against the REAL static build — the same dist/ a human would upload.
   The web server is esbuild's, the one `npm run serve` starts, so the test drives exactly
   the surface the README tells the maintainer to open. */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/e2e/static-server.mjs 5174',
    url: 'http://127.0.0.1:5174/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
    timeout: 30_000,
  },
});
