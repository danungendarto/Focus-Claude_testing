import { test, expect } from '../../src/fixtures';
import type { APIRequestContext } from '@playwright/test';
import { CHANNELS, MARKETS, dayMask } from '../../src/data/focus';

/**
 * Re-Optimise, end to end — including the button.
 *
 * ⚠ THIS WRITES. It starts a server-side job that recalculates recommendations
 * for the selected scope. There is no undo. Double-gated: excluded from the
 * default project by grep, and skipped unless FOCUS_ALLOW_DESTRUCTIVE=1.
 *
 * This spec exists because a supervised run on 25 Aug 2026 established what a
 * successful re-optimise actually looks like (charter EX-07). Before that, the
 * only honest assertion was "the job completed", which proves almost nothing.
 *
 * The observable signature of a scoped re-optimise:
 *   - every recommendation IN scope gets a new runId
 *   - every recommendation OUT of scope keeps its old runId   <- the real check
 *   - lastPartialOptimiseDate advances
 *   - lastFullOptimiseDate does NOT
 *   - the recommendation VALUES need not change; a run that changes nothing is
 *     still a successful run, so never assert on flags or discounts moving
 */

function requireDestructiveOptIn(): void {
  test.skip(
    process.env.FOCUS_ALLOW_DESTRUCTIVE !== '1',
    'Set FOCUS_ALLOW_DESTRUCTIVE=1 to run tests that write to the server',
  );
}

/** Deliberately the narrowest scope that still exercises the feature. */
const SCOPE = {
  channel: CHANNELS.find((c) => c.code === '7')!,
  markets: [MARKETS.find((m) => m.code === 'SUN')!, MARKETS.find((m) => m.code === 'WID')!],
  dateStart: '31/05/2026',
  dateEnd: '06/06/2026',
  isoStart: '2026-05-31',
  isoEnd: '2026-06-06',
  days: [1, 2, 8], // Mon, Tue, Thu
  timeStart: '2000',
  timeEnd: '2030',
};

const REC_BASE =
  'optimisationType=0&sendStatus=0&changeStatus=0&viewType=Grid+View&programName=*&currentFlagId=-1';

interface RecRow {
  runId: number;
  scheduledProgramId: number;
  programmeTitle: string;
}

async function recommendations(
  request: APIRequestContext,
  params: { stations: string; dayOfWeekId: number; startTime: string; endTime: string; start: string; end: string },
): Promise<RecRow[]> {
  const url =
    `/api/Recommendations?dayOfWeekId=${params.dayOfWeekId}` +
    `&startTime=${params.startTime}&endTime=${params.endTime}` +
    `&startDate=${params.start}&endDate=${params.end}` +
    `&selectedStations=${params.stations}&channelId=1&stationId=${params.stations.split(',')[0]}` +
    `&${REC_BASE}`;

  const res = await request.get(url);
  if (res.status() !== 200) return []; // 404 means "no rows" here -- FOCUS-KI-001
  const body = await res.json();
  return Array.isArray(body) ? (body as RecRow[]) : [];
}

const inScope = {
  stations: '50,51',
  dayOfWeekId: dayMask('Monday', 'Tuesday', 'Thursday'),
  startTime: '2000',
  endTime: '2030',
  start: SCOPE.isoStart,
  end: SCOPE.isoEnd,
};

/** Same markets and week, but the whole day and every weekday. */
const widerSameWeek = { ...inScope, dayOfWeekId: 127, startTime: '600', endTime: '2359' };

/** A market that was not selected. */
const otherMarket = { ...inScope, stations: '1' };

async function optimiseTimestamps(request: APIRequestContext) {
  const res = await request.get('/api/ReOptimise/Status');
  return (await res.json()) as {
    lastFullOptimiseDate: string;
    lastPartialOptimiseDate: string;
  };
}

test.describe('@destructive re-optimise', () => {
  test.beforeEach(() => requireDestructiveOptIn());

  test('a scoped run re-optimises exactly the selected inventory and nothing else', async ({
    page,
    reOptimise,
  }) => {
    test.setTimeout(15 * 60_000); // the job is asynchronous and can be slow
    const request = page.request;

    /* -- baseline -------------------------------------------------- */
    const before = {
      inScope: await recommendations(request, inScope),
      wider: await recommendations(request, widerSameWeek),
      otherMarket: await recommendations(request, otherMarket),
      stamps: await optimiseTimestamps(request),
    };

    test.skip(before.inScope.length === 0, 'no recommendations in the target scope to re-optimise');

    const runIdsBefore = new Set(before.inScope.map((r) => r.runId));
    const outOfScopeBefore = new Map(
      [...before.wider, ...before.otherMarket]
        .filter((r) => !before.inScope.some((i) => i.scheduledProgramId === r.scheduledProgramId))
        .map((r) => [r.scheduledProgramId, r.runId]),
    );

    /* -- act ------------------------------------------------------- */
    await reOptimise.open();
    await reOptimise.setChannelIds([SCOPE.channel.id]);
    await reOptimise.setMarketIds(SCOPE.markets.map((m) => m.id));
    await reOptimise.setDateRange(SCOPE.dateStart, SCOPE.dateEnd);
    await reOptimise.setDayIds(SCOPE.days);
    await reOptimise.setTimeRange(SCOPE.timeStart, SCOPE.timeEnd);

    await reOptimise.runReOptimise();

    // Poll the server rather than the progress bar: the bar can disappear for
    // UI reasons, but the timestamp only advances when the job really finishes.
    await expect
      .poll(
        async () => (await optimiseTimestamps(request)).lastPartialOptimiseDate,
        {
          message: 'lastPartialOptimiseDate should advance once the job completes',
          timeout: 10 * 60_000,
          intervals: [2_000],
        },
      )
      .not.toBe(before.stamps.lastPartialOptimiseDate);

    /* -- assert ---------------------------------------------------- */
    const after = {
      inScope: await recommendations(request, inScope),
      wider: await recommendations(request, widerSameWeek),
      otherMarket: await recommendations(request, otherMarket),
      stamps: await optimiseTimestamps(request),
    };

    // 1. Everything in scope carries a new runId.
    expect(after.inScope.length, 'the scope should still return the same rows')
      .toBe(before.inScope.length);
    for (const row of after.inScope) {
      expect(
        runIdsBefore.has(row.runId),
        `"${row.programmeTitle}" should have a new runId, not ${row.runId}`,
      ).toBe(false);
    }
    expect(new Set(after.inScope.map((r) => r.runId)).size, 'one run means one runId').toBe(1);

    // 2. Nothing outside the scope moved. This is the assertion that matters --
    //    a re-optimise that quietly widened its blast radius would be serious.
    for (const row of [...after.wider, ...after.otherMarket]) {
      const previous = outOfScopeBefore.get(row.scheduledProgramId);
      if (previous === undefined) continue;
      expect(
        row.runId,
        `"${row.programmeTitle}" is outside the selected scope and must not be re-optimised`,
      ).toBe(previous);
    }

    // 3. A scoped run is a PARTIAL optimise, not a full one.
    expect(after.stamps.lastFullOptimiseDate, 'a scoped run must not count as a full re-optimise')
      .toBe(before.stamps.lastFullOptimiseDate);

    await reOptimise.expectNoErrors();

    test.info().annotations.push({
      type: 'side-effect',
      description:
        `Re-optimised ${after.inScope.length} recommendation(s) for SUN+WID, ` +
        `${SCOPE.dateStart}-${SCOPE.dateEnd}, Mon/Tue/Thu 2000-2030. ` +
        `runId ${[...runIdsBefore].join(',')} -> ${after.inScope[0]?.runId}.`,
    });
  });
});
