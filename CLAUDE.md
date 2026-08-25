# Focus test suite — working notes for Claude

This is a **testing** project, not an application project. We do not have the
Focus source; we test a running instance at `http://vst-focus-seven/`.
The user is a tester.

Read `docs/app-map.md` before doing anything non-trivial — it is the reference
for routes, widget types, the API query contract, and this environment's data.

## Safety rules — these matter more than anything else here

**Never trigger a write to Focus without the user explicitly asking.**

Focus has no undo. These actions change shared server state:

- Re-Optimise — rewrites recommendations for the selected scope
- Bulk Override Flags — writes flags across every selected program
- Creating, editing or deleting optimiser rules, forecasts, or blacklists
- Sending recommendations downstream

Two traps specific to this app:

1. **`/api/ReOptimise` and `/api/BulkOverrideFlags` are verb-split**: POST does
   the job, GET on the same path is read-only progress polling. GET is safe;
   never POST to them outside a `@destructive` spec. Check `MUTATING_API` in
   `src/data/focus.ts` before calling anything unfamiliar.
2. The destructive specs are double-gated (project grep + `FOCUS_ALLOW_DESTRUCTIVE=1`).
   Do not remove either gate, and do not run them unprompted.

When exploring, prefer GET on the read-only endpoints listed in `READ_API`,
or drive the UI without clicking a save/run/send/override control.

## Conventions

**Page objects, always.** `src/pages/` knows each page's id prefix. Don't put raw
`#pir-filter-...` selectors in a spec.

**Two interaction styles, on purpose.** `src/kendo/kendo.ts` provides real-click
helpers (`selectInDropDownTree`, `selectDropDownList`) and widget-API shortcuts
(`setDropDownTreeValue`). Drive the thing under test with real clicks; arrange
everything else with the shortcut.

**Never `waitForLoadState('networkidle')`.** Use `waitForPageReady`, which waits
on jQuery's active-request count plus Focus's `#is-loading` flag.

**Assert on widget state.** `readGrid`/`readGridRows` read the Kendo datasource.
Rendered rows are virtualised and misreport totals.


**Kendo hides the original `<input>`** for ComboBox, DropDownList and
DropDownTree. Use `kendoWrapper` / `kendoVisibleInput`, which resolve the nearest
`k-input`/`k-picker` ancestor generically. Don't hard-code widget class names.

**Use `DATA_RICH_WEEK` + `WIDE_TIME_WINDOW`** when a test needs populated rows.
Data coverage varies by week *and* by time window — the current week is fine for
testing defaults, not content.

## Handling a defect

Don't disable the test, and don't leave the build red. Instead:

1. Reproduce it at the API level if possible — it makes the report far stronger.
2. Add it to `docs/findings.md` with a copy-pasteable reproduction.
3. Register it in `src/data/known-issues.ts`. Add a `suppress` pattern **only**
   if it is noise on ordinary page loads. Never suppress a 500 or anything
   implying data loss.
4. Add a spec in `tests/known-issues/` asserting the **correct** behaviour, with
   `test.fail()` **inside the test body** (describe-level `test.fail` leaks to
   sibling tests — this has already bitten once).

That keeps the suite green while the bug exists, and Playwright reports an
unexpected pass the moment it is fixed.

## Don't guess an invariant

If it is unclear what a business rule should be, write a charter in
`docs/exploratory-charters.md` instead of an assertion. `averageNet` is the
worked example: its divisor is not the paid spot count and we don't yet know what
it is, so it is charter EX-04, not a test.

## Before saying the work is done

```bash
npm run typecheck && npm test
```

`noUnusedLocals` is on, so stray imports fail the typecheck.

## Recorded tests

Codegen output must be converted before committing, not pasted in. Focus's
filter controls have no accessible name, so codegen falls back to positional
locators (`getByRole('combobox').nth(3)`) which silently target the wrong
filter if a row is reordered. Convert to page-object calls; see
`docs/recording-tests.md` for the checklist.

## Axosoft defect filing

`src/reporting/` files unexpected failures into Axosoft. It is dry-run unless
`AXOSOFT_CREATE_DEFECTS=1`, and silent unless `AXOSOFT_URL` + `AXOSOFT_PROJECT_ID`
are set, so local runs are unaffected.

Do not weaken the noise controls — they are the reason it is usable:
known-issue specs and flaky-passes are never filed, an unexpected *pass* of a
`test.fail()` spec is reported as "bug fixed" rather than filed, failures are
deduplicated by a fingerprint of file+title, and a mass failure files ONE
run-wide defect instead of N.

Axosoft's API shape varies by version/install. Anything version-specific lives in
`src/reporting/axosoft-client.ts` behind `VERIFY:` comments. `npm run axosoft:verify`
is read-only and checks it. Never call the write paths to "test" the integration.

## Current state

- 88 specs in the default project. Nothing in it writes to the server.
- **The suite is not reliably green at 4 workers.** Roughly one UI spec per full
  run fails on a Kendo popup animation race: `selectDropDownList` clicks a
  `li.k-list-item` while the `.k-animation-container` is still sliding, and a
  sibling item intercepts the click. A different spec fails each run and every
  one passes in isolation, so it is the helper, not the specs. `retries` is 0
  locally. This pre-dates the EX-01 session (reproduced with those specs
  excluded) and is the next thing worth fixing in the suite itself.
- 7 open defects registered: KI-001 (empty results as 404), KI-002 (duplicate
  fetch on load), KI-003 (500 on unknown channelId), KI-004 (Recommendations
  shows an empty grid by default), KI-005 (Re-Optimise headroom safeguard is
  dead code from a property-name casing mismatch), KI-006 (InventoryBookingPace
  500s unless `itemDate` parses — including the contract default `itemDate=`),
  KI-007 (Inventory Summary and Recommendations disagree by 24% on available
  inventory). KI-005 and KI-007 are the two worth raising first: both are
  silent, and both affect what the optimiser prices.
- 14 exploratory charters (EX-00 … EX-13). EX-00 and EX-01 are done, EX-04 is
  answered and closed, EX-07 is mostly answered. EX-13 (same booked volume,
  11–15% different revenue between two reports) came out of EX-01 and is a
  product question, not yet a defect.
- Duration fields are **seconds**, not spot counts. `averageNet` is revenue over
  30-second-equivalent spots (`paid / 30`) — EX-04, verified on 601 rows.
- Destructive specs are gated. `reoptimise.spec.ts` is verified end-to-end —
  baseline via the API, run, then diff both in and out of scope. Three writes in
  `write-operations.spec.ts` are still `fixme`: bulk override, optimiser-rule
  create/delete, and sending recommendations.
