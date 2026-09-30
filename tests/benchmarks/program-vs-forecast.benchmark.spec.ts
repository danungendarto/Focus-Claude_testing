import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../../src/fixtures';
import { READ_API, ROUTES, defaultReportQuery } from '../../src/data/focus';
import {
  type CompareOptions,
  diffRows, pick, readBaseline, writeBaseline, shouldWriteBaseline, baselinePath,
  qs, readDataVintage, explainDiff,
} from '../../src/benchmarks/benchmark';
import { InflightRequests } from '../../src/network';

/**
 * Benchmark: Program vs. Forecast, Channel 7 / SYD / week of 08/03/2026 /
 * Monday / 1800: Seven News, compared with forecast "7MAIN: 1800 NEWS".
 * Captured 1 Oct 2026 against Focus 3.4.0.53.
 *
 * Pins the three curves the report draws -- paid fill, current forecast fill,
 * comparative forecast fill -- for weeks prior 0..52. See
 * src/benchmarks/benchmark.ts for how to re-baseline and how to read a failure.
 *
 * Things about this scope that are not obvious:
 *
 * - Day of Week on this page counts from **Sunday = 1**, so Monday is
 *   `dayOfWeekId=2`, not 1 as on the other reports.
 * - The programme is sent as `selectedItemId`, a per-week grid id (889568628
 *   for this Monday's 1800 Seven News). A re-import may renumber it; if the API
 *   test fails on a changed vintage, check that id first.
 * - The current forecast for this programme is itself "7MAIN: 1800 NEWS",
 *   flagged Program Specific. The comparison as benchmarked leaves the page's
 *   "Program specific" box unticked (its default), so the comparative curve is
 *   the generic one and runs ~0.318 above current for weeks 0-7. That gap is the
 *   flag, not a defect: tick it and the two curves are identical -- the last
 *   test pins that.
 * - `paidFill` is null where there is no snapshot and 0 where there is one with
 *   nothing booked; both occur here (null at 0-1 and 28+, 0 at 21-27), and the
 *   comparison keeps them distinct.
 */

const NAME = 'program-vs-forecast.ch7-syd.2026-03-08.mon.1800-seven-news.vs-7main-1800-news';

/** Forecast descriptions are stored with a double space; this is verbatim. */
const COMPARE_FORECAST = '7MAIN:  1800 NEWS';
const COMPARE_FORECAST_ID = 7;
const PROGRAMME = '1800: Seven News';
const PROGRAMME_ITEM_ID = 889568628;
const MONDAY_ON_THIS_PAGE = 2;

const QUERY = defaultReportQuery({
  channelId: 1,
  stationId: 1,
  selectedChannels: '1',
  selectedStations: '1',
  dayOfWeekId: MONDAY_ON_THIS_PAGE,
  midPoint: 1829,
  startDate: '2026-03-08',
  week: '2026-03-08',
  // This page sends Sunday to the following Sunday, not Sunday to Saturday.
  endDate: '2026-03-15',
  selectedItemId: PROGRAMME_ITEM_ID,
  comparativeForecastId: COMPARE_FORECAST_ID,
  comparativeIsProgramSpecific: false,
  comparativeForecastModifier: 1,
  // startTime/endTime are the contract defaults (1800/2230); the programme,
  // not the time window, sets the scope here.
});

const SCOPE = {
  channel: 'Channel 7 (7)',
  market: 'SYD',
  week: '08/03/2026',
  day: 'Monday',
  program: PROGRAMME,
  compareWith: '7MAIN: 1800 NEWS (Program specific unticked, modifier 1)',
};

interface CurveRow {
  weeksPrior: number;
  paidFill: number | null;
  currentForecastFill: number | null;
  comparativeForecastFill: number | null;
}

interface PvfResponse {
  currentForecast: { description: string; modifier: number; isProgramSpecific: boolean };
  results: CurveRow[];
}

const COMPARE: CompareOptions<CurveRow> = {
  key: (r) => `weeksPrior ${r.weeksPrior}`,
  exact: ['weeksPrior'],
  approx: ['paidFill', 'currentForecastFill', 'comparativeForecastFill'],
  tolerance: 1e-9,
};
const FIELDS: Array<keyof CurveRow & string> = [...COMPARE.exact, ...COMPARE.approx!];

async function fetchPvf(request: APIRequestContext, query: Record<string, unknown>) {
  const res = await request.get(`${READ_API.programVsForecast}?${qs(query)}`);
  expect(res.status(), 'the benchmark scope should return data').toBe(200);
  return (await res.json()) as PvfResponse;
}

test.describe('@benchmark program vs forecast: ch7 / SYD / 08-03-2026 / Mon / 1800 Seven News vs 7MAIN 1800 NEWS', () => {
  // The API test is the only one that writes a baseline; the others must run
  // after it so that a re-baseline is compared against the fresh file.
  test.describe.configure({ mode: 'serial' });

  test('API figures match the benchmark', async ({ request }, testInfo) => {
    const body = await fetchPvf(request, { ...QUERY });
    const actual = pick(body.results, FIELDS);
    expect(actual.length, 'the benchmark scope should not be empty').toBeGreaterThan(0);

    const vintage = await readDataVintage(request, ROUTES.programVsForecast);
    const baseline = readBaseline<CurveRow>(NAME);

    if (shouldWriteBaseline(testInfo, !!baseline)) {
      const file = writeBaseline<CurveRow>({
        name: NAME,
        description: 'Program vs. Forecast fill curves for one programme. Compare, do not assert invariants.',
        scope: SCOPE,
        query: { ...QUERY },
        capturedAt: new Date().toISOString(),
        dataVintage: vintage,
        header: { currentForecast: body.currentForecast },
        rows: actual,
      });
      testInfo.annotations.push({ type: 'benchmark', description: `baseline written: ${file}` });
      expect(baseline, `no baseline existed; wrote ${file} -- review and commit it`).toBeDefined();
      return;
    }

    await testInfo.attach('actual-rows.json', {
      body: JSON.stringify(body, null, 2), contentType: 'application/json',
    });
    expect(body.currentForecast, `current forecast differs from ${NAME}`)
      .toEqual(baseline!.header?.currentForecast);
    const diffs = diffRows(baseline!.rows, actual, COMPARE);
    expect(diffs, explainDiff(diffs, baseline!, vintage)).toEqual([]);
  });

  test('the page, driven through its filters, shows the benchmark figures', async ({
    page, programVsForecast, diagnostics,
  }, testInfo) => {
    const baseline = readBaseline<CurveRow>(NAME);
    expect(baseline, `baseline missing: ${baselinePath(NAME)}`).toBeDefined();

    // Track every /api/ call, not just the report: the Program list reloads
    // from /api/program/ on week and day changes, and the programme must not be
    // picked from a list that is about to be replaced.
    const api = new InflightRequests(page, '/api/');

    // Each change fires its own report request and the grid shows whichever
    // response lands LAST (FOCUS-KI-008). Let each one finish before the next.
    const step = async (change: () => Promise<void>) => {
      await change();
      await api.settled();
    };

    await programVsForecast.open();
    await api.settled();

    // Arrange: Channel 7 / SYD are the defaults, but set them so the test does
    // not depend on that.
    await step(() => programVsForecast.selectChannel('7'));
    await step(() => programVsForecast.setStationId(1));
    await step(() => programVsForecast.setWeek('08/03/2026'));
    // Act: the programme and comparison are what the benchmark is about, so
    // pick them the way a user does. Day first -- it reloads the Program list.
    await step(() => programVsForecast.selectDay('Monday'));
    await step(() => programVsForecast.selectProgramme(PROGRAMME));
    await step(() => programVsForecast.selectCompareForecast(COMPARE_FORECAST));
    await programVsForecast.waitForGrid();

    expect(await programVsForecast.week(), 'week').toBe('08/03/2026');
    expect(await programVsForecast.selectedProgramme(), 'programme').toBe(PROGRAMME);
    await expect(programVsForecast.compareProgramSpecificCheckbox, 'benchmarked unticked').not.toBeChecked();
    await expect(programVsForecast.currentForecastDescription).toHaveText(/7MAIN:\s+1800 NEWS/);

    // The page must have asked for exactly the benchmarked scope.
    const report = api.sent.filter((u) => u.includes(READ_API.programVsForecast));
    const sent = new URL(report.at(-1) ?? 'http://none/').searchParams;
    expect(sent.get('channelId'), 'channel').toBe('1');
    expect(sent.get('stationId'), 'market').toBe('1');
    expect(sent.get('week'), 'week').toBe('2026-03-08');
    expect(sent.get('dayOfWeekId'), 'Monday is 2 on this page').toBe(String(MONDAY_ON_THIS_PAGE));
    expect(sent.get('selectedItemId'), 'Monday 1800 Seven News for this week -- renumbered by a re-import?')
      .toBe(String(PROGRAMME_ITEM_ID));
    expect(sent.get('comparativeForecastId'), 'compare with 7MAIN: 1800 NEWS').toBe(String(COMPARE_FORECAST_ID));
    expect(sent.get('comparativeIsProgramSpecific'), 'program specific').toBe('false');
    expect(sent.get('comparativeForecastModifier'), 'modifier').toBe('1');

    // Read the datasource, not the rendered rows -- those are virtualised.
    const actual = pick(await programVsForecast.rows<CurveRow>(1000), FIELDS);
    await testInfo.attach('actual-rows.json', {
      body: JSON.stringify(actual, null, 2), contentType: 'application/json',
    });

    const vintage = await readDataVintage(page.request, ROUTES.programVsForecast);
    const diffs = diffRows(baseline!.rows, actual, COMPARE);
    expect(diffs, explainDiff(diffs, baseline!, vintage)).toEqual([]);

    await programVsForecast.expectNoErrors();
    diagnostics.expectClean();
  });

  test('comparing the current forecast with itself gives the identical curve', async ({ request }) => {
    // Same forecast, same Program Specific flag, same modifier as the current
    // forecast: the comparative curve is the current curve, row for row. This
    // is an identity, not a guessed business rule -- and it is what explains
    // the gap in the benchmark above.
    const body = await fetchPvf(request, { ...QUERY, comparativeIsProgramSpecific: true });
    expect(body.currentForecast, 'precondition: current forecast is 7MAIN: 1800 NEWS, program specific, x1')
      .toEqual({ description: COMPARE_FORECAST, modifier: 1, isProgramSpecific: true });

    const mismatched = body.results
      .filter((r) => r.comparativeForecastFill !== r.currentForecastFill)
      .map((r) => `weeksPrior ${r.weeksPrior}: current ${r.currentForecastFill}, comparative ${r.comparativeForecastFill}`);
    expect(body.results.length).toBeGreaterThan(0);
    expect(mismatched, 'the same forecast should plot the same curve').toEqual([]);
  });
});
