# Focus — application map

Reconnaissance notes for `http://vst-focus-seven/`, captured 25 Aug 2026 against
Focus **version 3.4.0.53**.

Everything here was observed from the running app, not from source. Re-verify
before relying on it after a deployment.

## What Focus is

A broadcast-TV advertising **yield and inventory optimisation** system. It holds
the ad inventory for a set of channels and markets, forecasts demand, and
recommends how aggressively each spot should be discounted.

The core loop the product exists to serve:

```
imported bookings  ->  forecast demand  ->  optimiser rules  ->  recommendations
                                                                      |
                                                       planner reviews / overrides
                                                                      |
                                                                 sent downstream
```

## Stack

| Layer | Technology |
|---|---|
| Server | ASP.NET Core, server-rendered Razor pages |
| UI widgets | Kendo UI for jQuery (grids, charts, schedulers, pickers) |
| Layout | Bootstrap 5, with scoped-CSS attributes (`b-oi7227osmb`) |
| Front-end code | Three bundles: `reports`, `optimiser`, `forecasts` |
| Data to the browser | REST under `/api/`, plus a large bootstrap JSON inlined per page |

**Authentication: none.** Every route is reachable anonymously. Worth confirming
whether that is intended for this environment or a gap.

## Routes

| Menu | Route | Purpose |
|---|---|---|
| Reports | `/ProgramInventorySummary` | Inventory Summary — capacity, fill, revenue |
| Reports | `/BookingPaceSummary` | How bookings accumulate toward transmission |
| Reports | `/BookingDiscountPace` | Booking pace against discount levels |
| Reports | `/ProgramVsForecast` | Actuals vs. a chosen forecast curve |
| Reports | `/AboveBelowForecast` | Which inventory is running ahead or behind |
| Forecast | `/Forecast` | Create and view forecasts, with curve chart |
| Forecast | `/ForecastBlackLists` | Periods excluded from forecasting |
| Forecast | `/ForecastDiscountCurves` | Discount curve definitions |
| Optimise | `/OptimiserRules` | Default + exception rules, gaps/overlaps, schedule view |
| Optimise | `/GridMaintenance` | Programme grid upkeep |
| Optimise | `/ReOptimise` | **Starts a server-side optimisation job** |
| Optimise | `/BulkOverride` | **Bulk-writes override flags** |
| — | `/Recommendations` | The optimiser's output; review, override, send |

## Page anatomy

The five report pages are one layout with a different id prefix:

```
.page-title            the heading
#<prefix>-filter-Export     Export button
#filters-container          Kendo pickers
#<prefix>-report-grid       Kendo grid
#<prefix>-report-chart      Kendo chart
```

| Page | Prefix |
|---|---|
| Inventory Summary | `pir` |
| Booking Pace Summary | `bps` |
| Booking / Discount Pace | `bdp` |
| Program vs. Forecast | `pvf` |
| Above Below Forecast | `abf` |
| Create and View Forecasts | `cvf` |
| Optimiser Rules | `optimiser` |
| Re-Optimise | `rop` |
| Bulk Override | `bof` |
| Recommendations | `rec` |

## Pages that are not report-shaped

Three pages break the template above, and each cost time to work out:

**Recommendations** (`rec`) — a tabstrip with two views over the same data:

- **Grid View** (`#rec-grid`) — three levels of column header. Row 1 is
  *grouping* headers (Changed, Program, Bookings, Forecast, Rate, Indicator,
  Status); row 2 the real columns (Channel, Market, Week, Day, Time, Title,
  Capacity, …); row 3 splits Time into Start/End. **Only the leaf columns sort**
  — clicking "Program" does nothing, silently. `readGridLeafColumns()` lists the
  real ones.
- **Schedule View** (`#rec-scheduler`) — the *only* way to open the
  recommendation editor, by clicking a `.k-event`. The grid has no detail popup;
  double-clicking a row does nothing.
- The grid also carries **inline editors that write on change**. See
  [`write-surface.md`](write-surface.md).

**Re-Optimise** (`rop`) — filters plus a single action button. Changing a filter
fires only `GET /api/ReOptimise/HasHeadroomBudgets`; the button POSTs.

**Optimiser Rules** (`optimiser`) — a four-tab strip (Default, Exception,
Gaps/Overlaps, Schedule View) with a shared modal editor.

## Kendo widget types

This matters for test authoring — each type needs a different interaction.

| Control | Widget | How the DOM looks |
|---|---|---|
| Channel, Market, Day of Week | `kendoDropDownTree` | Renders as `span.k-multiselecttree`; original `<input>` **hidden** |
| Start/End Time | `kendoComboBox` | `span.k-combobox`; original hidden, visible `input.k-input-inner` |
| Week Start/End | `kendoDatePicker` | `span.k-datepicker`; original input **is** the visible one |
| Summary By, Status, Optimisation Type | `kendoDropDownList` | `span.k-picker`; **no inner input**, the span is the control |

`src/kendo/kendo.ts` resolves all four uniformly by finding the nearest ancestor
span carrying `k-input` or `k-picker`.

Three further traps, all found the hard way:

- **Grid headers are `span.k-link > span.k-column-title`**, not the `a.k-link`
  older Kendo versions used.
- **Multi-select tree checkboxes carry regenerated GUID ids** (`_ccc8c054-…`) —
  91 of them on `/ReOptimise`, all different on every page load. Never locate by
  them; see [`recording-tests.md`](recording-tests.md).
- **No control has an accessible name.** No `aria-label`, no associated
  `<label>`. That is why locators must go through ids and page objects, and it is
  an accessibility finding in its own right (charter EX-11).

## API

Every report endpoint takes the same query contract, regardless of which
parameters that page actually uses:

```
channelId, stationId, dayOfWeekId, startTime, endTime, midPoint,
startDate, week, endDate, sortBy, sortOrder, selectedItemId, periodStyle,
comparativeForecastId, comparativeIsProgramSpecific, comparativeForecastModifier,
selectedChannels, selectedStations, summaryType, itemDate
```

- `dayOfWeekId` is a **7-bit mask** — 127 is every day, 1 is a single day.
- `startTime` / `endTime` are **HHmm integers** (1800, 2230).
- Weeks run **Sunday to Saturday**.
- Dates are `yyyy-MM-dd` in the API, `dd/MM/yyyy` in the UI.

| Endpoint | Verbs seen | Safe to call |
|---|---|---|
| `/api/ProgramInventory` | GET | yes |
| `/api/InventoryBookingPace` | GET | yes |
| `/api/BookingPaceSummary` | GET | yes |
| `/api/BookingDiscountPace` | GET | yes |
| `/api/ProgramVsForecast` | GET | yes |
| `/api/AboveBelowForecast` | GET | yes |
| `/api/GapsAndOverlaps` | GET | yes |
| `/api/ForecastDiscountBands` | GET | yes |
| `/api/OptimiserRule` | GET, DELETE | GET only |
| `/api/Recommendations` | GET, POST, PUT | GET only |
| `/api/Blacklist` | GET, DELETE | GET only |
| `/api/forecast` | GET, POST, PUT, DELETE | GET only |
| `/api/gridmaintenance` | GET, POST, PUT | GET only |
| `/api/ReOptimise` | POST | **no — starts a job** |
| `/api/ReOptimise/HasHeadroomBudgets` | GET | yes — read-only |
| `/api/ReOptimise/Status` | GET | yes — read-only |
| `/api/BulkOverrideFlags` | GET, POST | GET only (POST writes flags) |

`/api/ReOptimise` and `/api/BulkOverrideFlags` are **verb-split**: POST performs
the job, GET on the same path or a sub-route is read-only progress polling. So
loading these pages and changing their filters is safe — only the on-screen
action button writes.

## Reference data in this environment

- **20 channels.** Channel 7, 7TWO, 7mate, 7Bravo, 7flix, 7food, ESPN, ESPN2,
  AFL7, Racing.com, plus SA aggregate channels.
- **64 markets**, hierarchical: `5 City Metro` (Sydney, Melbourne, Brisbane,
  Adelaide, Perth) and `Regional`, which nests further into aggregates such as
  `Victoria Agg` -> `Vic Ex Albury` -> Ballarat, Bendigo, Gippsland, Shepparton.
  `entityType` decides what is queryable: **0 = market** and **2 = aggregate**
  both work; **3 and 4 are UI grouping headers** (`5 City Metro`, `Regional`) and
  the API correctly 404s them.
  Codes used by the suite: `SYD` 1, `MEL` 2, `BRI` 3, `ADE` 4, `PER` 5,
  `Metro` 7, `VIC` 29, `SUN` 50 (Sunshine Coast), `WID` 51 (Wide Bay), `REGNL` 73.
- **Aggregates are not sums of their children.** Capacity is identical at every
  level and a child's `paid` can exceed its parent's. Do not write roll-up
  assertions until charter EX-02 answers what an aggregate represents.
- **6 demand flags**, least to most discountable:
  RED 35%, ORANGE 50%, YELLOW 60%, GREEN 70%, PURPLE 80%, BLUE 100%.
- **8 zones**, **318 programme groups**, **79 forecasts**.
- UI vocabulary is configurable: this deployment says "Channel" and "Market"
  (the API still calls the latter `station`).

## Data vintage

The footer states it, and it matters for any test that asserts on figures:

```
Latest snapshot: 18/05/2026   Imported on: 24/06/2026
Last full re-optimise: 15/07/2026 6:48
Last partial re-optimise: 14/07/2026 11:18
```

The snapshot is months behind the current date, but that does **not** mean the
current week is empty — coverage varies by endpoint and by time window:

| Week (Sun) | ProgramInventory | AboveBelowForecast | Recommendations |
|---|---|---|---|
| 2026-05-17 | 200 | 404 | 200 |
| 2026-06-21 | 200 | **200** | 200 |
| 2026-07-19 | 200 | **200** | 200 |
| 2026-08-23 (current) | 200 | 404 | 200 |
| 2026-09-20 | 200 | 404 | 200 |

Two things follow, and both bite if you miss them:

1. **The time window matters as much as the week.** `/api/Recommendations`
   returns 404 for 1800–2230 but 200 for 0600–2359 in the same week. A test that
   inherits the default evening window can look like "no data" when the data is
   simply outside the window.
2. **Use a known-rich week when you need populated rows.** `DATA_RICH_WEEK` in
   `src/data/focus.ts` points at 2026-06-21 for exactly this. Reserve
   "current week" for tests about *defaults*, not about *content*.
3. **A filter can hide everything.** On Recommendations the *Recommendations*
   dropdown defaults to "Any Change" (`changeStatus=2`), which matches no rows
   for a typical single week — 99 recommendations existed for the current week
   while the grid showed nothing. Set it to "All" (`changeStatus=0`) or widen the
   date range. This is FOCUS-KI-004, not a quirk of the test data.

"No rows" on a Focus page has at least four distinct causes, and they look
identical on screen:

| Cause | How to tell |
|---|---|
| Genuinely no data for that week | try `DATA_RICH_WEEK` |
| Time window too narrow | widen to 0600–2359 |
| A filter excluding everything | check *Recommendations* / *Optimisation Type* |
| The request 404'd (FOCUS-KI-001) | console error, or check the network tab |
