import { test, expect } from '../../src/fixtures';
import { READ_API, ROUTES, dayMask, defaultReportQuery } from '../../src/data/focus';
import {
  type BenchmarkBaseline, type CompareOptions, afterSnapshot,
  diffRows, pick, readBaseline, writeBaseline, shouldWriteBaseline, baselinePath,
  qs, readDataVintage, explainDiff,
} from '../../src/benchmarks/benchmark';
import { InflightRequests } from '../../src/network';

/**
 * Benchmark: Booking Pace Summary, Channel 7 / Metro / 17-23 May 2026 /
 * 0600-1000 / weekdays.
 *
 * The baseline comes from PRODUCTION (http://vsp-focus-7), captured 1 Oct 2026,
 * Focus 3.4.0.53, data snapshot 23/02/2026. The suite runs against test
 * (vst-focus-seven), so this asks "does test agree with production?". The two
 * instances are imported separately; check the vintage note in a failure first.
 * Re-capture from production, not from test:
 *
 *   FOCUS_BASE_URL=http://vsp-focus-7 npx playwright test --project=chromium  *     tests/benchmarks/booking-pace-summary.benchmark.spec.ts --update-snapshots
 *
 * Pins every figure the report shows for this scope, so a later build can be
 * compared against it. See src/benchmarks/benchmark.ts for how to re-baseline
 * and how to read a failure -- check the recorded data vintage first.
 *
 * Two things about the scope that are not obvious:
 *
 * - "Metro" (id 7) is a group header, and the API 404s it on its own. Ticking it
 *   in the UI selects the group plus its five cities, so the page sends
 *   `stationId=1&selectedStations=7,1,2,3,4,5`. That is the query benchmarked.
 * - The report is a pace series: one row per booking-snapshot date, not one
 *   per day of the chosen week. It stops at the instance's data snapshot, so
 *   production's series (snapshot 23/02/2026) is shorter than test's.
 */

const NAME = 'booking-pace-summary.ch7-metro.2026-05-17.weekdays.0600-1000';

const METRO_WITH_CITIES = '7,1,2,3,4,5';
const WEEKDAYS = dayMask('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'); // 31

const QUERY = defaultReportQuery({
  channelId: 1,
  stationId: 1,
  selectedChannels: '1',
  selectedStations: METRO_WITH_CITIES,
  dayOfWeekId: WEEKDAYS,
  startTime: 600,
  endTime: 1000,
  startDate: '2026-05-17',
  week: '2026-05-17',
  endDate: '2026-05-23',
});

const SCOPE = {
  channel: 'Channel 7 (7)',
  market: 'Metro (5 City Metro: SYD, MEL, BRI, ADE, PER)',
  dates: '17/05/2026 - 23/05/2026',
  time: '0600 - 1000',
  days: 'Monday - Friday',
};

interface PaceRow {
  formattedDate: string;
  programCount: number;
  totalCapacity: number;
  totalPaidBooked: number;
  totalAvailability: number;
  paidFillRate: number;
  paidBaseRevenue: number;
  paidNetRevenue: number;
  maxDiscountRecommended: number;
  paidAverageDiscount: number;
}

/** `date` is left out: the grid turns it into a Date in the browser's timezone. */
const COMPARE: CompareOptions<PaceRow> = {
  key: (r) => r.formattedDate,
  exact: [
    'programCount', 'totalCapacity', 'totalPaidBooked', 'totalAvailability',
    'paidBaseRevenue', 'paidNetRevenue', 'maxDiscountRecommended',
  ],
  approx: ['paidFillRate', 'paidAverageDiscount'],
  tolerance: 1e-9,
};
const FIELDS: Array<keyof PaceRow & string> = ['formattedDate', ...COMPARE.exact, ...COMPARE.approx!];

/**
 * A cold first query for this scope has taken 33-40 s on both instances, then
 * well under a second. The defaults (15 s per request, 60 s per test) fail on
 * the cold run for reasons that have nothing to do with the figures.
 */
const COLD_QUERY_MS = 90_000;

/**
 * The baseline is production's, and production's data stops at its snapshot.
 * Dates after that are data production never had, so they are reported but not
 * compared. Every baseline date must still be present and identical, and an
 * extra date inside production's range still fails.
 */
function compareAgainst(baseline: BenchmarkBaseline<PaceRow>): CompareOptions<PaceRow> {
  return { ...COMPARE, ignoreExtra: afterSnapshot(baseline, (r) => r.formattedDate) };
}

/** Records the dates that were not compared, so a pass never hides them. */
function noteUncompared(
  baseline: BenchmarkBaseline<PaceRow>, actual: PaceRow[], testInfo: { annotations: Array<{ type: string; description?: string }> },
): void {
  const known = new Set(baseline.rows.map((r) => r.formattedDate));
  const beyond = actual.filter((r) => !known.has(r.formattedDate) && compareAgainst(baseline).ignoreExtra!(r));
  if (!beyond.length) return;
  testInfo.annotations.push({
    type: 'benchmark',
    description:
      `${beyond.length} date(s) after the baseline's snapshot ${baseline.dataVintage.latestSnapshot} ` +
      `(${baseline.source ?? 'baseline instance'}) were not compared: ${beyond.map((r) => r.formattedDate).join(', ')}`,
  });
}

test.describe('@benchmark booking pace summary: ch7 / Metro / 17-23 May 2026 / 0600-1000 / weekdays', () => {
  // The API test is the only one that writes a baseline; the UI test must run
  // after it so that a re-baseline is compared against the fresh file.
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('API figures match the benchmark', async ({ request, baseURL }, testInfo) => {
    const res = await request.get(`${READ_API.bookingPaceSummary}?${qs({ ...QUERY })}`, { timeout: COLD_QUERY_MS });
    expect(res.status(), 'the benchmark scope should return data').toBe(200);
    const actual = pick((await res.json()) as PaceRow[], FIELDS);
    expect(actual.length, 'the benchmark scope should not be empty').toBeGreaterThan(0);

    const vintage = await readDataVintage(request, ROUTES.bookingPaceSummary);
    const baseline = readBaseline<PaceRow>(NAME);

    if (shouldWriteBaseline(testInfo, !!baseline)) {
      const file = writeBaseline<PaceRow>({
        name: NAME,
        description: 'Booking Pace Summary pace series for a fixed scope. Compare, do not assert invariants.',
        scope: SCOPE,
        query: { ...QUERY },
        capturedAt: new Date().toISOString(),
        source: baseURL,
        dataVintage: vintage,
        rows: actual,
      });
      testInfo.annotations.push({ type: 'benchmark', description: `baseline written: ${file}` });
      expect(baseline, `no baseline existed; wrote ${file} -- review and commit it`).toBeDefined();
      return;
    }

    await testInfo.attach('actual-rows.json', {
      body: JSON.stringify(actual, null, 2), contentType: 'application/json',
    });
    noteUncompared(baseline!, actual, testInfo);
    const diffs = diffRows(baseline!.rows, actual, compareAgainst(baseline!));
    expect(diffs, explainDiff(diffs, baseline!, vintage, baseURL)).toEqual([]);
  });

  test('the page, driven through its filters, shows the benchmark figures', async ({
    page, bookingPaceSummary, diagnostics, baseURL,
  }, testInfo) => {
    const baseline = readBaseline<PaceRow>(NAME);
    expect(baseline, `baseline missing: ${baselinePath(NAME)}`).toBeDefined();

    const api = new InflightRequests(page, READ_API.bookingPaceSummary);

    // Every filter change fires its own request and the grid shows whichever
    // response lands LAST, not the newest (FOCUS-KI-008). Let each change finish
    // before making the next, or a slow stale response overwrites the benchmark
    // figures. Do not collapse these into one settle at the end.
    const step = async (change: () => Promise<void>) => {
      await change();
      await api.settled(500, COLD_QUERY_MS);
    };

    await bookingPaceSummary.open();
    await api.settled(500, COLD_QUERY_MS);

    // Arrange: Channel 7 is the default, but set it so the test does not depend on that.
    await step(() => bookingPaceSummary.setChannelIds([1]));
    // The market is what the benchmark is about, so pick it the way a user does.
    await step(() => bookingPaceSummary.selectMarkets(['Metro']));
    await step(() => bookingPaceSummary.setDateRange('17/05/2026', '23/05/2026'));
    await step(() => bookingPaceSummary.setTimeRange('0600', '1000'));
    await step(() => bookingPaceSummary.setDayMask([1, 2, 4, 8, 16]));
    await bookingPaceSummary.waitForGrid(COLD_QUERY_MS);

    // The page must have asked for exactly the benchmarked scope.
    const sent = new URL(api.sent.at(-1) ?? 'http://none/').searchParams;
    expect(sent.get('selectedChannels'), 'channel').toBe('1');
    expect(sent.get('selectedStations')?.split(',').sort(), 'Metro plus its five cities')
      .toEqual(METRO_WITH_CITIES.split(',').sort());
    expect(sent.get('dayOfWeekId'), 'weekdays only').toBe(String(WEEKDAYS));
    expect(sent.get('startTime'), 'start time').toBe('600');
    expect(sent.get('endTime'), 'end time').toBe('1000');
    expect(sent.get('startDate'), 'start date').toBe('2026-05-17');
    expect(sent.get('endDate'), 'end date').toBe('2026-05-23');

    // Read the datasource, not the rendered rows -- those are virtualised.
    const actual = pick(await bookingPaceSummary.rows<PaceRow>(1000), FIELDS);
    await testInfo.attach('actual-rows.json', {
      body: JSON.stringify(actual, null, 2), contentType: 'application/json',
    });

    const vintage = await readDataVintage(page.request, ROUTES.bookingPaceSummary);
    noteUncompared(baseline!, actual, testInfo);
    const diffs = diffRows(baseline!.rows, actual, compareAgainst(baseline!));
    expect(diffs, explainDiff(diffs, baseline!, vintage, baseURL)).toEqual([]);

    await bookingPaceSummary.expectNoErrors();
    diagnostics.expectClean();
  });
});
