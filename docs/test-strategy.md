# Test strategy — Focus

## What we are actually protecting against

Focus decides how aggressively advertising inventory gets discounted. The
failure that costs money is not a page that won't load — someone notices that in
minutes. It is a page that loads perfectly and shows a **wrong number**, or an
optimiser that recommends a discount beyond its ceiling. Nobody notices that for
a quarter.

So the suite is weighted toward the figures, not the chrome:

| Layer | What it proves | Cost |
|---|---|---|
| Smoke | The deployment is alive; all 13 routes render; navigation works | seconds |
| API | The server's contract and its handling of bad input | ~8s, no browser |
| Reports | Filters drive the right queries; grids and charts bind | ~60s |
| Integrity | The numbers obey their business rules | ~8s |
| Known-issues | Open defects stay visible and their fixes get detected | ~4s |
| Destructive | Write operations — **opt-in only** | minutes |

## Why the API layer exists separately

Every report page is a Kendo grid bound to one endpoint. When a report shows the
wrong thing, the first question is always "server or browser?".

Running `npm run test:api` answers it in eight seconds without a browser. If the
API tests pass and the report tests fail, the defect is in the front end. That
split has already paid for itself: it is how KI-003 was isolated to input
validation rather than to the Inventory Summary page.

## Why invariants instead of golden values

The data changes: snapshots get re-imported, re-optimisation rewrites
recommendations. A test asserting `capacity = 790` is worthless a week later.

The integrity specs assert **relationships that must hold for any snapshot**:

- `paid + bonus + available = capacity` — inventory is conserved
- `paidFill = paid / capacity` — the ratio matches its own inputs
- `totalBooked + availablePercent = 1` — every unit is booked or available
- `paidNetRevenue ≤ paidBaseRevenue` — net is base after discount, so a breach
  means a discount applied the wrong way round
- no negative quantities; ratios within 0–100%

These stay meaningful indefinitely, and they fail loudly on exactly the class of
bug that matters. All eight currently pass against live data.

The same principle drove the Re-Optimise and Recommendations specs. Rather than
pin a row count, they assert relationships that survive the optimiser running
again: "Both returns at least as many rows as Manual", "sorting does not change
the row count", "out-of-scope rows keep their runId".

**Where a relationship could not be established, no assertion was written.** The
market hierarchy is the worked example: the natural roll-up assertion ("parent =
sum of children") is provably false here, so EX-02 holds the question and the
API spec asserts only what is known to be true.

## What is deliberately not covered, and why

**~~The outcome of a re-optimise.~~ — now covered.** A supervised run on
25 Aug 2026 established the signature (charter EX-07), so
`tests/destructive/reoptimise.spec.ts` asserts a real outcome rather than "it
did not crash". The lesson from that exercise is worth keeping, because the
obvious assertion was the wrong one:

> After a re-optimise the recommendation **values did not change** — same flags,
> same discounts, same row count. Only `runId` moved. So "the recommendations
> changed" is not a valid post-condition; a run that changes nothing is still a
> successful run, and a test asserting otherwise would fail intermittently in a
> way that looks like a product bug.

The dependable signature is *new `runId` in scope, **old** `runId` out of scope,
partial timestamp advanced*. The out-of-scope half is the one that matters — a
write that quietly widened its blast radius is the serious failure, and the UI
would not reveal it.

**Still not covered from EX-07:** what happens when the browser closes mid-run,
what a run that genuinely *changes* a recommendation looks like (everything
observed had `changed: "No"`), and overlapping concurrent jobs.

**Cross-report consistency.** Whether Inventory Summary and Booking Pace Summary
should report identical capacity for the same filters is a product question, not
an observable one. Charter EX-01 exists to answer it; the automation follows.

**The `averageNet` divisor.** Reconnaissance showed `averageNet` is not
`paidNetRevenue / paid` — the divisor was 14 where `paid` was 420. Rather than
guess an invariant, this is charter EX-04. A wrong assertion here would fail
constantly and get deleted, taking the real question with it.

**Aggregate arithmetic.** The first attempt here asserted `child ≤ parent` for
market hierarchies, and the live data disproved it: capacity is identical at
every level, and Albury's `paid` (51,090) exceeds its parent Victoria Agg's
(40,545). So the assertion was removed rather than weakened, and the API spec now
checks only what is known — that group headers are not queryable and that real
markets return non-negative figures. What an aggregate row actually represents is
charter EX-02, and answering it unlocks a whole family of checks.

**Visual regression.** Kendo charts render to canvas, and the data changes under
them, so screenshot comparison would be almost pure noise. The charts are checked
for existence and series count instead.

**Authentication.** There is none to test. Whether that is correct is charter
EX-10, and a question for the team before it is a test.

## Flake control

Kendo plus a server-rendered app gives several ways to be accidentally flaky.
The measures that matter here:

- **Never `networkidle`.** Focus keeps connections warm. `waitForPageReady`
  waits on jQuery's active-request count and Focus's own `#is-loading` flag.
- **Read the widget, not the DOM.** `readGrid` asks the Kendo datasource what it
  holds. Rendered rows are virtualised and lie about totals.
- **Resolve widget wrappers generically.** Kendo hides the original `<input>` for
  most widget types. Helpers find the nearest `k-input`/`k-picker` ancestor
  rather than hard-coding per-widget class names — this is what fixed the first
  round of failures.
- **Commit ComboBox edits with Enter.** Blur alone reverts the value, which looks
  exactly like the app ignoring the change.
- **Aborted requests are not failures.** Kendo cancels in-flight fetches when
  filters change. Diagnostics ignore `ERR_ABORTED` — which is also why KI-002
  needs its own dedicated spec.
- **Skip honestly.** Where data may be absent, tests `skip` with a reason rather
  than asserting something vacuous.

## Extending the suite

Roughly in value order:

1. **Recommendations invariants** — no recommended discount above its flag's
   ceiling (charter EX-03). Highest value still on the table: a direct revenue
   leak, and mechanically checkable once the rule is confirmed.
2. **Aggregate market arithmetic** — after EX-02.
3. **Filter boundary cases** — after EX-06, promote whatever it finds.
4. **Optimiser rule CRUD** — needs a naming convention for test-created rules so
   they can be cleaned up after a failed run.
5. **Cross-browser** — the config has Chromium only. Add Firefox/WebKit once the
   suite is stable, since Kendo's popup behaviour differs between them.

## Reading order for someone new

1. [`app-map.md`](app-map.md) — what Focus is and how its pages are built.
2. [`write-surface.md`](write-surface.md) — **before touching anything**, what
   writes and what only looks like it does.
3. [`findings.md`](findings.md) — the five open defects, most serious first.
4. This file — why the suite is shaped the way it is.
5. [`recording-tests.md`](recording-tests.md) — when you want to add a test.
6. [`exploratory-charters.md`](exploratory-charters.md) — when you want to go
   looking for something new.

## Keeping this honest

The suite is only useful if a red build means something. Two rules:

- Do not disable a failing test. Either fix it, or register it as a known issue
  with a `test.fail()` spec that states the correct behaviour.
- Do not add an assertion you cannot justify. If you are unsure what the rule is,
  write a charter instead — an open question in `docs/exploratory-charters.md` is
  worth more than a guessed assertion in `tests/`.
