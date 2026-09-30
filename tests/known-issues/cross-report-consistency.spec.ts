import { test, expect } from '@playwright/test';
import { READ_API, dataRichQuery, type ReportQuery } from '../../src/data/focus';

/**
 * Defects found by charter EX-01 (cross-report consistency), 25 Aug 2026.
 *
 * Specs asserting the CORRECT behaviour call `test.fail()` in the test body, so
 * the suite stays green while the bug exists and reports an unexpected pass the
 * moment it is fixed. Specs that assert behaviour which already works are
 * ordinary passing tests -- they guard the half of the reconciliation that is
 * currently right.
 */

function qs(query: ReportQuery): string {
  return Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** The fixed filter set from charter EX-01: channel 7 / Sydney / 0600-2359. */
const EX01_QUERY = dataRichQuery();

interface InventoryRow {
  summaryBy: string;
  weekDays: string;
  startTime: number;
  capacity: number;
  paid: number;
  bonus: number;
  available: number;
}

interface RecommendationRow {
  programmeTitle: string;
  weekDays: string;
  startTime: number;
  capacityDuration: number;
  paidDuration: number;
  bonusDuration: number;
  availabilityDuration: number;
  totalGrid: number;
}

const sum = <T>(rows: T[], pick: (r: T) => number): number =>
  rows.reduce((total, r) => total + (pick(r) || 0), 0);

/**
 * Recommendations stamps every row with the week-commencing date and carries the
 * real day in `weekDays`, so the join key is day + start time, NOT airDate.
 * Joining on airDate silently collapses 99 rows into 23.
 */
const slotKey = (r: { weekDays: string; startTime: number }) => `${r.weekDays}|${r.startTime}`;

test.describe('@known-issue cross-report consistency', () => {
  test('FOCUS-KI-006 an empty itemDate should not crash InventoryBookingPace', async ({
    request,
  }) => {
    test.fail(true, 'FOCUS-KI-006: empty itemDate returns 500 with an HTML error page');

    // itemDate: '' is the documented default of the shared report query
    // contract -- every page sends it, so this is the ordinary call shape.
    const res = await request.get(`${READ_API.inventoryBookingPace}?${qs(EX01_QUERY)}`);

    expect(
      res.status(),
      'an unparseable itemDate is a client error at worst, never a server crash',
    ).toBeLessThan(500);
  });

  test('FOCUS-KI-006 a malformed itemDate should not crash it either', async ({ request }) => {
    test.fail(true, 'FOCUS-KI-006: a malformed itemDate returns 500 with an HTML error page');

    const res = await request.get(
      `${READ_API.inventoryBookingPace}?${qs(dataRichQuery({ itemDate: 'not-a-date' }))}`,
    );

    expect(res.status(), 'malformed input should be rejected, not crash').toBeLessThan(500);
  });

  test('FOCUS-KI-006 omitting itemDate crashes it too', async ({ request }) => {
    test.fail(true, 'FOCUS-KI-006: itemDate is not validated at all -- absent also returns 500');

    const withoutItemDate = qs(EX01_QUERY)
      .split('&')
      .filter((p) => !p.startsWith('itemDate='))
      .join('&');

    const res = await request.get(`${READ_API.inventoryBookingPace}?${withoutItemDate}`);

    expect(res.status(), 'a missing required parameter is a 400, not a crash').toBeLessThan(500);
  });

  test('FOCUS-KI-006 sibling parameters on the same endpoint ARE validated', async ({
    request,
  }) => {
    // This one passes today, and it is the point: validation exists on this
    // endpoint and simply does not cover itemDate. Without this control the
    // 500s above could be dismissed as "that endpoint has no validation".
    const malformed = qs(dataRichQuery({ itemDate: '2026-06-21' })).replace(
      'summaryType=0',
      'summaryType=notanumber',
    );

    const res = await request.get(`${READ_API.inventoryBookingPace}?${malformed}`);

    expect(res.status(), 'a malformed summaryType is rejected cleanly').toBe(400);
    expect(res.headers()['content-type'] ?? '').toContain('problem+json');
  });

  test('FOCUS-KI-007 Recommendations durations should reconcile against capacity', async ({
    request,
  }) => {
    test.fail(true, 'FOCUS-KI-007: the four duration fields do not reconcile on ~15% of rows');

    const res = await request.get(`${READ_API.recommendations}?${qs(EX01_QUERY)}`);
    test.skip(!res.ok(), 'no recommendations for this scope');
    const rows: RecommendationRow[] = await res.json();
    test.skip(rows.length === 0, 'no recommendations for this scope');

    const broken = rows.filter(
      (r) => r.capacityDuration !== r.paidDuration + r.bonusDuration + r.availabilityDuration,
    );

    expect(
      broken.map((r) => `${slotKey(r)} ${r.programmeTitle}`),
      'every second of capacity must be paid, bonus or available',
    ).toEqual([]);
  });

  test('FOCUS-KI-007 Inventory Summary and Recommendations should agree on availability', async ({
    request,
  }) => {
    test.fail(true, 'FOCUS-KI-007: the two reports disagree on available inventory');

    const [invRes, recRes] = await Promise.all([
      request.get(`${READ_API.programInventory}?${qs(EX01_QUERY)}`),
      request.get(`${READ_API.recommendations}?${qs(EX01_QUERY)}`),
    ]);
    test.skip(!invRes.ok() || !recRes.ok(), 'no data for this scope');

    const inventory: InventoryRow[] = await invRes.json();
    const recommendations: RecommendationRow[] = await recRes.json();
    test.skip(inventory.length === 0 || recommendations.length === 0, 'no data for this scope');

    expect(
      sum(recommendations, (r) => r.availabilityDuration),
      'the same inventory, in the same scope, cannot have two availability figures',
    ).toBe(sum(inventory, (r) => r.available));
  });

  test('capacity, paid and bonus DO agree across the two reports', async ({ request }) => {
    // Not a defect -- this is the control. It establishes that the two reports
    // describe the same 99 slots, which is what makes the availability gap a
    // genuine disagreement rather than two different populations.
    const [invRes, recRes] = await Promise.all([
      request.get(`${READ_API.programInventory}?${qs(EX01_QUERY)}`),
      request.get(`${READ_API.recommendations}?${qs(EX01_QUERY)}`),
    ]);
    test.skip(!invRes.ok() || !recRes.ok(), 'no data for this scope');

    const inventory: InventoryRow[] = await invRes.json();
    const recommendations: RecommendationRow[] = await recRes.json();
    test.skip(inventory.length === 0 || recommendations.length === 0, 'no data for this scope');

    const bySlot = new Map(recommendations.map((r) => [slotKey(r), r]));
    const paired = inventory
      .map((inv) => ({ inv, rec: bySlot.get(slotKey(inv)) }))
      .filter((p): p is { inv: InventoryRow; rec: RecommendationRow } => p.rec !== undefined);

    expect(paired.length, 'the two reports should cover the same slots').toBe(inventory.length);

    for (const { inv, rec } of paired) {
      const where = `${slotKey(inv)} "${inv.summaryBy}"`;
      expect(rec.capacityDuration, `${where}: capacity`).toBe(inv.capacity);
      expect(rec.paidDuration, `${where}: paid`).toBe(inv.paid);
      expect(rec.bonusDuration, `${where}: bonus`).toBe(inv.bonus);
    }
  });
});
