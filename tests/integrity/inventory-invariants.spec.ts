import { test, expect } from '../../src/fixtures';

/**
 * Business-rule invariants on the numbers Focus reports.
 *
 * These are the tests that catch the defects that matter most in a yield system:
 * a report that loads perfectly and shows the wrong figure. They assert
 * relationships that must hold for ANY snapshot, so they stay valid as the data
 * changes underneath them.
 *
 * Where a rule could not be confirmed against the live data it is written as an
 * explicit open question rather than a guessed assertion -- see
 * docs/exploratory-charters.md.
 *
 * The duration fields are SECONDS, not spot counts: charter EX-04 established
 * that averageNet is revenue over 30-second-equivalent spots (paid / 30).
 * Confirmed on 601 rows across 7 week/market/channel scopes with no exceptions.
 */

interface InventoryRow {
  summaryBy: string;
  capacity: number;
  paid: number;
  bonus: number;
  available: number;
  paidFill: number;
  bonusFill: number;
  totalBooked: number;
  availablePercent: number;
  paidNetRevenue: number;
  paidBaseRevenue: number;
  averageNet: number;
  averageBase: number;
}

/** Focus counts inventory in seconds and prices it per 30-second spot. */
const SPOT_SECONDS = 30;

/** Ratios are floating point; compare with tolerance, not equality. */
const TOLERANCE = 1e-6;

test.describe('@integrity inventory arithmetic', () => {
  let rows: InventoryRow[];

  test.beforeEach(async ({ inventorySummary }) => {
    await inventorySummary.open();
    await inventorySummary.waitForGrid();
    rows = await inventorySummary.rows<InventoryRow>(200);
    test.skip(rows.length === 0, 'no inventory rows in the current window');
  });

  test('paid + bonus + available equals capacity on every row', async () => {
    for (const row of rows) {
      expect(
        row.paid + row.bonus + row.available,
        `row "${row.summaryBy}": sold and unsold inventory must account for capacity`,
      ).toBeCloseTo(row.capacity, 6);
    }
  });

  test('fill percentages match their underlying counts', async () => {
    for (const row of rows) {
      if (row.capacity === 0) continue; // an empty daypart has no meaningful fill

      expect(row.paidFill, `row "${row.summaryBy}": paidFill should be paid / capacity`)
        .toBeCloseTo(row.paid / row.capacity, 6);

      expect(row.bonusFill, `row "${row.summaryBy}": bonusFill should be bonus / capacity`)
        .toBeCloseTo(row.bonus / row.capacity, 6);

      expect(row.availablePercent, `row "${row.summaryBy}": availablePercent should be available / capacity`)
        .toBeCloseTo(row.available / row.capacity, 6);
    }
  });

  test('total booked equals paid fill plus bonus fill', async () => {
    for (const row of rows) {
      if (row.capacity === 0) continue;

      expect(row.totalBooked, `row "${row.summaryBy}": totalBooked should be paidFill + bonusFill`)
        .toBeCloseTo(row.paidFill + row.bonusFill, 6);
    }
  });

  test('booked and available percentages sum to 100%', async () => {
    for (const row of rows) {
      if (row.capacity === 0) continue;

      expect(
        row.totalBooked + row.availablePercent,
        `row "${row.summaryBy}": every unit of capacity is either booked or available`,
      ).toBeCloseTo(1, 6);
    }
  });

  test('no negative inventory or revenue', async () => {
    for (const row of rows) {
      for (const field of ['capacity', 'paid', 'bonus', 'available', 'paidNetRevenue', 'paidBaseRevenue'] as const) {
        expect(row[field], `row "${row.summaryBy}": ${field} must not be negative`)
          .toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('fill ratios stay within 0 and 100%', async () => {
    for (const row of rows) {
      for (const field of ['paidFill', 'bonusFill', 'totalBooked', 'availablePercent'] as const) {
        expect(row[field], `row "${row.summaryBy}": ${field} below 0`).toBeGreaterThanOrEqual(-TOLERANCE);
        expect(row[field], `row "${row.summaryBy}": ${field} above 100%`).toBeLessThanOrEqual(1 + TOLERANCE);
      }
    }
  });

  test('net revenue never exceeds base revenue', async () => {
    for (const row of rows) {
      // Net is base after discounting, so it cannot be the larger of the two.
      // A row that breaks this points at a discount applied the wrong way round.
      expect(
        row.paidNetRevenue,
        `row "${row.summaryBy}": net revenue exceeds base revenue, which implies a negative discount`,
      ).toBeLessThanOrEqual(row.paidBaseRevenue + TOLERANCE);
    }
  });

  test('average rates are revenue over 30-second-equivalent spots', async () => {
    // EX-04, answered 25 Aug 2026. The divisor is NOT the paid spot count:
    // paid is a DURATION IN SECONDS, and the average is per 30-second spot.
    // Corroborated by /api/Recommendations, which names the same fields
    // capacityDuration / paidDuration / bonusDuration / availabilityDuration.
    for (const row of rows) {
      if (row.paid === 0) continue; // nothing sold, nothing to average

      const spots = row.paid / SPOT_SECONDS;

      expect(row.averageNet, `row "${row.summaryBy}": averageNet should be paidNetRevenue / (paid / 30)`)
        .toBeCloseTo(row.paidNetRevenue / spots, 2);

      expect(row.averageBase, `row "${row.summaryBy}": averageBase should be paidBaseRevenue / (paid / 30)`)
        .toBeCloseTo(row.paidBaseRevenue / spots, 2);
    }
  });

  test('rows with revenue also have inventory sold', async () => {
    for (const row of rows) {
      if (row.paidNetRevenue > 0) {
        expect(row.paid, `row "${row.summaryBy}": revenue booked against zero paid inventory`)
          .toBeGreaterThan(0);
      }
    }
  });
});
