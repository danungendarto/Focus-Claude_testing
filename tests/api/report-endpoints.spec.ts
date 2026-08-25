import { test, expect } from '@playwright/test';
import {
  READ_API, defaultReportQuery, currentBroadcastWeek, ALL_DAYS_MASK,
  MARKETS, dataRichQuery, type ReportQuery,
} from '../../src/data/focus';

/**
 * API-level checks against the endpoints the report pages call.
 *
 * These run without a browser, so they are fast and they isolate "is the server
 * wrong?" from "is the Kendo binding wrong?". When a UI report test fails, run
 * these first: if they pass, the defect is in the front end.
 *
 * Every endpoint here is read-only. Mutating endpoints are listed in
 * MUTATING_API and are exercised only by @destructive specs.
 */

function qs(query: ReportQuery): string {
  return Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

const READ_ONLY_REPORTS = [
  { name: 'ProgramInventory', path: READ_API.programInventory, query: {} },
  { name: 'BookingPaceSummary', path: READ_API.bookingPaceSummary, query: {} },
  {
    name: 'ProgramVsForecast',
    path: READ_API.programVsForecast,
    // This endpoint validates the modifier: it must be 0.1-99.9 in 0.1 steps,
    // so the shared default of 0 is rejected with a 400.
    query: { comparativeForecastModifier: 1 },
  },
  { name: 'AboveBelowForecast', path: READ_API.aboveBelowForecast, query: {} },
];

test.describe('@api report endpoints', () => {
  for (const { name, path, query } of READ_ONLY_REPORTS) {
    test(`${name} answers the standard report query`, async ({ request }) => {
      const res = await request.get(`${path}?${qs(defaultReportQuery(query))}`);

      // 404 here is Focus's (incorrect) way of saying "no rows" -- see
      // FOCUS-KI-001. Treat it as a non-failure but record it.
      if (res.status() === 404) {
        test.info().annotations.push({
          type: 'known-issue',
          description: `FOCUS-KI-001: ${name} returned 404 for an empty result set`,
        });
        expect(await res.text(), 'a 404 should at least explain itself').toMatch(/not found|no .* found/i);
        return;
      }

      expect(res.status(), `${name} status`).toBe(200);
      expect(res.headers()['content-type'], `${name} content-type`).toContain('json');

      const body = await res.json();
      expect(body, `${name} should return an array or a paged wrapper`).toBeTruthy();
    });
  }

  test('ProgramInventory returns rows with the documented shape', async ({ request }) => {
    const res = await request.get(`${READ_API.programInventory}?${qs(defaultReportQuery())}`);
    test.skip(res.status() === 404, 'no inventory data for the current week in this environment');

    expect(res.status()).toBe(200);
    const rows = asRows(await res.json());
    test.skip(rows.length === 0, 'no inventory rows for the current week');

    // These are the fields the Inventory Summary grid binds to. If the contract
    // changes, the grid silently renders blank columns -- so pin it here.
    for (const field of [
      'summaryBy', 'capacity', 'paid', 'bonus', 'available',
      'paidNetRevenue', 'paidBaseRevenue', 'paidFill', 'bonusFill',
      'totalBooked', 'availablePercent',
    ]) {
      expect(rows[0], `ProgramInventory row is missing "${field}"`).toHaveProperty(field);
    }
  });

  test('an out-of-range date window is handled, not crashed', async ({ request }) => {
    // Year 1900 predates any broadcast data in Focus.
    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({
        startDate: '1900-01-01', week: '1900-01-01', endDate: '1900-01-07',
      }))}`,
    );

    expect(res.status(), 'server must not 500 on a far-past window').toBeLessThan(500);
  });

  test('an inverted date range does not return a 500', async ({ request }) => {
    const { start, end } = currentBroadcastWeek();
    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({
        startDate: end, endDate: start, week: end,
      }))}`,
    );

    expect(res.status(), 'end-before-start should be rejected or empty, never a 500')
      .toBeLessThan(500);
  });

  test('a non-numeric channelId is rejected without a server error', async ({ request }) => {
    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery())}`.replace('channelId=1', 'channelId=abc'),
    );

    expect(res.status(), 'bad input should be a 4xx, not a 5xx').toBeLessThan(500);
  });

  test('validation errors come back as problem+json, not HTML', async ({ request }) => {
    // ProgramVsForecast rejects modifier=0, which makes it a reliable probe for
    // how Focus shapes a validation failure.
    const res = await request.get(
      `${READ_API.programVsForecast}?${qs(defaultReportQuery({ comparativeForecastModifier: 0 }))}`,
    );

    expect(res.status(), 'invalid input should be a 400').toBe(400);
    expect(res.headers()['content-type']).toContain('json');

    const body = await res.json();
    expect(body, 'a client that shows field errors needs them enumerated').toHaveProperty('errors');
  });

  test('the day-of-week mask filters the result set', async ({ request }) => {
    const all = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({ dayOfWeekId: ALL_DAYS_MASK }))}`,
    );
    const monday = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({ dayOfWeekId: 1 }))}`,
    );

    test.skip(all.status() !== 200, 'no data for the current week in this environment');

    const allRows = asRows(await all.json());
    const mondayRows = monday.status() === 200 ? asRows(await monday.json()) : [];

    // A single day cannot legitimately contain more inventory than the whole week.
    expect(mondayRows.length, 'one day should not exceed a full week')
      .toBeLessThanOrEqual(allRows.length);
  });

  test('group headers are not queryable, but real markets are', async ({ request }) => {
    const sydney = MARKETS.find((m) => m.code === 'SYD')!;      // entityType 0
    const victoriaAgg = MARKETS.find((m) => m.code === 'VIC')!;  // entityType 2
    const metroHeader = MARKETS.find((m) => m.code === 'Metro')!; // entityType 3

    const real = await request.get(`${READ_API.programInventory}?${qs(dataRichQuery({
      stationId: sydney.id, selectedStations: String(sydney.id),
    }))}`);
    const aggregate = await request.get(`${READ_API.programInventory}?${qs(dataRichQuery({
      stationId: victoriaAgg.id, selectedStations: String(victoriaAgg.id),
    }))}`);
    const header = await request.get(`${READ_API.programInventory}?${qs(dataRichQuery({
      stationId: metroHeader.id, selectedStations: String(metroHeader.id),
    }))}`);

    // entityType 3 and 4 are UI grouping headers ("5 City Metro", "Regional"),
    // not stations. Rejecting them is correct -- and unlike the empty-result
    // 404s in FOCUS-KI-001, this one is properly shaped problem+json.
    expect(header.status(), 'a group header is not a queryable station').toBe(404);
    expect(header.headers()['content-type'], 'this 404 is correctly structured')
      .toContain('json');

    // Real markets (entityType 0) and true aggregates (entityType 2) both answer.
    expect(real.status(), 'a real market should be queryable').toBe(200);
    expect(aggregate.status(), 'a true aggregate should be queryable').toBe(200);
    expect(asRows(await real.json()).length, 'the data-rich week should have rows')
      .toBeGreaterThan(0);
  });

  test('capacity is non-negative across every level of the market hierarchy', async ({
    request,
  }) => {
    // Deliberately NOT asserting that an aggregate equals the sum of its
    // children: measured on 2026-06-21, Victoria Agg and its children all report
    // capacity 92670 while paid differs, and child ALB's paid (51090) EXCEEDS
    // its parent's (40545). Capacity behaves like airtime -- the same schedule
    // across markets -- not like a summed quantity. What an aggregate's `paid`
    // actually represents is charter EX-02; until that is answered, any
    // summation assertion here would be guesswork.
    const hierarchy = [29, 32, 33, 34]; // VIC agg -> ALB, VXA -> BAL

    for (const stationId of hierarchy) {
      const res = await request.get(`${READ_API.programInventory}?${qs(dataRichQuery({
        stationId, selectedStations: String(stationId),
      }))}`);
      if (res.status() !== 200) continue;

      const rows = asRows(await res.json());
      expect(sumField(rows, 'capacity'), `station ${stationId} capacity`)
        .toBeGreaterThanOrEqual(0);
      expect(sumField(rows, 'paid'), `station ${stationId} paid`)
        .toBeGreaterThanOrEqual(0);
    }
  });
});

/** Focus returns either a bare array or a Kendo paged wrapper. Normalise both. */
function asRows(body: unknown): Array<Record<string, any>> {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const wrapper = body as Record<string, unknown>;
    for (const key of ['Data', 'data', 'items', 'Items', 'rows']) {
      if (Array.isArray(wrapper[key])) return wrapper[key] as Array<Record<string, any>>;
    }
  }
  return [];
}

function sumField(rows: Array<Record<string, any>>, field: string): number {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}
