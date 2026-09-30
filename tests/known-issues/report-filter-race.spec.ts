import { test, expect } from '../../src/fixtures';
import { READ_API } from '../../src/data/focus';
import { InflightRequests } from '../../src/network';

/**
 * FOCUS-KI-008: a report grid shows the response that ARRIVES last, not the one
 * for the filters on screen.
 *
 * Every filter change fires its own request; earlier ones are neither cancelled
 * nor ignored when they return. Found while capturing the Booking Pace Summary
 * benchmark, 1 Oct 2026: a slow request for an intermediate filter state
 * (17/05-03/10, 1800-2230, every day) landed after the request for the final
 * state and replaced its figures. 48 rows for the wrong scope, no error.
 *
 * Naturally that depends on server timing. Here the stale request is held back
 * with page.route, standing in for a slow query, so it reproduces every time.
 */

interface PaceRow { formattedDate: string; totalPaidBooked: number }

/** Order-insensitive: the grid sorts its rows, the API does not. */
const summarise = (rows: PaceRow[]) => rows.map((r) => `${r.formattedDate}:${r.totalPaidBooked}`).sort();

test.describe('@known-issue report filter race', () => {
  test('FOCUS-KI-008 the grid should show figures for the filters on screen, not the slowest response', async ({
    page, request, bookingPaceSummary,
  }) => {
    test.fail(true, 'FOCUS-KI-008: a stale, slower response overwrites the grid');

    const api = new InflightRequests(page, READ_API.bookingPaceSummary);
    await bookingPaceSummary.open();
    await api.settled();

    // Hold back anything still asking for the old evening window.
    await page.route(`**${READ_API.bookingPaceSummary}?*`, async (route) => {
      if (route.request().url().includes('startTime=1800')) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
      await route.continue().catch(() => { /* page may have closed */ });
    });

    // A user changing two filters in a row. The first change's request is the slow one.
    await bookingPaceSummary.setDateRange('17/05/2026', '23/05/2026');
    await bookingPaceSummary.setTimeRange('0600', '1000');
    await api.settled();

    // What the page should be showing: the response to the query it sent last.
    const latest = api.sent.at(-1)!;
    expect(latest, 'the last request should carry the on-screen time window').toContain('startTime=600');
    const expected = (await (await request.get(latest)).json()) as PaceRow[];

    const shown = await bookingPaceSummary.rows<PaceRow>(1000);
    expect(summarise(shown), 'grid rows should match the latest filters').toEqual(summarise(expected));
  });
});
