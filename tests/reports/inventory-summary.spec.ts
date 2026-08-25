import { test, expect } from '../../src/fixtures';
import { MARKETS, toFocusDate } from '../../src/data/focus';
import { readDropDownList, readDropDownListOptions } from '../../src/kendo/kendo';

/**
 * Inventory Summary is the richest report page and the template for the other
 * four, so it carries the deepest UI coverage. What is proven here about the
 * shared filter/grid/chart layout is only spot-checked elsewhere.
 */

test.describe('@report inventory summary', () => {
  test.beforeEach(async ({ inventorySummary }) => {
    await inventorySummary.open();
  });

  test('renders filters, grid and chart with data', async ({ inventorySummary, diagnostics }) => {
    await expect(inventorySummary.filtersContainer).toBeVisible();
    await expect(inventorySummary.grid).toBeVisible();
    await expect(inventorySummary.exportButton).toBeVisible();

    const grid = await inventorySummary.gridState();
    expect(grid.exists, 'Kendo grid should be initialised').toBe(true);
    expect(grid.columns.length, 'grid should declare columns').toBeGreaterThan(0);

    expect(await inventorySummary.hasChart(), 'booking pace chart should render').toBe(true);
    diagnostics.expectClean();
  });

  test('the grid exposes the expected column groups', async ({ inventorySummary }) => {
    const { columns } = await inventorySummary.gridState();

    // These are the business columns a planner reads the report for. Losing one
    // to a binding change is a silent, high-impact regression.
    for (const expected of ['Program', 'Durations', 'Inventory Usage', 'Revenue']) {
      expect(columns, `grid should expose the "${expected}" column group`).toContain(expected);
    }
  });

  test('filters default to a sensible starting position', async ({ inventorySummary }) => {
    const { start, end } = await inventorySummary.dateRange();
    const times = await inventorySummary.timeRange();

    expect(start, 'start date should be populated').toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(end, 'end date should be populated').toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(Number(times.start), 'start time should be a valid HHmm').toBeGreaterThanOrEqual(0);
    expect(Number(times.end), 'end time should be after start time')
      .toBeGreaterThan(Number(times.start));
  });

  test('changing the time range refetches and narrows the report', async ({ page, inventorySummary }) => {
    const before = await inventorySummary.gridState();
    test.skip(before.total === 0, 'no inventory data for the default window');

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/ProgramInventory')) requests.push(r.url());
    });

    // Narrow from the default evening window to a single hour.
    await inventorySummary.setTimeRange('1800', '1859');
    await inventorySummary.waitForGrid();

    expect(requests.length, 'changing a filter should refetch').toBeGreaterThan(0);
    expect(requests.at(-1), 'the new time range should reach the server').toContain('endTime=1859');

    const after = await inventorySummary.gridState();
    expect(after.total, 'a narrower window cannot return more rows')
      .toBeLessThanOrEqual(before.total);
  });

  test('a date range with no broadcast data empties the grid rather than erroring', async ({
    inventorySummary,
  }) => {
    const farPast = new Date(1990, 0, 7);
    const farPastEnd = new Date(1990, 0, 13);

    await inventorySummary.setDateRange(toFocusDate(farPast), toFocusDate(farPastEnd));
    await inventorySummary.waitForGrid();

    const grid = await inventorySummary.gridState();
    expect(grid.total, 'there is no 1990 inventory in Focus').toBe(0);
    await inventorySummary.expectNoErrors();
  });

  test('selecting a single market scopes the report to it', async ({ page, inventorySummary }) => {
    const sydney = MARKETS.find((m) => m.code === 'SYD')!;

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/ProgramInventory')) requests.push(r.url());
    });

    await inventorySummary.setMarketIds([sydney.id]);
    await inventorySummary.waitForGrid();

    expect(requests.at(-1), 'the selected market should reach the server')
      .toContain(`selectedStations=${sydney.id}`);
  });

  test('the Summary By selector changes how rows are grouped', async ({ page, inventorySummary }) => {
    // Wait for the grid's own fetch before reading it. Without this the rows
    // read as empty on a slow run and the test skips itself, which looks like
    // "no data" when it is really "not loaded yet".
    await inventorySummary.waitForGrid();

    const before = await inventorySummary.rows(50);
    test.skip(before.length === 0, 'no rows to regroup');

    // "Summary By" is the pivot of this report: Program, Daypart, Week and so on.
    const options = await readDropDownListOptions(page, 'pir-filter-SummaryType');
    const current = await readDropDownList(page, 'pir-filter-SummaryType');

    test.skip(options.length < 2, 'only one summary option available');
    const other = options.find((o) => o !== current);
    test.skip(!other, 'no alternative summary option');

    await inventorySummary.setSummaryBy(other as string);
    await inventorySummary.waitForGrid();

    await inventorySummary.expectNoErrors();
    const after = await inventorySummary.gridState();
    expect(after.exists, 'grid should survive a regroup').toBe(true);
    expect(
      await readDropDownList(page, 'pir-filter-SummaryType'),
      'the selector should hold the newly chosen grouping',
    ).toBe(other);
  });

  test('Export produces a downloadable file', async ({ inventorySummary }) => {
    const grid = await inventorySummary.gridState();
    test.skip(grid.total === 0, 'nothing to export');

    const download = await inventorySummary.export();

    expect(download.suggestedFilename(), 'export should have a real filename')
      .toMatch(/\.(xlsx|xls|csv|pdf)$/i);

    const path = await download.path();
    expect(path, 'export file should be written to disk').toBeTruthy();
  });
});

test.describe('@report all report pages share the standard layout', () => {
  test('every report page initialises its grid', async ({
    inventorySummary, bookingPaceSummary, aboveBelowForecast,
    bookingDiscountPace, programVsForecast, diagnostics,
  }) => {
    const reports = {
      inventorySummary, bookingPaceSummary, aboveBelowForecast,
      bookingDiscountPace, programVsForecast,
    };

    for (const [name, reportPage] of Object.entries(reports)) {
      await reportPage.open();
      await reportPage.waitForGrid();

      const grid = await reportPage.gridState();
      expect(grid.exists, `${name} should initialise a Kendo grid`).toBe(true);
      expect(grid.columns.length, `${name} should declare columns`).toBeGreaterThan(0);

      await reportPage.expectNoErrors();
    }

    diagnostics.expectClean();
  });
});
