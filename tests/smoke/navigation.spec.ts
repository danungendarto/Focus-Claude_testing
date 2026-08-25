import { test, expect } from '../../src/fixtures';
import { ROUTES } from '../../src/data/focus';

/**
 * The navbar is the only way a user reaches anything, so it gets tested as a
 * user uses it: open the menu, click the item, land on the page.
 */

const MENU_ITEMS: Array<{ menu: string; item: string; route: string }> = [
  { menu: 'Reports', item: 'Inventory Summary', route: ROUTES.inventorySummary },
  { menu: 'Reports', item: 'Booking Pace Summary', route: ROUTES.bookingPaceSummary },
  { menu: 'Reports', item: 'Booking / Discount Pace', route: ROUTES.bookingDiscountPace },
  { menu: 'Reports', item: 'Program vs. Forecast', route: ROUTES.programVsForecast },
  { menu: 'Reports', item: 'Above Below Forecast', route: ROUTES.aboveBelowForecast },
  { menu: 'Forecast', item: 'Create and View Forecasts', route: ROUTES.forecast },
  { menu: 'Forecast', item: 'Forecast Blacklists', route: ROUTES.forecastBlacklists },
  { menu: 'Forecast', item: 'Forecast Discount Curves', route: ROUTES.forecastDiscountCurves },
  { menu: 'Optimise', item: 'Optimiser Rules', route: ROUTES.optimiserRules },
  { menu: 'Optimise', item: 'Grid Maintenance', route: ROUTES.gridMaintenance },
  { menu: 'Optimise', item: 'Re-Optimise', route: ROUTES.reOptimise },
  { menu: 'Optimise', item: 'Bulk Override Flags', route: ROUTES.bulkOverride },
];

test.describe('@smoke navbar', () => {
  for (const { menu, item, route } of MENU_ITEMS) {
    test(`${menu} > ${item} navigates to ${route}`, async ({ page, basePage, diagnostics }) => {
      await basePage.goto('home');
      await basePage.navigateViaMenu(menu, item);

      expect(new URL(page.url()).pathname).toBe(route);
      diagnostics.expectClean();
    });
  }

  test('Recommendations is a direct link, not a dropdown', async ({ page, basePage }) => {
    await basePage.goto('home');
    await page.locator('.navbar a[href="/Recommendations"]').click();
    await basePage.waitUntilReady();

    expect(new URL(page.url()).pathname).toBe(ROUTES.recommendations);
  });

  test('every navbar link points at a route that exists', async ({ page, basePage, request }) => {
    await basePage.goto('home');

    const hrefs = await page.locator('.navbar a[href]').evaluateAll((links) =>
      links
        .map((a) => a.getAttribute('href') || '')
        .filter((h) => h.startsWith('/')),
    );

    expect(hrefs.length, 'navbar should expose links').toBeGreaterThan(10);

    for (const href of new Set(hrefs)) {
      const res = await request.get(href);
      expect(res.status(), `navbar link ${href}`).toBe(200);
    }
  });
});

test('@smoke filter selections persist across a reload', async ({ page, inventorySummary }) => {
  await inventorySummary.open();
  const original = (await inventorySummary.timeRange()).start;

  await inventorySummary.setTimeRange('0600', '2359');
  await page.reload();
  await inventorySummary.waitUntilReady();

  expect(
    (await inventorySummary.timeRange()).start,
    'Focus should restore the previous start time after a reload',
  ).toBe('0600');
  expect(original, 'sanity: the default differs from the value under test').not.toBe('0600');
});

test('@smoke reset page filters restores the defaults', async ({ page, basePage, inventorySummary }) => {
  await inventorySummary.open();
  const defaultStart = (await inventorySummary.timeRange()).start;

  await inventorySummary.setTimeRange('0600', '2359');
  expect((await inventorySummary.timeRange()).start).toBe('0600');

  page.once('dialog', (d) => d.accept());
  await page.locator('.navbar .fa-gear').click();
  await page.locator('#reset-page-filters-link').click();
  await basePage.waitUntilReady();

  // The reset clears storage and reloads; the page then re-seeds its defaults,
  // so the observable contract is "back to default", not "storage is empty".
  expect(
    (await inventorySummary.timeRange()).start,
    'reset should restore the default start time',
  ).toBe(defaultStart);
});
