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

### EX-01 · Cross-report consistency ⭐

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

### EX-04 · The averageNet divisor 🔍

**Explore** the `averageNet` and `averageBase` fields on Inventory Summary
**with** the API response and the rendered grid
**to discover** what they are actually averaged over.

Open question from reconnaissance. On one observed row:
`paidNetRevenue 110455`, `paid 420`, `averageNet 7889.64`.
`110455 / 420 = 263`, but `110455 / 14 = 7889.64` — so the divisor is 14, not
the paid spot count. Is 14 a spot count where `paid` is a duration in seconds?
Confirm the unit before writing an assertion; a guessed invariant here would be
worse than none.

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
