# Exploratory testing charters — Focus

Session-based charters for `vst-focus-seven`. Each is scoped to roughly 60–90
minutes and written in the standard form:

> **Explore** (target) **with** (resources) **to discover** (information)

Charters marked **⚠ writes** change server state. Read
`tests/destructive/README.md` before running one.

Findings so far live in `docs/findings.md`. When a charter turns up something
reproducible, add it there, and add a `test.fail()` spec under
`tests/known-issues/` plus an entry in `src/data/known-issues.ts`.

---

## Already done — the reconnaissance pass

**EX-00 · Survey the application surface** — *complete, 25 Aug 2026*

Explore every route with the browser devtools and the page source to discover
the stack, the routes, the widget types, and the API contract.

Produced `docs/app-map.md`, the reference data in `src/data/focus.ts`, and
findings KI-001, KI-002 and KI-003.

---

## Priority 1 — the numbers

The highest-value defects in a yield system are the ones where the page loads
perfectly and the figure is wrong. Automation covers the arithmetic that is
internally checkable; these charters go after the rest.

### EX-01 · Cross-report consistency ⭐ — *run 25 Aug 2026, two defects found*

**Explore** the same channel/market/week across Inventory Summary, Booking Pace
Summary, Above Below Forecast and Recommendations
**with** one fixed filter set and a spreadsheet
**to discover** whether the reports agree on shared quantities — capacity, paid
spots, revenue — and, where they differ, whether the difference is explained by
a documented definition rather than a bug.

Why it matters: each report is built by a different bundle and a different
endpoint. Nothing in the app forces them to agree, and no automated test can
assert agreement until we know which quantities are *supposed* to match.

Start with: Channel 7 / Sydney / week of 2026-06-21 / 0600–2359.

**Session result (that exact scope, API-driven, read-only):**

| Quantity | Inventory Summary | Booking Pace | Recommendations | Verdict |
|---|---|---|---|---|
| capacity | 97,125 | 97,125 | 97,125 | agree |
| paid | 58,365 | 58,365 | 58,365 | agree |
| available | 30,105 | 24,255 | 24,255 | **FOCUS-KI-007** |
| paid base revenue | 15,017,287 | 13,340,649 | — | **unresolved → EX-13** |
| paid net revenue | 2,362,691 | 2,098,088 | — | **unresolved → EX-13** |

Also found: **FOCUS-KI-006** (`/api/InventoryBookingPace` 500s unless `itemDate`
is a parseable date — including the contract default `itemDate=`), and a new
instance of KI-001 (`/api/BookingDiscountPace` 404s an empty result set).

**Method notes for anyone repeating this.** Booking Pace Summary returns a
*pace series* — one row per booking-snapshot date, not per programme — so the
comparable figure is its **last** row (18/05/2026, the data snapshot in the
footer). Recommendations stamps every row with the week-commencing date and
carries the real day in `weekDays`, so join slots on **`weekDays` + `startTime`**.
Joining on `airDate` collapses 99 rows into 23 and manufactures mismatches that
are not real — this cost a false lead during the session.

### EX-02 · What does an aggregate market actually represent? ⭐⭐

**Explore** the market hierarchy (`Victoria Agg` over `Vic Ex Albury` over
Ballarat/Bendigo/Gippsland/Shepparton)
**with** the Inventory Summary report and a product owner
**to discover** what an aggregate row's figures mean.

**This charter has already produced a surprise, which is why it is now the top
priority.** Measured on channel 7, week of 2026-06-21:

| Market | capacity | paid |
|---|---|---|
| Victoria Agg (29) | 92,670 | 40,545 |
| Albury (32) | 92,670 | **51,090** |
| Ballarat (34) | 92,670 | 47,850 |

Capacity is identical at every level — it behaves like airtime, not a summed
quantity. And a *child's* paid exceeds its *parent's*, so an aggregate is not a
sum. Is it an average? A weighted average by market size? Something else?

Until this is answered, no roll-up assertion can be written: the natural one
("parent = sum of children") would fail, and would be wrong about the product
rather than finding a bug. Answer this and a whole family of automated checks
becomes available.

Note also: `5 City Metro` and `Regional` (entityType 3 and 4) are **UI grouping
headers, not stations** — the API correctly 404s them. Only entityType 0
(market) and 2 (aggregate) are queryable.

### EX-03 · Demand flags and their discount ceilings

**Explore** the relationship between a recommendation's flag and its max discount
**with** the Recommendations grid and the flag definitions
(RED 35%, ORANGE 50%, YELLOW 60%, GREEN 70%, PURPLE 80%, BLUE 100%)
**to discover** whether any recommended discount exceeds the ceiling for its
flag, and how overrides interact with that ceiling.

A recommendation that discounts beyond its flag's ceiling is a revenue leak.
This is a prime candidate for promotion to an automated invariant.

**The data is reachable and the fields exist.** Each row carries
`currentFlagId`, `recommendedFlagId`, `userMaxDiscount`,
`recommendedMaxDiscount` and `calculatedMaxDiscount`, and the flag ceilings are
in `DEMAND_FLAGS`. To get rows at all, set the *Recommendations* filter to
"All" or widen the date range — the default "Any Change" returns nothing
(FOCUS-KI-004).

⚠ **Run this charter from the API or the grid, not the editor.** Opening the
recommendation editor POSTs `SetInspected`, so exploring by clicking through
recommendations silently marks them as reviewed. See `docs/findings.md`.

### EX-04 · The averageNet divisor ✅ — *answered 25 Aug 2026*

**Explore** the `averageNet` and `averageBase` fields on Inventory Summary
**with** the API response and the rendered grid
**to discover** what they are actually averaged over.

**Answered: `paid` is a duration in SECONDS, and the divisor is the number of
30-second-equivalent spots.**

```
averageNet  = paidNetRevenue  / (paid / 30)
averageBase = paidBaseRevenue / (paid / 30)
```

The recorded example fits exactly: `420 / 30 = 14`, and `110455 / 14 = 7889.64`.

Verified on **601 rows with `paid > 0` across 7 scopes** (data-rich week, current
week at both the default and a wide time window, Melbourne, Victoria Agg, 7TWO,
and the snapshot week) with **zero exceptions**.

Corroborated independently by `/api/Recommendations`, which names the same four
quantities `capacityDuration`, `paidDuration`, `bonusDuration` and
`availabilityDuration` — the seconds reading is the API’s own.

Now asserted as an invariant in `tests/integrity/inventory-invariants.spec.ts`
("average rates are revenue over 30-second-equivalent spots"). This charter is
closed; leave it here as the worked example of resolving a unit before
asserting on it.

---

### EX-13 · Same spots, different money ⭐⭐ 🔍

**Explore** paid revenue for one scope across Inventory Summary and Booking Pace
Summary
**with** the two API responses, day by day, and a product owner
**to discover** why identical booked volume is valued differently by the two
reports.

Raised by EX-01, and deliberately **not** written as an assertion because the
correct behaviour is unknown.

For channel 7 / Sydney / week 2026-06-21, the two reports agree on booked volume
**exactly, every single day** — and disagree on what that volume is worth:

| Day | paid (both) | Inventory Summary base | Booking Pace base | ratio |
|---|---|---|---|---|
| Mon | 6,495 | 2,683,472 | 2,366,652 | 1.134 |
| Tue | 9,060 | 2,318,066 | 2,083,871 | 1.112 |
| Wed | 8,670 | 2,312,074 | 2,068,884 | 1.118 |
| Thu | 7,995 | 1,836,001 | 1,655,413 | 1.109 |
| Fri | 9,180 | 2,176,604 | 1,932,059 | 1.127 |
| Sat | 9,405 | 2,068,646 | 1,822,765 | 1.135 |
| Sun | 7,560 | 1,622,424 | 1,411,005 | 1.150 |

What is known:

- Capacity and paid duration match **exactly** in every one of the seven days.
- The gap is **not a constant multiplier** (1.109–1.150), so it is not GST, a
  fixed loading, or a units error.
- Net tracks base almost exactly, and both reports independently report the same
  `paidAverageDiscount` (0.8427). So the discount is agreed; the **base rate**
  is not.

The leading hypothesis is that the pace series stores revenue *as at* each
snapshot date while Inventory Summary values the same spots at the current rate
card, so a re-rate since 18/05/2026 would separate them. That is a guess. If it
is right, the pace report’s final point understates current revenue, and whether
that is intended is a product question.

**Ask the product owner first**, then decide whether this is EX-13 the bug or
EX-13 the documented definition. Until then, no revenue-reconciliation assertion
should be written.

---

### EX-15 · Which late-night programmes Recommendations leaves out 🔍

**Explore** the slots that Inventory Summary has and Recommendations does not,
for channel 7 / Sydney / 0600–2359
**with** `/api/ProgramInventory` and `/api/Recommendations` side by side, a
range of weeks after the snapshot, and a product owner
**to discover** the rule that decides whether a programme that runs past
midnight is in Recommendations' scope.

Raised 2 Oct 2026 while repointing the KI-007 specs. In some weeks
Recommendations is missing one or two of Inventory Summary's slots, so the two
reports no longer cover the same population. Every missing slot starts 23:00–23:59
and runs well past midnight:

| Week | Missing from Recommendations | Present (also cross midnight) |
|---|---|---|
| 2026-08-30 | Su 2338–2438, Fr 2350–2529 | Mo 2305–2404, Sa 2300–2414 |
| 2026-09-13 | Th 2320–2459, Fr 2345–2524 | Mo 2310–2409, Tu 2345–2414 |
| 2026-09-20 | Sa 2300–2514 | Su 2300–2429, We 2345–2414 |
| 2026-12-06 | Sa 2330–2459 | — |

So "crosses midnight" is not the rule: everything missing ends at 24:38 or
later, and everything present ends by 24:29. A cut-off around 00:30, or one
based on the share of the programme inside the window, would both fit. Neither
is asserted.

Why it matters: KI-007's control ("capacity, paid and bonus DO agree") requires
the same slots in both reports. It holds in the week the specs use today
(2026-09-06), but would fail in a week with one of these slots. If that
happens, this charter is the reason. It is not KI-007.

---

### EX-14 · What a forecast fill above 100% means 🔍

**Explore** the Program vs. Forecast curves for 1800 Seven News (Channel 7 / SYD
/ Monday, week of 08/03/2026)
**with** the benchmark in `tests/benchmarks/program-vs-forecast.benchmark.spec.ts`,
other weeks of the same programme, and a product owner
**to discover** whether a forecast fill above 1.0 is intended, and why paid
fill has no figure in the last two weeks before air.

Raised while building the Program vs. Forecast benchmark (1 Oct 2026). Two
things look odd; neither is asserted, because the rule is unknown:

- The **current** forecast reaches 1.127 at 0 weeks prior, and the generic
  (not program-specific) curve for the same forecast reaches 1.445. Either
  forecasts deliberately target overbooking, or the curve is not capped where it
  should be.
- **Paid fill is `null` at 0 and 1 weeks prior** but has values from 2 to 27
  weeks prior (0.83 at 2 weeks). The data snapshot (18/05/2026) is well after
  this week aired, so "no snapshot yet" does not explain it. It could be how
  the snapshots are bucketed into weeks prior.

Not a question: the generic curve sitting ~0.318 above the current one is the
"Program specific" flag. Tick it and the two curves are identical; the
benchmark spec pins that.

---

## Priority 2 — filters and state

### EX-05 · Filter persistence across pages

**Explore** how filter selections persist
**with** localStorage/sessionStorage open in devtools, moving between all five
report pages
**to discover** whether a filter set on one page leaks into another, whether the
persisted shape survives a Focus version change, and what happens when storage
holds a channel or market that no longer exists.

The last one is the interesting case: seed localStorage with a deleted channel
id and see whether the page recovers or breaks.

### EX-06 · Boundary values on every filter

**Explore** the filter controls
**with** deliberately awkward input
**to discover** how Focus handles: end date before start date; end time before
start time; a single-minute window; a 5-year range; 2359 vs 0000; every day
deselected in the Day of Week picker; every channel selected at once.

Note both the UI response and the resulting API call — the two can disagree.

### EX-07 · Re-optimise scope and outcome ⚠ writes — *mostly answered, 25 Aug 2026*

**Explore** a re-optimise over the narrowest possible scope
**with** a before/after capture of the affected recommendations
**to discover** what actually changes, whether the scope is honoured, what the
progress bar does on a long job, and what happens if the browser is closed
mid-run.

**Run performed:** Channel 7, markets SUN + WID, 31 May – 6 Jun 2026,
Mon/Tue/Thu, 2000–2030. Two recommendations in scope.

**What a scoped re-optimise does:**

| Observable | Before | After |
|---|---|---|
| `runId` on the 2 in-scope rows | 22038 | **22039** |
| `runId`, same markets/week, wider day+time | 22038 | 22038 **and** 22039 (only the 2 moved) |
| `runId`, different market (SYD) | 22038 | 22038 |
| `runId`, same markets, different week | 22038 | 22038 |
| `lastPartialOptimiseDate` | 14/07/2026 11:18 | **25/08/2026 11:54** |
| `lastFullOptimiseDate` | 15/07/2026 06:48 | 15/07/2026 06:48 |
| Flags, discounts, row count | — | **unchanged** |

**The scope was honoured exactly.** Nothing outside the selected market, week,
day-of-week or time window was touched.

**The catch worth knowing:** the recommendation *values* did not change. A run
that changes nothing is still a successful run, so "recommendations changed" is
NOT a valid assertion. The reliable signature is a new `runId` on in-scope rows
plus an advanced `lastPartialOptimiseDate`.

Now covered by `tests/destructive/reoptimise.spec.ts`, which asserts both halves
— in-scope rows move, out-of-scope rows do not.

**Still open from this charter:**

- What happens if the browser is closed mid-run? The job is server-side, so it
  presumably continues, but that is untested.
- What does a run look like when it *does* change a recommendation? Everything
  observed had `changed: "No"`. Finding a scope where the optimiser genuinely
  moves a flag or discount would let us assert on the interesting case.
- Concurrency: two overlapping re-optimise jobs on overlapping scopes.

---

## Priority 3 — robustness and quality attributes

### EX-08 · Concurrency and stale reads

**Explore** two browser sessions against the same channel/market
**with** one editing an optimiser rule or override while the other reads
**to discover** whether the second session sees stale data, whether there is any
conflict detection, and whether last-write-wins silently discards an edit.

### EX-09 · The empty and the enormous

**Explore** the extremes of result size
**with** filter combinations that return zero rows, and ones that return
everything (all channels, all markets, a year-long range)
**to discover** how Focus behaves at both ends: does the empty case say "no data"
or look broken; does the large case paginate, virtualise, time out, or hang the
browser.

Relevant to KI-001 — the empty case currently produces a console error.

### EX-10 · Session-free access

**Explore** the fact that Focus requires no login
**with** a fresh private window
**to discover** whether that is intended for this environment, and what an
unauthenticated visitor can reach — including the endpoints that mutate state
via GET (`/api/ReOptimise`, `/api/BulkOverrideFlags`).

**Raise as a question before probing further.** If auth is expected to exist
here, that is the finding, and no further poking is needed.

### EX-11 · Keyboard and screen-reader access

**Explore** the filter controls and grids
**with** keyboard only, then a screen reader
**to discover** whether the Kendo widgets are reachable and operable without a
mouse, and whether grid figures are announced with their column context.

**Already has a concrete lead.** The filter controls carry no accessible name:
Summary By and Channel are `role="combobox"` with no `aria-label` and no
associated `<label>`; only Start/End Time have anything (a placeholder). A
screen reader announces several unlabelled comboboxes in a row. The same gap is
why Playwright's codegen can only locate them by position — see
[`recording-tests.md`](recording-tests.md).

### EX-12 · The scheduler views

**Explore** the Schedule View tab on Optimiser Rules and the scheduler view on
Recommendations
**with** varied date ranges and zoom levels
**to discover** how events render at boundaries — a rule spanning midnight, one
crossing the 6am `hourOffset`, overlapping rules, zero-duration events.

`hourOffset: 6` in the bootstrap config suggests the broadcast day starts at
6am, which makes midnight a likely edge.

---

## Running a session

1. Pick one charter. Timebox it. Don't drift into another.
2. Keep a running log: what you did, what you saw, what surprised you.
3. Note **questions** as well as bugs — a charter that produces a good question
   has earned its time.
4. Afterwards, split the output three ways:
   - reproducible defect → `docs/findings.md` + a `known-issues` spec
   - confirmed invariant → a new spec in `tests/integrity/`
   - unresolved question → back into this file as a new charter

## Asking Claude Code for help mid-session

This repo is set up so an agent can join a session usefully. Things worth asking:

- *"Reproduce this against the API and tell me the exact query that triggers it."*
- *"Is this in the known-issues register already?"*
- *"Turn what I just found into a failing test."*
- *"What does the bootstrap JSON on this page say about X?"* — the inline config
  is the fastest source of truth for reference data.
