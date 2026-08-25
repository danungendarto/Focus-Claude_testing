# Findings — Focus

Defects and observations found while building the suite. Each has an id used in
`src/data/known-issues.ts` and a spec under `tests/known-issues/`.

Environment: `vst-focus-seven`, Focus **3.4.0.53**, data snapshot 18/05/2026.
Found: 25 Aug 2026.

Replace the `FOCUS-KI-*` ids with real ticket numbers once these are raised.

## At a glance

| Id | Sev | Summary | Where |
|---|---|---|---|
| [KI-005](#focus-ki-005--re-optimise-headroom-check-is-unreachable-property-name-casing) | 🔴 high | Re-Optimise headroom safeguard is dead code — client reads `IsBudgetEnabled`, API sends `isBudgetEnabled` | `/ReOptimise` |
| [KI-003](#focus-ki-003--unknown-channelid-returns-a-500-with-an-html-error-page) | 🔴 high | Unknown `channelId` returns 500 with an HTML error page from a JSON endpoint | report APIs |
| [KI-001](#focus-ki-001--empty-result-sets-are-returned-as-http-404) | 🟠 med | Empty result sets returned as 404 with plain text, not 200 `[]` | several APIs |
| [KI-004](#focus-ki-004--recommendations-shows-an-empty-grid-by-default-hiding-real-data) | 🟠 med | Recommendations shows an empty grid by default, hiding 99 real rows | `/Recommendations` |
| [KI-002](#focus-ki-002--report-pages-fetch-their-data-twice-on-load) | 🟡 low | Report pages fetch their data twice on load | all reports |

Two of these are **silent** — KI-005 and KI-004 produce no error a user would
notice, which is what makes them the ones worth raising first.

Observations that are not defects but change how you test are further down, and
the safety-critical ones are consolidated in
[`write-surface.md`](write-surface.md).

---

## FOCUS-KI-003 · Unknown channelId returns a 500 with an HTML error page

**Severity: high** · `/api/ProgramInventory` (likely all report endpoints)

A `channelId` that is well-formed but does not exist causes an unhandled server
error. The response is a full HTML error page from an endpoint that otherwise
returns JSON, so an API client fails at the parse rather than surfacing the
error.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://vst-focus-seven/api/ProgramInventory?channelId=5012&stationId=1&dayOfWeekId=127&startTime=1800&endTime=2230&midPoint=0&startDate=2026-08-23&week=2026-08-23&endDate=2026-08-29&sortBy=Week&sortOrder=Desc&selectedItemId=-1&periodStyle=Weeks&comparativeForecastId=0&comparativeIsProgramSpecific=false&comparativeForecastModifier=0&selectedChannels=5012&selectedStations=1&summaryType=0&itemDate="
```

Returns `500`, `Content-Type: text/html`, body beginning `<!DOCTYPE html>` with
`<title>Error - Focus</title>`.

**Why it is a real problem, not just untidy:** the input path is only
half-validated. `channelId=abc` is correctly rejected with a `400`, so validation
exists — it just does not cover the valid-type/invalid-value case. Any client
that constructs an id (a stale bookmark, a saved filter referencing a deleted
channel, an integration) gets a crash instead of an empty result.

**Expected:** `400` if the id must exist, or `200` with an empty array if it need
not. Never a `500`.

**Covered by:** `tests/known-issues/api-error-contract.spec.ts`

---

## FOCUS-KI-001 · Empty result sets are returned as HTTP 404

**Severity: medium** · `/api/OptimiserRule`, `/api/AboveBelowForecast`,
`/api/Blacklist`, `/api/Recommendations`

When a filter combination matches no data, Focus responds `404` with a
plain-text body rather than `200` with an empty array.

```bash
curl -i "http://vst-focus-seven/api/OptimiserRule?...&ruleType=default"
# HTTP/1.1 404 Not Found
# No Optimise Rules found.
```

Consequences:

- Every Optimiser Rules page load with no matching rules logs a console error.
  Real errors get lost in that noise.
- "This resource does not exist" and "your filter matched nothing" become
  indistinguishable to a client.
- The body is plain text, while validation errors on the same API use RFC 7807
  `application/problem+json`. A client cannot handle Focus errors uniformly.
- Any monitoring that watches 4xx rates sees false alarms during normal use.

**Expected:** `200` with `[]`. An empty result is a successful query.

**Covered by:** `tests/known-issues/api-error-contract.spec.ts`

---

## FOCUS-KI-002 · Report pages fetch their data twice on load

**Severity: low** · observed on `/BookingPaceSummary`, likely all report pages

On a single page load Focus issues its first data request, cancels it
(`ERR_ABORTED`), and immediately re-sends a byte-identical one.

Functionally harmless, but it doubles server load for every page view, and it
makes request-count assertions unreliable in tests. Probably a filter-change
event firing during initialisation, before the widgets have settled.

**Covered by:** `tests/known-issues/api-error-contract.spec.ts`

---

## FOCUS-KI-004 · Recommendations shows an empty grid by default, hiding real data

**Severity: medium** · `/Recommendations`

Open the page and the grid is empty. It looks like there is nothing to review.

There is: for the current week (23–29 Aug 2026) on Channel 7 / Sydney, **99
recommendations exist**. They are hidden because the *Recommendations* filter
defaults to **"Any Change"**, which returns no rows for a typical single week.
Switching it to **"All"** reveals all 99.

```bash
# default filter (changeStatus=2, "Any Change") -> 404, no rows
curl -s -o /dev/null -w "%{http_code}\n" "http://vst-focus-seven/api/Recommendations?dayOfWeekId=127&startTime=1800&endTime=2230&startDate=2026-08-23&endDate=2026-08-29&optimisationType=1&sendStatus=0&changeStatus=2&viewType=Grid+View&programName=*&selectedStations=1&channelId=1&stationId=1&currentFlagId=-1"

# same query, "All" (changeStatus=0) -> 200 with 99 rows
curl -s "http://vst-focus-seven/api/Recommendations?...&changeStatus=0..." | jq length
```

Why it matters: the landing state of the page is indistinguishable from "the
optimiser produced nothing this week". A planner has no prompt to change the
filter, and the empty grid carries no message explaining that a filter is
excluding rows. Compounded by KI-001 — the underlying 404 also logs a console
error, so the page looks broken rather than filtered.

**Suggested fix:** either default to "All", or render an explicit empty state
("No recommendations match the current filters") when a filter excludes rows.

**Found by:** converting a recorded session, 25 Aug 2026.

---

## FOCUS-KI-005 · Re-Optimise headroom check is unreachable (property-name casing)

**Severity: high** · `/ReOptimise`, `/api/ReOptimise/HasHeadroomBudgets`

The headroom safeguard on the Re-Optimise page can never fire, because the
client reads a property the API does not send.

| Side | Property |
|---|---|
| API response | `{"isBudgetEnabled": false}` — **camel**Case |
| Client code | `if (e.IsBudgetEnabled)` — **Pascal**Case |

JavaScript property access is case-sensitive, so `e.IsBudgetEnabled` is always
`undefined`, always falsy, and **the `if` branch is dead code**. Verified: the
bundle contains exactly one occurrence of `IsBudgetEnabled` and zero of
`isBudgetEnabled`; the API returned camelCase on every station selection tried.

```bash
curl -s "http://vst-focus-seven/api/ReOptimise/HasHeadroomBudgets?channelId=1&stationId=1&dayOfWeekId=127&startTime=600&endTime=2359&startDate=2026-05-31&endDate=2026-06-06&selectedChannels=1&selectedStations=1"
# {"isBudgetEnabled":false}
```

**What is supposed to happen** when budgets are enabled (from the bundle):

```js
if (e.IsBudgetEnabled) {
  $(headroomMessage).show();               // warn the planner
  dayOfWeek.value(allSevenDays); dayOfWeek.enable(false);
  startTime.select(0); endTime.select(last);
  startTime.enable(false); endTime.enable(false);
}
```

So the intended behaviour is: force the scope to the whole week, widen the times
to their extremes, lock all three controls, and explain why. The warning text is
already in the page markup, permanently `display: none`:

> "Headroom is enabled for the Station/Channel selection(s) in this date range.
> The 'Time Range' and 'Day of Week' values will be defaulted to the whole week."

**Why this is rated high.** If headroom budgets are ever enabled for a
station/channel/date combination, a planner can start a re-optimisation with a
narrow day and time scope when the design requires whole-week scope — and gets
no warning, no forced correction, and no visible sign anything is wrong. Given
Re-Optimise rewrites recommendations and cannot be undone, running it at the
wrong scope is expensive to discover and expensive to reverse.

**Caveat on severity:** every response observed in this environment was
`false`, so the branch has not been seen to matter *here*. Whether it matters
depends on whether headroom budgets are enabled in production — worth asking the
team, because that answer decides between "dead code to tidy up" and "a
safeguard that has silently never worked".

**Fix:** align the casing on one side. Changing the client to `isBudgetEnabled`
is the smaller change; changing the server risks other consumers.

**Covered by:** `tests/known-issues/headroom-contract.spec.ts` — written as a
contract test that reads the property name out of the shipped bundle and
compares it against the live response, so it passes as soon as *either* side is
corrected.

**Found by:** converting a recorded session, 25 Aug 2026.

---

## Observations — not defects, but worth knowing

### The Recommendations page writes in more places than it appears to ⚠ safety

This one matters for **manual** testing as much as automation. The page looks
like a read-only report with a couple of obvious action buttons. It is not.
Four separate write paths, two of them invisible:

| Action | What it does | Obvious? |
|---|---|---|
| **Send** | `POST /api/Recommendations/SendAndMark` — pushes downstream | yes |
| **Bulk Override** | Writes override flags across the selection | yes |
| Editing a **user flag** or **minimum rate** cell in the grid | `POST /api/Recommendations/UserFlags` or `/UserMinRate` **immediately on change** — no save step, no confirmation | **no** |
| **Opening the recommendation editor** | `POST /api/Recommendations/SetInspected` fires *before* the window appears | **no** |

The last one is the trap. The editor is reached by clicking an event in the
**Scheduler** view, and Focus marks the recommendation inspected on the way in.
**Cancel does not undo it** — the write has already happened. So "I only looked
at it, I cancelled out" is not accurate.

Two consequences:

- Anyone exploring this page by clicking around is changing data, including the
  inspected flag that presumably drives someone's workflow.
- The `inspected` state cannot be reset from the UI.

Worth asking the team whether marking-on-open is intended. It is defensible as a
feature (track what has been reviewed) but it should be documented, because
nothing on screen suggests that opening an item records anything.

### What a scoped re-optimise actually does — verified

A supervised run on 25 Aug 2026 (Channel 7, SUN + WID, 31 May – 6 Jun,
Mon/Tue/Thu, 2000–2030) established the behaviour, closing charter EX-07:

- **Scope is honoured exactly.** The 2 in-scope recommendations moved from
  `runId` 22038 to 22039. Same markets with a wider day/time window still showed
  22038 on the other 204 rows; a different market and a different week were
  untouched.
- **`lastPartialOptimiseDate` advances; `lastFullOptimiseDate` does not.** A
  scoped run is correctly recorded as partial.
- **Recommendation values need not change.** Flags, discounts and row counts were
  identical afterwards. A run that changes nothing is still a successful run — so
  "the recommendations changed" is not a valid post-condition, and any test
  asserting it would fail intermittently for the wrong reason.

The dependable signature is therefore: *new `runId` in scope, old `runId` out of
scope, partial timestamp advanced*. That is what
`tests/destructive/reoptimise.spec.ts` asserts.

### The recommendation editor cannot be opened from the grid

Only from the **Schedule View** tab, by clicking a `.k-event`. Double-clicking a
grid row does nothing at all. Not a defect, but non-obvious enough that it cost
an afternoon to establish — and it means grid-based and scheduler-based testing
of the same recommendation take different routes.

### The Recommendations grid uses three levels of header

Row 1 is grouping headers (Changed, Program, Bookings, Forecast, Rate, Indicator,
Status), row 2 the real columns (Channel, Market, Week, Day, Time, Title,
Capacity, …), row 3 splits Time into Start/End.

**Only the leaf columns are sortable.** Clicking "Program" looks like a sort and
does nothing — there is no feedback either way. Use `readGridLeafColumns()` in
`src/kendo/kendo.ts` to see which titles are real columns.



### Inconsistent error contract across one API

Three different shapes for three kinds of failure:

| Situation | Status | Body |
|---|---|---|
| Validation failure | 400 | `application/problem+json`, with a populated `errors` object — **good** |
| Empty result | 404 | plain text — KI-001 |
| Unknown id | 500 | HTML error page — KI-003 |

The validation path is genuinely well done. The other two should be brought up
to match it.

### The job endpoints are verb-split, and GET is the safe half

*Corrected 25 Aug 2026 — an earlier version of this note claimed these were GETs
that mutate. They are not.*

`/api/ReOptimise` and `/api/BulkOverrideFlags` each serve two different
operations on one path, separated only by the verb:

| Path | GET | POST |
|---|---|---|
| `/api/ReOptimise` | *(n/a — see sub-routes below)* | **starts the optimisation job** |
| `/api/ReOptimise/HasHeadroomBudgets` | read-only check, fires when filters change | — |
| `/api/ReOptimise/Status` | read-only progress polling | — |
| `/api/BulkOverrideFlags` | read-only progress polling | **performs the bulk override** |

Practical consequence, and it is a helpful one: **browsing the ReOptimise and
Bulk Override pages and changing their filters is safe.** Only the POST writes,
and only the on-screen action button issues it.

The residual risk is the reverse of what was first assumed: a path that reads on
GET and writes on POST is easy to mis-call from a script or an API client that
defaults to the wrong verb. Worth keeping in mind when extending the destructive
specs.

### No authentication

Every route and endpoint is reachable anonymously. May be intentional for a test
box; worth confirming, given the point above. See charter EX-10.

### Aggregate markets are not sums of their children ⚠ affects any roll-up test

Measured on channel 7, week of 2026-06-21, 0600–2359:

| Market | entityType | rows | capacity | paid |
|---|---|---|---|---|
| Victoria Agg (29) | 2 (aggregate) | 97 | 92,670 | 40,545 |
| Albury (32) | 0 (market) | 102 | 92,670 | 51,090 |
| Vic Ex Albury (33) | 2 | 97 | 92,670 | 40,860 |
| Ballarat (34) | 0 | 97 | 92,670 | 47,850 |

Two things fall out, and both contradict the obvious assumption:

- **Capacity is identical at every level.** It behaves like *airtime* — the same
  schedule airs across markets — not like a quantity that sums.
- **A child's `paid` can exceed its parent's.** Albury (51,090) is higher than
  Victoria Agg (40,545), so an aggregate is evidently not a sum, and may be an
  average or a weighted figure.

Anyone writing a roll-up assertion — "the aggregate should equal the sum of its
children" — will get a failing test that is wrong about the product, not about
the code. What an aggregate's `paid` actually represents is **charter EX-02**,
and it needs a product answer before it can be automated.

### Group-header entities are not queryable stations

`5 City Metro` (id 7, entityType 3) and `Regional` (id 73, entityType 4) are UI
grouping headers, not stations. Querying them returns `404` — correctly, and
notably this 404 **is** properly shaped `application/problem+json`, unlike the
plain-text empty-result 404s in KI-001. The API is inconsistent with itself even
within the same status code.

Real markets (entityType 0) and true aggregates (entityType 2) both return 200.

### Data coverage varies by week *and* by time window

`/api/Recommendations` returns 404 for 1800–2230 but 200 for 0600–2359 in the
same week. A narrow default window can look like missing data. Use
`DATA_RICH_WEEK` and `WIDE_TIME_WINDOW` from `src/data/focus.ts` when a test
needs populated rows.

---

## Verified as working correctly

Worth recording, so this ground is not re-covered:

- **Inventory arithmetic holds.** Across every row returned for the current week:
  `paid + bonus + available = capacity`; each fill ratio matches its underlying
  counts; `totalBooked = paidFill + bonusFill`; booked + available = 100%; no
  negative quantities; net revenue never exceeds base revenue.
  (`tests/integrity/inventory-invariants.spec.ts`, 8 specs, all passing.)
- **Validation on `comparativeForecastModifier`** correctly enforces 0.1–99.9 in
  0.1 steps and returns a properly structured problem+json response.
- **Non-numeric ids** are correctly rejected with a `400`.
- **All 13 routes** return 200, render the shared navbar/footer, and initialise
  their Kendo widgets without JavaScript errors.
- **Filter persistence** works: selections survive a reload, and "Reset page
  filters" restores the defaults.
