import { test, expect } from '../../src/fixtures';
import { ROUTES, PAGE_TITLES, PAGE_HEADINGS, type RouteKey } from '../../src/data/focus';

/**
 * Every route, loaded cold. This is the suite's canary: if Focus is broken at
 * the deployment level, these fail first and everything else is noise.
 */
test.describe('@smoke every route loads', () => {
  for (const key of Object.keys(ROUTES) as RouteKey[]) {
    test(`${key} (${ROUTES[key]}) loads without browser errors`, async ({ page, basePage, diagnostics }) => {
      const response = await page.goto(ROUTES[key]);

      expect(response?.status(), 'HTTP status').toBe(200);
      await expect(page).toHaveTitle(PAGE_TITLES[key]);

      await basePage.waitUntilReady();

      // Shared chrome must render on every page.
      await expect(basePage.navbar).toBeVisible();
      await expect(basePage.logo).toBeVisible();
      await expect(basePage.footer).toBeVisible();

      const heading = PAGE_HEADINGS[key];
      if (heading) {
        await expect(basePage.pageTitle).toHaveText(heading);
      }

      await basePage.expectNoErrors();
      diagnostics.expectClean();
    });
  }
});

test('@smoke footer reports the data snapshot vintage', async ({ basePage }) => {
  await basePage.goto('home');
  const meta = await basePage.readFooterMetadata();

  // Figures in every other test are only meaningful against a known snapshot,
  // so assert the vintage is present and surface it in the report.
  expect(meta.latestSnapshot, 'latest snapshot date').toMatch(/\d{2}\/\d{2}\/\d{4}/);
  expect(meta.version, 'version string').toMatch(/Version \d+\.\d+\.\d+/);

  test.info().annotations.push({ type: 'data-snapshot', description: JSON.stringify(meta) });
});

test('@smoke unknown routes do not return a 200 shell', async ({ page }) => {
  const response = await page.goto('/ThisRouteDoesNotExist', { waitUntil: 'domcontentloaded' });

  // A 200 here would mean Focus silently serves a blank page for typos, which
  // hides broken links from users and from this suite.
  expect(response?.status(), 'status for an unknown route').not.toBe(200);
});
