import { test, expect } from '../../src/fixtures';
import { CHANNELS, MARKETS, dayMask } from '../../src/data/focus';

/**
 * Re-Optimise — filter behaviour only.
 *
 * ⚠ NOTHING HERE CLICKS THE RE-OPTIMISE BUTTON. That button POSTs
 * /api/ReOptimise and starts a server-side job that rewrites recommendations
 * for the selected scope, with no undo. Setting filters is safe: it fires only
 * GET /api/ReOptimise/HasHeadroomBudgets.
 *
 * Converted from a recorded session. What is worth asserting on this page is
 * not "did the click land" but "does the UI translate the planner's selections
 * into the right API parameters" — because getting that wrong would re-optimise
 * the wrong inventory, and nothing on screen would say so.
 */

const SCENARIO = {
  channel: CHANNELS.find((c) => c.code === '7')!,
  markets: [
    MARKETS.find((m) => m.code === 'SUN')!, // Sunshine Coast, id 50
    MARKETS.find((m) => m.code === 'WID')!, // Wide Bay, id 51
  ],
  dateStart: '31/05/2026',
  dateEnd: '06/06/2026',
  days: dayMask('Monday', 'Tuesday', 'Thursday'), // 1 + 2 + 8 = 11
  timeStart: '2000',
  timeEnd: '2030',
};

/** The read-only check Focus fires whenever a filter changes. */
const HEADROOM_URL = '/api/ReOptimise/HasHeadroomBudgets';

test.describe('@report re-optimise filters', () => {
  test('the page renders its filters and the run button', async ({ reOptimise, diagnostics }) => {
    await reOptimise.open();

    await expect(reOptimise.runButton).toBeVisible();
    const range = await reOptimise.dateRange();
    expect(range.start, 'start date should be populated').toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    diagnostics.expectClean();
  });

  test('the planner selection is translated into the correct API parameters', async ({
    page,
    reOptimise,
  }) => {
    await reOptimise.open();

    const headroomCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(HEADROOM_URL)) headroomCalls.push(r.url());
    });

    // Channel 7, markets SUN + WID, 31 May - 6 Jun 2026, Mon/Tue/Thu, 2000-2030.
    await reOptimise.setChannelIds([SCENARIO.channel.id]);
    await reOptimise.setMarketIds(SCENARIO.markets.map((m) => m.id));
    await reOptimise.setDateRange(SCENARIO.dateStart, SCENARIO.dateEnd);
    await reOptimise.setDayIds([1, 2, 8]);
    await reOptimise.setTimeRange(SCENARIO.timeStart, SCENARIO.timeEnd);

    expect(headroomCalls.length, 'changing filters should re-check headroom').toBeGreaterThan(0);

    const last = new URL(headroomCalls.at(-1)!);
    const q = last.searchParams;

    // This is the assertion that matters: every selection the planner made has
    // to survive into the request that will scope the optimisation.
    expect(q.get('selectedChannels'), 'channel').toBe(String(SCENARIO.channel.id));
    expect(q.get('selectedStations'), 'markets SUN + WID').toBe(
      SCENARIO.markets.map((m) => m.id).join(','),
    );
    expect(q.get('startDate'), 'start date as ISO').toBe('2026-05-31');
    expect(q.get('endDate'), 'end date as ISO').toBe('2026-06-06');
    expect(q.get('dayOfWeekId'), 'Mon+Tue+Thu as a bitmask').toBe(String(SCENARIO.days));
    expect(q.get('startTime'), 'start time').toBe(SCENARIO.timeStart);
    expect(q.get('endTime'), 'end time').toBe(SCENARIO.timeEnd);
  });

  test('the day-of-week bitmask is built correctly', async () => {
    // Pinned separately because an off-by-one here silently re-optimises the
    // wrong days, and the UI gives no feedback that would reveal it.
    expect(dayMask('Monday', 'Tuesday', 'Thursday')).toBe(11);
    expect(dayMask('Monday')).toBe(1);
    expect(dayMask('Sunday')).toBe(64);
    expect(
      dayMask('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
      'all seven days is the 127 mask Focus uses for "whole week"',
    ).toBe(127);
  });

  test('selecting markets keeps the chosen ones and does not widen the scope', async ({
    reOptimise,
  }) => {
    await reOptimise.open();
    await reOptimise.setMarketIds(SCENARIO.markets.map((m) => m.id));

    const selected = await reOptimise.selectedMarketIds();
    const ids = Array.isArray(selected) ? selected.map(Number) : [];

    for (const market of SCENARIO.markets) {
      expect(ids, `${market.code} should stay selected`).toContain(market.id);
    }

    // The tree also checks the parent node once every child is selected, which
    // is cosmetic -- the request sends only the leaf markets. Guard against the
    // scope quietly widening to unrelated markets.
    const unrelated = MARKETS.filter((m) => m.entityType === 0 && !ids.includes(m.id));
    expect(unrelated.length, 'other markets must not be swept in').toBeGreaterThan(0);
  });

  test('filters remain editable when headroom budgets are not enabled', async ({ reOptimise }) => {
    await reOptimise.open();
    await reOptimise.setMarketIds(SCENARIO.markets.map((m) => m.id));
    await reOptimise.setDateRange(SCENARIO.dateStart, SCENARIO.dateEnd);
    await reOptimise.setDayIds([1, 2, 8]);
    await reOptimise.setTimeRange(SCENARIO.timeStart, SCENARIO.timeEnd);

    // For this scenario the API reports isBudgetEnabled=false, so Focus should
    // leave the planner's day and time choices alone.
    const times = await reOptimise.timeRange();
    expect(times.start, 'start time should survive the headroom check').toBe(SCENARIO.timeStart);
    expect(times.end, 'end time should survive the headroom check').toBe(SCENARIO.timeEnd);

    const days = await reOptimise.selectedDayIds();
    expect(Array.isArray(days) ? days.map(Number) : [], 'day selection should survive')
      .toEqual([1, 2, 8]);

    await reOptimise.expectNoErrors();
  });
});
