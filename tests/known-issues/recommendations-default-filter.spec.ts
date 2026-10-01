import { test, expect } from '../../src/fixtures';
import { type RecommendationsPage } from '../../src/pages/OptimisePages';
import { recommendationsWeek, toPickerDate } from '../../src/data/live-scopes';

/**
 * FOCUS-KI-004: the Recommendations page hides real recommendations behind a
 * default filter, and says nothing about it.
 *
 * The "Recommendations" filter defaults to "Any Change" (changeStatus=2). On
 * test since the 1 Oct 2026 re-optimise, no Manual recommendation matches it
 * in any date range. So the grid is always empty on load, even in weeks that
 * hold dozens of recommendations. The grid has no no-records template, so the
 * empty state is a bare header with no message. The 404 behind it is KI-001.
 *
 * The week is the first full week after the data snapshot, which always has
 * recommendations (src/data/live-scopes.ts). Every other filter is left at its
 * default, because the defaults are the subject.
 *
 * SAFETY: filters only. Nothing here touches the grid's inline editors, the
 * editor window, Send or Bulk Override -- see docs/write-surface.md.
 */

/** The page with every filter at its default except the date range. */
async function openOnPopulatedWeek(recommendations: RecommendationsPage, week: { start: string; end: string }) {
  await recommendations.open();
  await recommendations.setDateRange(toPickerDate(week.start), toPickerDate(week.end));
  await recommendations.waitForGrid();
}

test.describe('@known-issue recommendations default filter', () => {
  test('the KI-004 week has recommendations once the filter is "All"', async ({ recommendations, request }) => {
    // Not a test.fail spec. It proves the recommendations exist, so the spec
    // below cannot "fail as expected" on an empty week and look like the
    // defect. If this goes red, the scope has lost its data, not the bug.
    const week = await recommendationsWeek(request);
    await openOnPopulatedWeek(recommendations, week);

    await recommendations.setRecommendationFilter('All');
    await recommendations.waitForGrid();

    expect((await recommendations.state()).total, `recommendations in week ${week.start} under "All"`)
      .toBeGreaterThan(0);
  });

  test('FOCUS-KI-004 the default filters should show existing recommendations, or say why not', async ({
    page, recommendations, request,
  }) => {
    test.fail(true, 'FOCUS-KI-004: "Any Change" hides every recommendation and the grid gives no reason');

    const week = await recommendationsWeek(request);
    await openOnPopulatedWeek(recommendations, week);

    // Precondition: the defaults are the ones the defect is about.
    expect(await recommendations.currentOptimisationType(), 'default optimisation type').toBe('Manual');
    expect(await recommendations.currentRecommendationFilter(), 'default Recommendations filter').toBe('Any Change');

    const shown = (await recommendations.state()).total;
    // Either fix in docs/findings.md satisfies this: default to "All" (rows
    // appear), or keep the filter and render an explicit empty state.
    const explained = await page
      .getByText(/no (recommendations|records)|match(es)? the (current|selected) filters?|(hidden|excluded) by (a|the) filter/i)
      .filter({ visible: true })
      .and(page.locator('#rec-grid *, .k-notification, [role="alert"], [role="status"]'))
      .count();

    expect(
      shown > 0 || explained > 0,
      `week ${week.start}: recommendations exist under "All", but the default view shows ${shown} rows ` +
        'and no message saying a filter is excluding them',
    ).toBe(true);
  });
});
