import { defineConfig, devices } from '@playwright/test';

/**
 * Focus (http://vst-focus-seven/) test suite.
 *
 * Focus is a server-rendered ASP.NET Core app (jQuery + Kendo UI + Bootstrap 5).
 * There is no login: every page is reachable anonymously.
 *
 * Safety: tests that mutate server state are tagged @destructive and are
 * EXCLUDED by default. Run them deliberately with `npm run test:destructive`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    // Files unexpected failures into Axosoft. Silent unless AXOSOFT_URL and
    // AXOSOFT_PROJECT_ID are set, and dry-run unless AXOSOFT_CREATE_DEFECTS=1,
    // so local runs are unaffected. See docs/axosoft-integration.md.
    ['./src/reporting/axosoft-reporter.ts'],
  ],

  use: {
    baseURL: process.env.FOCUS_BASE_URL ?? 'http://vst-focus-seven',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // Kendo grids/charts are wide; give them room so columns are not virtualised away.
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Anything that writes to the server is opt-in only.
      grepInvert: /@destructive/,
    },
    {
      name: 'destructive',
      use: { ...devices['Desktop Chrome'] },
      grep: /@destructive/,
      // Server-side jobs (re-optimise, bulk override) must not run concurrently.
      workers: 1,
      fullyParallel: false,
    },
  ],
});
