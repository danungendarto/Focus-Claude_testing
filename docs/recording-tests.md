# Recording tests against Focus

Two ways to record, plus the bit that matters most: **what to do with the output
afterwards.** Recorded steps should not be committed as-is in this project, for
reasons that are specific to Focus rather than a matter of taste — see
[Why recordings need converting](#why-recordings-need-converting).

## In VS Code

The Playwright extension puts its controls at the bottom of the **Testing**
sidebar (the flask icon in the activity bar):

| Control | What it does |
|---|---|
| **Record new** | Opens a browser and writes your actions into a brand-new spec file |
| **Record at cursor** | Appends your actions into the test you already have open, at the cursor |
| **Pick locator** | Hover any element and it hands you a locator — no recording involved |
| **Reveal test output** | The run log |
| **Close all browsers** | Cleanup when a recording browser is left open |

**Record at cursor is usually the better one here.** You can arrange state with
the page objects first, then record only the interaction you don't yet know how
to express:

```ts
test('scratch', async ({ inventorySummary }) => {
  await inventorySummary.open();
  await inventorySummary.setMarketIds([1]);
  // put the cursor here, then click "Record at cursor"
});
```

**Pick locator is the most useful control in this codebase.** Kendo's DOM is
deep and generated, so hovering an element to get a working locator saves far
more time than recording a click sequence does.

## From the terminal

```bash
npm run codegen
```

That opens Focus at the base URL with `--viewport-size=1600,1000`, matching
`playwright.config.ts`. The viewport is not cosmetic: Kendo grids virtualise
columns at narrower widths, so a recording made in a small window can produce
steps that don't reproduce at the suite's size.

For a specific page:

```bash
npx playwright codegen --viewport-size=1600,1000 http://vst-focus-seven/Recommendations
```

## Why recordings need converting

Focus's filter controls have **no accessible name** — no `aria-label`, no
associated `<label>`. Measured on Inventory Summary:

| Control | Widget | What identifies it |
|---|---|---|
| Summary By | DropDownList | `role="combobox"`, no name |
| Channel | MultiSelectTree | `role="combobox"`, no name |
| Start Time | ComboBox | placeholder `"Select start time..."` |

So codegen has nothing stable to hang a locator on and falls back to **position**:

```ts
// what codegen produces
await page.getByRole('combobox').nth(3).click();
await page.getByRole('option', { name: 'Week' }).click();
```

That passes today and breaks silently the moment anyone reorders a filter row —
and it breaks by selecting *the wrong filter*, which is worse than failing.

The suite's version says what it means:

```ts
// what to commit
await inventorySummary.setSummaryBy('Week');
```

`setSummaryBy` resolves the widget by its stable id (`pir-filter-SummaryType`),
finds the Kendo wrapper, opens it and waits for the refetch. Position-independent
and readable.

### Worse than positional: the GUID checkboxes

Multi-select trees — **Channel**, **Market**, **Day of Week** — are the pickers
you will most often want to record, and they produce the least usable output of
anything in Focus. Codegen writes their checkboxes as raw generated ids:

```ts
// what codegen produces for "select market SUN"
await page.locator('[id="_ccc8c054-b5a1-4288-818e-87eae843656d"]').uncheck();
await page.locator('[id="_ef9b9dd3-9469-4fd3-ac10-111df5c75049"]').check();
```

**Kendo regenerates every one of those ids on every page load.** Measured on
`/ReOptimise`: 91 such checkboxes, and across two recordings minutes apart, not
one id was repeated. Reloading and re-checking the four ids from a recording
found **zero** of them still present.

So this is not "brittle" in the usual sense — it fails on the very next run,
every time, at the first market click. There is no version of this worth keeping.

The replacements:

```ts
// arrange by id -- fast, stable, for setup you are not testing
await reOptimise.setMarketIds([50, 51]);          // SUN, WID

// or drive the real UI by visible text, when the interaction IS the test
await reOptimise.selectMarkets(['SUN', 'WID']);
```

Same for days: `setDayIds([1, 2, 8])` or `dayMask('Monday','Tuesday','Thursday')`,
which is the bitmask Focus actually sends (`dayOfWeekId=11`).

### Date pickers: type, don't drill

Recorded calendar navigation is fragile twice over:

```ts
// recorded: August 2026 -> 2026 -> May -> 31
await page.getByRole('button', { name: 'August 2026' }).click();
await expect(page.getByRole('grid', { name: '2026' })).toBeVisible();  // <- fails
await page.getByRole('link', { name: 'May' }).click();
```

1. `getByRole('grid', { name: '2026' })` matched **two** tables mid-transition
   (the year view and the month view), a strict-mode violation.
2. The steps only make sense while today's date is in August 2026. Next month
   the navigation path is different and the recording is meaningless.

Type the date instead — `setDateRange('31/05/2026', '06/06/2026')` fills the
picker directly and is independent of both.

### The conversion checklist

1. **Replace positional locators** (`.nth(3)`) **and generated-id locators**
   (`[id="_ccc8c054-..."]`) with a page-object method. If one doesn't exist, add
   it to `src/pages/` rather than inlining a selector in the spec.
2. **Replace `page.locator('#some-id').click()` on a filter** with the Kendo
   helpers — codegen often targets the *original* `<input>`, which Kendo hides
   for ComboBox, DropDownList and DropDownTree. Clicking it fails with
   "element is not visible".
3. **Delete any `waitForTimeout`.** Use `waitForPageReady` or `waitForGrid`.
4. **Assert on widget state**, not rendered rows — `readGrid` / `readGridRows`
   read the Kendo datasource; the DOM is virtualised and misreports totals.
5. **Replace calendar drilling** with `setDateRange('dd/MM/yyyy', ...)`.
6. **Replace value-derived locators.** Codegen writes the picker's *current*
   value into the locator — `getByRole('combobox', { description: 'Manual' })`.
   The moment the test changes it to "Both", that locator no longer matches, and
   Focus persists filters in localStorage so the second run starts wrong too.
7. **Use `DATA_RICH_WEEK`** if the test needs populated rows.
8. **Rename the test.** Codegen calls everything `test('test')`.

### Never leave a raw recording in `tests/`

The VS Code extension's **Record new** writes to `tests/test-1.spec.ts` (then
`test-2`, …). Those files are picked up by `npm test` like any other spec, so a
raw recording left in place fails the suite for reasons that have nothing to do
with the app.

That is not hypothetical — a Recommendations recording left in `tests/` turned
the suite red on its calendar step (see [above](#date-pickers-type-dont-drill)),
which cost time to trace back to a stray file rather than a real regression.

So: convert it, or delete it. `npm run codegen:save` writes to `test-results/`
instead, which is gitignored and outside `testDir`:

```bash
npm run codegen:save -- http://vst-focus-seven/ReOptimise
```

### Recording still earns its place

Use it for **discovery**, not production code:

- finding what a Kendo popup's DOM actually looks like
- confirming which control a click lands on
- capturing an exploratory-testing repro quickly, before you lose it

Then rewrite it. A recorded script is a note about what happened, not a test.

## A side finding

That missing accessible name is itself worth logging. Controls with
`role="combobox"` and no name are hard for screen-reader users and hard for
tooling alike. It is covered by charter **EX-11** in
[`exploratory-charters.md`](exploratory-charters.md) — and the fact that codegen
cannot name these controls is concrete evidence for that charter, not just a
testing inconvenience.
