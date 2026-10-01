import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../../src/fixtures';
import { readGridLeafColumns } from '../../src/kendo/kendo';
import { type RecommendationsPage } from '../../src/pages/OptimisePages';
import { recommendationsWeek, spanWeeks, toPickerDate, type IsoWeek } from '../../src/data/live-scopes';

/**
 * Recommendations — the optimiser's output, and the page a planner actually
 * acts on.
 *
 * Converted from a recorded session (see docs/recording-tests.md). The recording
 * discovered something worth keeping: the page's default filters return an empty
 * grid even when recommendations exist (FOCUS-KI-004). The Recommendations
 * filter defaults to "Any Change", and since the 1 Oct 2026 re-optimise no
 * Manual recommendation on test matches it in ANY date range. So a test that
 * needs rows sets that filter to "All". Widening the range is not enough.
 *
 * SAFETY: this page writes in more places than it looks like it does.
 *   - Send and Bulk Override write, and cannot be undone.
 *   - The grid's inline flag / minimum-rate editors POST to
 *     /api/Recommendations/UserFlags and /UserMinRate immediately on change —
 *     there is no save step.
 *   - Opening the recommendation editor (only possible from the SCHEDULER view)
 *     POSTs /api/Recommendations/SetInspected before the window even appears.
 *
 * Nothing in this file touches any of them. The editor is covered in
 * tests/destructive/ instead, because opening it is itself a write.
 */

/**
 * Recommendations are generated forward from the data snapshot, so a fixed
 * range goes empty at the next re-import. Until 1 Oct 2026 this was
 * 03/05-29/08/2026, which then lost every recommendation. The range is now
 * worked out from the snapshot: the first full week after it, and a span of
 * POPULATED_WEEKS from there (see src/data/live-scopes.ts).
 */
const POPULATED_WEEKS = 4;

/** Shows recommendations that exist: the span after the snapshot, filter "All". */
async function showPopulated(
  recommendations: RecommendationsPage, request: APIRequestContext, weeks = POPULATED_WEEKS,
): Promise<IsoWeek> {
  const range = spanWeeks(await recommendationsWeek(request), weeks);
  await recommendations.setRecommendationFilter('All');
  await recommendations.setDateRange(toPickerDate(range.start), toPickerDate(range.end));
  await recommendations.waitForGrid();
  return range;
}

test.describe('@report recommendations', () => {
  test.beforeEach(async ({ recommendations }) => {
    await recommendations.open();
  });

  test('the page renders its grid, filters and tabs', async ({ recommendations, diagnostics }) => {
    await expect(recommendations.tabStrip).toBeVisible();
    await expect(recommendations.grid).toBeVisible();

    const state = await recommendations.state();
    expect(state.exists, 'Kendo grid should be initialised').toBe(true);

    // The columns a planner reads before accepting a recommendation.
    for (const column of ['Program', 'Bookings', 'Forecast', 'Rate', 'Indicator', 'Status']) {
      expect(state.columns, `grid should expose the "${column}" column`).toContain(column);
    }

    diagnostics.expectClean();
  });

  test('widening the date range keeps every recommendation', async ({ recommendations, request }) => {
    const week = await showPopulated(recommendations, request, 1);
    const single = (await recommendations.state()).total;
    expect(single, `the first week after the snapshot (${week.start}) should have recommendations`)
      .toBeGreaterThan(0);

    const span = await showPopulated(recommendations, request);
    const widened = (await recommendations.state()).total;
    expect(widened, `${span.start}..${span.end} contains ${week.start}, so it cannot have fewer rows`)
      .toBeGreaterThanOrEqual(single);

    await recommendations.expectNoErrors();
  });

  test('Both returns at least as many recommendations as Manual alone', async ({
    recommendations, request,
  }) => {
    await showPopulated(recommendations, request);

    // Manual is the page default; assert it rather than assume it.
    expect(await recommendations.currentOptimisationType()).toBe('Manual');
    const manual = (await recommendations.state()).total;
    test.skip(manual === 0, 'no manual recommendations in this range');

    await recommendations.setOptimisationType('Both');
    await recommendations.waitForGrid();
    const both = (await recommendations.state()).total;

    // "Both" is Manual plus Automatic, so it is a superset by definition. This
    // is the relationship worth pinning -- the row counts themselves change
    // every time the optimiser runs.
    expect(both, '"Both" must include everything "Manual" returned')
      .toBeGreaterThanOrEqual(manual);
  });

  test('the grid can be sorted by a leaf column without losing rows', async ({ recommendations, request }) => {
    await showPopulated(recommendations, request);

    const before = await recommendations.state();
    test.skip(before.total === 0, 'no recommendations to sort');

    // "Title", not "Program". The grid uses grouped headers: "Program" is a
    // spanning header over Channel/Market/Week/Day/Time/Title and is not
    // sortable, so clicking it does nothing at all.
    await recommendations.sortBy('Title');
    await recommendations.waitForGrid();

    const after = await recommendations.state();
    expect(after.total, 'sorting must not change how many rows there are')
      .toBe(before.total);

    await recommendations.expectNoErrors();
  });

  test('the grid exposes its grouped and leaf columns', async ({ page, recommendations, request }) => {
    await showPopulated(recommendations, request);

    const leaves = await readGridLeafColumns(page, 'rec-grid');

    // The leaf columns a planner actually reads a recommendation from.
    for (const column of ['Channel', 'Market', 'Week', 'Title', 'Capacity']) {
      expect(leaves, `grid should expose the leaf column "${column}"`).toContain(column);
    }
  });

  test('the write controls are present but are never operated here', async ({ recommendations, request }) => {
    await showPopulated(recommendations, request);
    test.skip((await recommendations.state()).total === 0, 'no recommendations loaded');

    // Documents the hazard rather than exercising it. Send, Bulk Override and
    // the inline accept checkboxes all write; the inline flag / min-rate editors
    // POST immediately on change with no save step. Anyone extending this file
    // needs to know that before clicking around in the grid.
    await expect(recommendations.sendButton).toBeVisible();
    expect(
      await recommendations.inlineAcceptCheckboxes.count(),
      'the grid renders inline accept checkboxes, which write when ticked',
    ).toBeGreaterThan(0);
  });
});
