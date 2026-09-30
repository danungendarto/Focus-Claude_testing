# Benchmarks

A benchmark pins every figure a report produced for one fixed scope, so a later
run can say whether the numbers moved. It is a comparison, not an invariant:
it does not claim the figures are *right*, only that they are *unchanged*.

| Benchmark | Scope | Rows | Captured |
|---|---|---|---|
| `booking-pace-summary.ch7-metro.2026-05-17.weekdays.0600-1000` | Booking Pace Summary · Channel 7 · Metro · 17/05/2026–23/05/2026 · 0600–1000 · Mon–Fri | 28 | 1 Oct 2026, Focus 3.4.0.53, snapshot 18/05/2026 |

Spec: `tests/benchmarks/booking-pace-summary.benchmark.spec.ts`.
Baselines: `tests/benchmarks/baselines/*.json` (committed).

## Running

```bash
npm run test:benchmarks
```

Benchmarks are read-only and are part of the default `npm test` run.

Each benchmark has two tests:

- **API**: calls the endpoint with the stored query and compares. Fast. If this
  fails, the server's figures changed.
- **UI**: sets the filters on the page, checks the request the page sent matches
  the stored query, then compares the grid's datasource. If only this one fails,
  the page is asking for something different or showing something different.

Integer fields (capacity, paid, availability, revenue, programme count) must
match exactly. Ratios (fill %, average discount) are compared to 1e-9.

## When one fails

1. **Check the data vintage first.** The failure message says if the footer's
   *Latest snapshot*, *Imported on* or *Version* differs from the baseline. A
   re-import or a new build is a legitimate reason for figures to move. Confirm
   the new figures with the product owner before re-baselining.
2. If the vintage is unchanged, the figures moved on the same data. Treat it as
   a defect: follow *Handling a defect* in `CLAUDE.md`.
3. The actual rows are attached to the test result as `actual-rows.json`.

## Re-baselining

Only on purpose, and commit the changed JSON together with the reason:

```bash
npm run benchmark:update
```

This uses Playwright's `--update-snapshots`. A benchmark with no baseline file
writes one on its first run and fails, so a new benchmark is never quietly
green.

## Adding one

Copy the Booking Pace spec, change `NAME`, `QUERY`, `SCOPE` and the row type,
then run it once to write the baseline. Two things learned the hard way:

- **Market groups.** `Metro` (id 7) is a group header, and the API 404s it on its
  own. Ticking it in the UI sends `selectedStations=7,1,2,3,4,5`. Benchmark that
  query, not `stationId=7`.
- **Let each filter change settle before the next** (`InflightRequests` in
  `src/network.ts`). Otherwise FOCUS-KI-008 can put a stale response in the grid
  and the benchmark fails for reasons unrelated to the figures.
