import { type APIRequestContext, type TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures';
import { READ_API, ROUTES, defaultReportQuery } from '../../src/data/focus';
import {
  type BenchmarkBaseline, type CompareOptions,
  diffRows, pick, readBaseline, writeBaseline, shouldWriteBaseline, baselinePath,
  qs, readDataVintage, explainDiff,
} from '../../src/benchmarks/benchmark';
import { InflightRequests } from '../../src/network';

/**
 * Benchmark: Program vs. Forecast, Channel 7 / SYD / week of 08/03/2026 /
 * Monday / 1800: Seven News, compared with forecast "7MAIN: 1800 NEWS".
 *
 * The baseline comes from PRODUCTION (http://vsp-focus-7), captured 2 Oct 2026,
 * Focus 3.4.0.53, data snapshot 23/02/2026. The suite runs against test
 * (vst-focus-seven), so this asks "does test agree with production?". Re-capture
 * from production, not from test:
 *
 *   FOCUS_BASE_URL=http://vsp-focus-7 npx playwright test --project=chromium  *     tests/benchmarks/program-vs-forecast.benchmark.spec.ts --update-snapshots
 *
 * Pins the three curves the report draws -- paid fill, current forecast fill,
 * comparative forecast fill -- for weeks prior 0..52. See
 * src/benchmarks/benchmark.ts for how to re-baseline and how to read a failure.
 *
 * Things about this scope that are not obvious:
 *
 * - Day of Week on this page counts from **Sunday = 1**, so Monday is
 *   `dayOfWeekId=2`, not 1 as on the other reports.
 * - The programme is sent as `selectedItemId`, a per-instance, per-week grid
 *   id: 888957886 on production, 889568628 on test, for the same Monday 1800
 *   Seven News. So the tests look it up on the instance under test (by title
 *   and day) rather than replaying the baseline's id.
 * - Forecast ids are shared: 7 is "7MAIN: 1800 NEWS" on both instances. The
 *   curve a forecast draws is not: each instance builds it from its own
 *   imported data, so after a re-import the forecast curves can move while
 *   paid fill (history) does not. Against test, therefore, only paid fill must
 *   match production; forecast differences are annotated, not failed. Run
 *   against production, all three curves are compared.
 * - The current forecast for this programme is itself "7MAIN: 1800 NEWS",
 *   flagged Program Specific. The comparison as benchmarked leaves the page's
 *   "Program specific" box unticked (its default), so the comparative curve is
 *   the generic one and differs from the current curve. Tick it and the two
 *   are identical -- the last test pins that.
 * - `paidFill` is null where there is no snapshot and 0 where there is one with
 *   nothing booked; both occur here (null at 0-1 and 28+, 0 at 21-27), and the
 *   comparison keeps them distinct.
 */

const NAME = 'program-vs-forecast.ch7-syd.2026-03-08.mon.1800-seven-news.vs-7main-1800-news';

/** Forecast descriptions are stored with a double space; this is verbatim. */
const COMPARE_FORECAST = '7MAIN:  1800 NEWS';
const COMPARE_FORECAST_ID = 7;
const PROGRAMME = '1800: Seven News';
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
  // Replaced at run time by the instance's own id; see programmeItemId().
  selectedItemId: -1,
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

const FORECAST_FIELDS: Array<keyof CurveRow & string> = ['currentForecastFill', 'comparativeForecastFill'];

/**
 * Against another instance (test vs the production baseline), only paid fill
 * must match. Each instance builds its forecast curves from its own import, so
 * forecasts differing between instances is expected rather than a failure
 * (decided 2 Oct 2026, pending the product owner -- see docs/benchmarks.md).
 * Forecast differences are still computed and reported; see noteForecastDiffs.
 *
 * Against the baseline's own instance every curve is compared strictly, so a
 * change on production is still caught when the benchmark is run there.
 */
function crossInstance(baseline: BenchmarkBaseline<CurveRow>, target: string | undefined): boolean {
  return !!baseline.source && !!target && baseline.source !== target;
}

function compareFor(baseline: BenchmarkBaseline<CurveRow>, target: string | undefined): CompareOptions<CurveRow> {
  return crossInstance(baseline, target) ? { ...COMPARE, approx: ['paidFill'] } : COMPARE;
}

/** Reports forecast differences that a cross-instance run does not fail on, so a pass never hides them. */
async function noteForecastDiffs(
  baseline: BenchmarkBaseline<CurveRow>, actual: CurveRow[], target: string | undefined,
  testInfo: TestInfo,
): Promise<void> {
  if (!crossInstance(baseline, target)) return;
  const forecastOnly = diffRows(baseline.rows, actual, { ...COMPARE, exact: [], approx: FORECAST_FIELDS });
  if (!forecastOnly.length) return;
  const weeks = baseline.rows
    .filter((r) => diffRows([r], actual.filter((a) => a.weeksPrior === r.weeksPrior), {
      ...COMPARE, exact: [], approx: FORECAST_FIELDS,
    }).length)
    .map((r) => r.weeksPrior);
  testInfo.annotations.push({
    type: 'benchmark',
    description:
      `${forecastOnly.length} forecast value(s) differ from ${baseline.source} (informational, not compared): ` +
      `weeks prior ${Math.min(...weeks)}-${Math.max(...weeks)}`,
  });
  await testInfo.attach('forecast-differences.txt', { body: forecastOnly.join('\n'), contentType: 'text/plain' });
}

/**
 * Production answers a cold query in seconds rather than milliseconds (5 s for
 * the Program list on first capture), and Booking Pace has seen 33-40 s cold.
 */
const COLD_QUERY_MS = 90_000;

/**
 * This programme's `selectedItemId` on the instance under test. The ids are
 * per instance, so the baseline's own id would ask test for nothing (or for
 * another programme). Looked up the way the page does, from /api/program/.
 */
async function programmeItemId(request: APIRequestContext): Promise<number> {
  const res = await request.get(`/api/program/?${qs({ ...QUERY })}`, { timeout: COLD_QUERY_MS });
  expect(res.status(), 'the Program list should load').toBe(200);
  const list = (await res.json()) as Array<{ id: number; displayProgramTitle: string; dayOfWeek: string }>;
  const hits = list.filter((p) => p.displayProgramTitle === PROGRAMME && p.dayOfWeek === 'Mon');
  expect(hits.length, `exactly one Monday "${PROGRAMME}" in week 08/03/2026`).toBe(1);
  return hits[0].id;
}

async function fetchPvf(request: APIRequestContext, query: Record<string, unknown>) {
  const res = await request.get(`${READ_API.programVsForecast}?${qs(query)}`, { timeout: COLD_QUERY_MS });
  expect(res.status(), 'the benchmark scope should return data').toBe(200);
  return (await res.json()) as PvfResponse;
}

test.describe('@benchmark program vs forecast: ch7 / SYD / 08-03-2026 / Mon / 1800 Seven News vs 7MAIN 1800 NEWS', () => {
  // The API test is the only one that writes a baseline; the others must run
  // after it so that a re-baseline is compared against the fresh file.
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('API figures match the benchmark', async ({ request, baseURL }, testInfo) => {
    const itemId = await programmeItemId(request);
    const body = await fetchPvf(request, { ...QUERY, selectedItemId: itemId });
    const actual = pick(body.results, FIELDS);
    expect(actual.length, 'the benchmark scope should not be empty').toBeGreaterThan(0);

    const vintage = await readDataVintage(request, ROUTES.programVsForecast);
    const baseline = readBaseline<CurveRow>(NAME);

    if (shouldWriteBaseline(testInfo, !!baseline)) {
      const file = writeBaseline<CurveRow>({
        name: NAME,
        description: 'Program vs. Forecast fill curves for one programme. Compare, do not assert invariants.',
        scope: SCOPE,
        query: { ...QUERY, selectedItemId: itemId },
        capturedAt: new Date().toISOString(),
        source: baseURL,
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
    await noteForecastDiffs(baseline!, actual, baseURL, testInfo);
    const diffs = diffRows(baseline!.rows, actual, compareFor(baseline!, baseURL));
    expect(diffs, explainDiff(diffs, baseline!, vintage, baseURL)).toEqual([]);
  });

  test('the page, driven through its filters, shows the benchmark figures', async ({
    page, programVsForecast, diagnostics, baseURL,
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
      await api.settled(500, COLD_QUERY_MS);
    };

    await programVsForecast.open();
    await api.settled(500, COLD_QUERY_MS);

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
    await programVsForecast.waitForGrid(COLD_QUERY_MS);

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
    expect(sent.get('selectedItemId'), 'Monday 1800 Seven News on this instance')
      .toBe(String(await programmeItemId(page.request)));
    expect(sent.get('comparativeForecastId'), 'compare with 7MAIN: 1800 NEWS').toBe(String(COMPARE_FORECAST_ID));
    expect(sent.get('comparativeIsProgramSpecific'), 'program specific').toBe('false');
    expect(sent.get('comparativeForecastModifier'), 'modifier').toBe('1');

    // Read the datasource, not the rendered rows -- those are virtualised.
    const actual = pick(await programVsForecast.rows<CurveRow>(1000), FIELDS);
    await testInfo.attach('actual-rows.json', {
      body: JSON.stringify(actual, null, 2), contentType: 'application/json',
    });

    const vintage = await readDataVintage(page.request, ROUTES.programVsForecast);
    await noteForecastDiffs(baseline!, actual, baseURL, testInfo);
    const diffs = diffRows(baseline!.rows, actual, compareFor(baseline!, baseURL));
    expect(diffs, explainDiff(diffs, baseline!, vintage, baseURL)).toEqual([]);

    await programVsForecast.expectNoErrors();
    diagnostics.expectClean();
  });

  test('comparing the current forecast with itself gives the identical curve', async ({ request }) => {
    // Same forecast, same Program Specific flag, same modifier as the current
    // forecast: the comparative curve is the current curve, row for row. This
    // is an identity, not a guessed business rule -- and it is what explains
    // the gap between the two curves in the benchmark above. Instance-local:
    // it needs no baseline.
    const itemId = await programmeItemId(request);
    const body = await fetchPvf(request, { ...QUERY, selectedItemId: itemId, comparativeIsProgramSpecific: true });
    expect(body.currentForecast, 'precondition: current forecast is 7MAIN: 1800 NEWS, program specific, x1')
      .toEqual({ description: COMPARE_FORECAST, modifier: 1, isProgramSpecific: true });

    const mismatched = body.results
      .filter((r) => r.comparativeForecastFill !== r.currentForecastFill)
      .map((r) => `weeksPrior ${r.weeksPrior}: current ${r.currentForecastFill}, comparative ${r.comparativeForecastFill}`);
    expect(body.results.length).toBeGreaterThan(0);
    expect(mismatched, 'the same forecast should plot the same curve').toEqual([]);
  });
});
