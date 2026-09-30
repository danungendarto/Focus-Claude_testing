# Focus — test suite

Playwright suite and exploratory-testing workspace for **Focus**
(`http://vst-focus-seven/`), a broadcast-TV advertising yield and inventory
optimisation system.

## Quick start

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` runs the full default suite: 73 specs, about 100 seconds. Nothing in
it writes to the server.

## Commands

```bash
npm test               # everything read-only (the default)
npm run test:smoke     # all 13 routes load, navigation works
npm run test:api       # API contract, no browser -- fastest signal
npm run test:reports   # report pages: filters, grids, charts, export
npm run test:integrity # business-rule invariants on the figures
npm run test:headed    # watch it run
npm run test:ui        # Playwright's interactive UI mode
npm run typecheck      # tsc --noEmit (also runs before npm test)
npm run report         # open the last HTML report
npm run codegen        # record against Focus (see docs/recording-tests.md)
npm run axosoft:verify # read-only check of the Axosoft connection
```

Point at another environment with `FOCUS_BASE_URL`:

```bash
FOCUS_BASE_URL=http://some-other-focus npm test
```

## Tests that write to the server

Re-optimise, bulk override, rule creation and sending recommendations all change
server state. They are tagged `@destructive`, excluded from the default project,
**and** gated behind an environment variable:

```bash
FOCUS_ALLOW_DESTRUCTIVE=1 npm run test:destructive
```

Read [`docs/write-surface.md`](docs/write-surface.md) first. Focus has no undo,
and two of its writes have no visible trigger at all — opening a recommendation
marks it inspected, and the Recommendations grid saves cells as you edit them.

## Filing defects into Axosoft

A reporter can raise Axosoft defects automatically for unexpected failures. It is
**dry-run by default** and silent unless configured, so it does not affect local
runs. Deduplication, a mass-failure circuit breaker, and known-issue exclusions
are what make it survivable — see
[`docs/axosoft-integration.md`](docs/axosoft-integration.md).

```bash
cp .env.example .env     # AXOSOFT_URL, client id/secret, login, project id
npm run axosoft:verify   # read-only: checks auth, ids, and search
npm test                 # dry run: prints what it would file
```

No API key yet? Every failing run still writes
`test-results/axosoft-defects.md` — paste-ready defect drafts, complete with the
fingerprint marker so later automated runs recognise them instead of filing
duplicates.

## Layout

```
src/
  data/focus.ts         routes, channels, markets, flags, API query contract
  data/known-issues.ts  register of open defects
  kendo/kendo.ts        helpers for driving Kendo widgets and reading their state
  pages/                page objects, one per page family
  fixtures.ts           test fixtures + automatic browser-error detection
  reporting/            Axosoft defect filing (reporter + API client)
tests/
  smoke/                every route loads; navigation works
  api/                  API contract and input handling
  reports/              report page behaviour
  integrity/            business-rule invariants on the numbers
  known-issues/         specs pinning known defects (see below)
  destructive/          excluded by default; writes to the server
scripts/
  verify-axosoft.mjs    read-only Axosoft connectivity check
docs/
  app-map.md            what Focus is, its routes, widgets and API
  write-surface.md      what writes, what only looks like it does  <- read first
  findings.md           defects found, with reproductions
  test-strategy.md      what is covered, what is not, and why
  recording-tests.md    codegen/VS Code recording, and converting the output
  exploratory-charters.md  session charters for manual testing
  axosoft-integration.md   automatic defect filing
```

## How known defects are handled

Five open defects were found while building this suite (see
[`docs/findings.md`](docs/findings.md)). Rather than deleting the tests or
letting the build stay red, each is:

1. registered in `src/data/known-issues.ts`,
2. pinned by a spec in `tests/known-issues/` that asserts the **correct**
   behaviour and calls `test.fail()`.

So the suite is green while the bug exists, and the moment it is fixed Playwright
reports an *unexpected pass* — the prompt to delete the entry. The assertion
doubles as the acceptance criteria for the fix.

Registration is separate from suppression: only issues with a `suppress` pattern
are downgraded in the generic "no browser errors" check, and even then they are
attached to the report as annotations. Nothing indicating a crash or data loss is
ever suppressed — a 500 always turns a test red.

## Writing tests here

**Use the page objects.** `src/pages/` knows the id prefix of every page and the
right way to drive each Kendo widget.

**Drive what you are testing; shortcut what you are not.** `src/kendo/kendo.ts`
offers both: `selectInDropDownTree` clicks through the real popup, while
`setDropDownTreeValue` sets it through the widget API. Use the first when the
interaction is the thing under test, the second to arrange state.

**Wait on Focus's own idle signal**, not `networkidle`. `waitForPageReady`
combines jQuery's active-request count with Focus's `#is-loading` flag.

**Assert on widget state, not pixels.** `readGrid` and `readGridRows` return what
the Kendo datasource actually holds, which is both more stable and more precise
than scraping the DOM.

**Use `DATA_RICH_WEEK` when a test needs rows.** Data coverage varies by week and
by time window; the current week is fine for testing defaults but not content.
