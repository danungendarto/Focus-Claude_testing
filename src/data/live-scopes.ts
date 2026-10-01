import { type APIRequestContext } from '@playwright/test';
import { readDataVintage, parseFocusDate } from '../benchmarks/benchmark';
import { ROUTES } from './focus';

/**
 * Scopes worked out from the instance's own data, at run time.
 *
 * Use one when a test needs data that each import moves. Recommendations are
 * the worked example. The optimiser writes them forward from the data snapshot,
 * so after a re-import and re-optimise the old weeks have none. On 1 Oct 2026
 * the test instance was re-imported (snapshot 18/05 -> 31/08/2026) and every
 * hard-coded Recommendations scope in the suite went empty: one test failed and
 * six skipped, including both FOCUS-KI-007 checks.
 *
 * Fixed scopes (DATA_RICH_WEEK, the benchmarks) remain right for data that
 * does not move. Use this only where the data is generated relative to the
 * snapshot.
 */

export interface IsoWeek {
  /** Sunday, yyyy-MM-dd. */
  start: string;
  /** Saturday, yyyy-MM-dd. */
  end: string;
}

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The footer's *Latest snapshot* on this instance, as a UTC timestamp. */
export async function latestSnapshot(request: APIRequestContext): Promise<number> {
  const { latestSnapshot: text } = await readDataVintage(request, ROUTES.home);
  const t = parseFocusDate(text);
  if (Number.isNaN(t)) throw new Error(`footer has no parseable "Latest snapshot" (got "${text}")`);
  return t;
}

/**
 * The first full Sunday-Saturday week that starts after the data snapshot.
 *
 * Every slot in that week was still in the future when the data was taken, so
 * the optimiser has a recommendation for each one. The snapshot's own week is
 * not used: slots that aired before the snapshot have inventory but no
 * recommendation, so the two reports would cover different slots there.
 */
export function firstWeekAfter(snapshot: number): IsoWeek {
  const day = new Date(snapshot).getUTCDay(); // 0 = Sunday
  const sunday = snapshot + (7 - day) * DAY_MS; // strictly after, even if the snapshot is a Sunday
  return { start: iso(sunday), end: iso(sunday + 6 * DAY_MS) };
}

/** `weeks` consecutive weeks from `from`, as one range. */
export function spanWeeks(from: IsoWeek, weeks: number): IsoWeek {
  const start = Date.parse(from.start + 'T00:00:00Z');
  return { start: from.start, end: iso(start + (7 * weeks - 1) * DAY_MS) };
}

/** yyyy-MM-dd -> dd/MM/yyyy, as Focus's date pickers take it. */
export function toPickerDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

let cached: Promise<IsoWeek> | undefined;

/**
 * A week that has recommendations on this instance: the first full week after
 * its snapshot. Worked out once per worker.
 */
export function recommendationsWeek(request: APIRequestContext): Promise<IsoWeek> {
  cached ??= latestSnapshot(request).then(firstWeekAfter).catch((e) => {
    cached = undefined; // don't pin a transient failure for the rest of the run
    throw e;
  });
  return cached;
}
