/**
 * Helpers for driving the Kendo UI widgets Focus is built from.
 *
 * Two deliberate styles live here:
 *
 *  - `act*` / `open*` functions drive the REAL UI (clicks, typing). Use these
 *    when the interaction itself is what you are testing.
 *  - `read*` / `set*` functions talk to the Kendo widget API through
 *    page.evaluate. Use these to ARRANGE state quickly, and to ASSERT on what
 *    the widget actually holds rather than on rendered pixels.
 *
 * Mixing them is intentional: drive what you are testing, shortcut what you
 * are not. A test that spends forty clicks setting up filters it does not care
 * about is a test that fails for reasons it does not care about either.
 */
import { expect, type Page, type Locator } from '@playwright/test';

/** Kendo popups render at the end of <body>, not next to their input. */
const ANIMATION_CONTAINER = '.k-animation-container:visible';

/**
 * Kendo replaces the original <input> with a wrapper span and, for most widget
 * types, hides the original. Locating the wrapper is therefore the first step in
 * any real interaction.
 *
 * The wrapper class differs per widget -- k-combobox, k-dropdownlist,
 * k-datepicker, k-multiselecttree -- but all of them carry either `k-input` or
 * `k-picker`, so one selector covers every control on the page.
 */
export function kendoWrapper(page: Page, inputId: string): Locator {
  return page
    .locator('#' + inputId)
    .locator(
      'xpath=ancestor-or-self::span[contains(concat(" ",normalize-space(@class)," ")," k-input ")' +
        ' or contains(concat(" ",normalize-space(@class)," ")," k-picker ")][1]',
    );
}

/**
 * The visible text box inside a widget. ComboBox hides the original input and
 * renders its own; DatePicker reuses the original and gives it the same class,
 * so this resolves correctly for both.
 */
export function kendoVisibleInput(page: Page, inputId: string): Locator {
  return kendoWrapper(page, inputId).locator('input.k-input-inner');
}

/* ------------------------------------------------------------------ *
 * Page-level readiness
 * ------------------------------------------------------------------ */

/**
 * Focus tracks its own in-flight state in a hidden input. Waiting on that is
 * far more reliable than networkidle, because Kendo charts keep sockets warm.
 */
export async function waitForFocusIdle(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>('#is-loading')?.value === 'false',
    undefined,
    { timeout },
  );
}

/** Waits until jQuery reports no outstanding AJAX requests. */
export async function waitForAjaxIdle(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const jq = (window as any).jQuery;
      return !!jq && jq.active === 0;
    },
    undefined,
    { timeout },
  );
}

/** The combination Focus pages actually need before assertions are meaningful. */
export async function waitForPageReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await waitForAjaxIdle(page, timeout);
  await waitForFocusIdle(page, timeout);
}

/* ------------------------------------------------------------------ *
 * Grid
 * ------------------------------------------------------------------ */

export interface GridState {
  exists: boolean;
  /** Total rows the datasource reports, across all pages. */
  total: number;
  /** Rows currently materialised in the view. */
  visible: number;
  columns: string[];
  hasNoRecordsMessage: boolean;
}

/** Reads a Kendo grid's real state rather than scraping its DOM. */
export async function readGrid(page: Page, gridId: string): Promise<GridState> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const grid = jq('#' + id).data('kendoGrid');
    if (!grid) {
      return { exists: false, total: 0, visible: 0, columns: [], hasNoRecordsMessage: false };
    }
    return {
      exists: true,
      total: grid.dataSource.total(),
      visible: grid.dataSource.view().length,
      columns: grid.columns.map((c: any) => c.title || c.field || ''),
      hasNoRecordsMessage: jq('#' + id).find('.k-grid-norecords').length > 0,
    };
  }, gridId);
}

/** Returns the grid's rows as plain objects, straight from the datasource. */
export async function readGridRows<T = Record<string, unknown>>(
  page: Page,
  gridId: string,
  limit = 100,
): Promise<T[]> {
  return page.evaluate(
    ({ id, max }) => {
      const jq = (window as any).jQuery;
      const grid = jq('#' + id).data('kendoGrid');
      if (!grid) return [];
      return grid.dataSource
        .view()
        .slice(0, max)
        .map((r: any) => (typeof r.toJSON === 'function' ? r.toJSON() : r));
    },
    { id: gridId, max: limit },
  );
}

/** Waits for a grid to exist and finish its current fetch. */
export async function waitForGrid(page: Page, gridId: string, timeout = 30_000): Promise<void> {
  await page.locator('#' + gridId).waitFor({ state: 'attached', timeout });
  await page.waitForFunction(
    (id) => {
      const jq = (window as any).jQuery;
      const grid = jq('#' + id).data('kendoGrid');
      return !!grid && !grid.dataSource.options?.__loading;
    },
    gridId,
    { timeout },
  );
  await waitForAjaxIdle(page, timeout);
}

/**
 * Clicks a grid column header to sort by it, then waits for the refresh.
 *
 * Focus's grids render headers as `span.k-link > span.k-column-title`, not the
 * `a.k-link` older Kendo versions used.
 *
 * `columnTitle` must be a LEAF column. Grids like Recommendations use grouped
 * headers, where the top row ("Program", "Bookings", "Rate") spans the real
 * columns beneath it and is not sortable — clicking one does nothing. Pass the
 * leaf title ("Title", "Market", "Week") instead.
 */
export async function sortGridBy(page: Page, gridId: string, columnTitle: string): Promise<void> {
  // Exact match: "Forecast" would otherwise also hit "Forecast Fill %".
  const exact = new RegExp(`^\\s*${escapeRegExp(columnTitle)}\\s*$`);
  const header = page
    .locator(`#${gridId} .k-grid-header .k-column-title`)
    .filter({ hasText: exact })
    .first();

  await header.click();
  await waitForAjaxIdle(page);
}

/** Leaf (sortable) column titles, in grid order. Grouped headers are excluded. */
export async function readGridLeafColumns(page: Page, gridId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const grid = jq('#' + id).data('kendoGrid');
    if (!grid) return [];
    const out: string[] = [];
    const walk = (cols: any[]) =>
      cols.forEach((c) => (c.columns ? walk(c.columns) : out.push(String(c.title ?? c.field ?? ''))));
    walk(grid.columns);
    // Titles may carry markup such as "Ttl<br/>Avail".
    return out.map((t) => t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  }, gridId);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * DropDownTree (Channel / Market / Day-of-week multi-pickers)
 * ------------------------------------------------------------------ */

/**
 * Selects items in a Kendo DropDownTree by their visible text.
 *
 * These are the Channel, Market and Day-of-Week pickers. They are checkbox
 * trees inside a popup, and selecting a parent cascades to its children --
 * which is exactly the behaviour worth testing, so this drives real clicks.
 */
export async function selectInDropDownTree(
  page: Page,
  inputId: string,
  labels: string[],
): Promise<void> {
  await openDropDownTree(page, inputId);
  const popup = page.locator(ANIMATION_CONTAINER).last();

  for (const label of labels) {
    const node = popup.locator('.k-treeview-leaf, .k-in', { hasText: label }).first();
    await node.scrollIntoViewIfNeeded();
    const checkbox = node.locator('xpath=preceding-sibling::input[@type="checkbox"][1]');
    if (await checkbox.count()) {
      await checkbox.check();
    } else {
      await node.click();
    }
  }

  await closeDropDownTree(page, inputId);
  await waitForAjaxIdle(page);
}

export async function openDropDownTree(page: Page, inputId: string): Promise<void> {
  // Focus renders these as k-multiselecttree; the whole wrapper is the picker,
  // and the arrow button is not always present, so click the wrapper itself.
  await kendoWrapper(page, inputId).click();
  await page.locator(ANIMATION_CONTAINER).last().waitFor({ state: 'visible' });
}

export async function closeDropDownTree(page: Page, inputId: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator(`#${inputId}`).waitFor({ state: 'attached' });
}

/** The value a DropDownTree currently holds, as reported by the widget. */
export async function readDropDownTreeValue(page: Page, inputId: string): Promise<unknown> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const w = jq('#' + id).data('kendoDropDownTree');
    return w ? w.value() : null;
  }, inputId);
}

/** Sets a DropDownTree straight through the widget API. For arrange steps only. */
export async function setDropDownTreeValue(page: Page, inputId: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ id, v }) => {
      const jq = (window as any).jQuery;
      const w = jq('#' + id).data('kendoDropDownTree');
      if (!w) throw new Error('No kendoDropDownTree on #' + id);
      w.value(v);
      w.trigger('change');
    },
    { id: inputId, v: value },
  );
  await waitForAjaxIdle(page);
}

/* ------------------------------------------------------------------ *
 * DatePicker / ComboBox / DropDownList
 * ------------------------------------------------------------------ */

/** Types a date into a Kendo DatePicker. `value` must be dd/MM/yyyy. */
export async function setDatePicker(page: Page, inputId: string, value: string): Promise<void> {
  await typeIntoWidget(page, inputId, value);
}

export async function readDatePicker(page: Page, inputId: string): Promise<string> {
  return kendoVisibleInput(page, inputId).inputValue();
}

/** Sets a Kendo ComboBox (the time-range controls) by typing. */
export async function setComboBox(page: Page, inputId: string, value: string): Promise<void> {
  await typeIntoWidget(page, inputId, value);
}

/**
 * Types into whichever input the widget actually shows, then commits with Enter.
 *
 * Blur alone is not enough: Kendo commits a ComboBox on Enter and would
 * otherwise revert to the last valid value, which looks like the app silently
 * ignoring the change.
 */
async function typeIntoWidget(page: Page, inputId: string, value: string): Promise<void> {
  const input = kendoVisibleInput(page, inputId);
  await input.click();
  await input.press('Control+a');
  await input.fill(value);
  await input.press('Enter');
  await waitForAjaxIdle(page);
}

export async function readComboBox(page: Page, inputId: string): Promise<string> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const w = jq('#' + id).data('kendoComboBox');
    return w ? String(w.value()) : jq('#' + id).val();
  }, inputId);
}

/** Selects an option in a Kendo DropDownList by its visible text. */
export async function selectDropDownList(page: Page, inputId: string, text: string): Promise<void> {
  // A DropDownList has no inner text box; the wrapper span is the control.
  await kendoWrapper(page, inputId).click();
  const popup = page.locator(ANIMATION_CONTAINER).last();
  await popup.locator('li.k-list-item', { hasText: text }).first().click();
  await waitForAjaxIdle(page);
}

/** The options a DropDownList currently offers, in order. */
export async function readDropDownListOptions(page: Page, inputId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const w = jq('#' + id).data('kendoDropDownList');
    if (!w) return [];
    const textField = w.options.dataTextField;
    return w.dataSource.data().map((d: any) =>
      String(textField && d[textField] != null ? d[textField] : d),
    );
  }, inputId);
}

export async function readDropDownList(page: Page, inputId: string): Promise<string> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const w = jq('#' + id).data('kendoDropDownList');
    return w ? String(w.text()) : '';
  }, inputId);
}

/* ------------------------------------------------------------------ *
 * Charts and widget introspection
 * ------------------------------------------------------------------ */

export async function chartExists(page: Page, chartId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    return !!jq('#' + id).data('kendoChart');
  }, chartId);
}

/** Number of series the chart is actually plotting. */
export async function readChartSeriesCount(page: Page, chartId: string): Promise<number> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const chart = jq('#' + id).data('kendoChart');
    return chart ? (chart.options.series?.length ?? 0) : 0;
  }, chartId);
}

/** Which Kendo widget, if any, is bound to an element. Useful when exploring. */
export async function widgetTypeOf(page: Page, elementId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const jq = (window as any).jQuery;
    const data = jq('#' + id).data() || {};
    return Object.keys(data).filter((k) => k.startsWith('kendo'));
  }, elementId);
}

/* ------------------------------------------------------------------ *
 * Error surfaces
 * ------------------------------------------------------------------ */

/**
 * Focus renders server/validation errors into a hidden `#errorMessages` block.
 * Returns the messages currently shown, or an empty array when the block is
 * hidden. Assert this is empty on happy paths -- Focus does not throw, it
 * quietly reveals a div, so a silently-failing page otherwise looks fine.
 */
export async function readErrorMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('#errorMessages');
    if (!box || box.offsetParent === null) return [];
    return Array.from(box.querySelectorAll('li, p, div'))
      .map((n) => (n.textContent || '').trim())
      .filter((t) => t.length > 0);
  });
}

export async function expectNoErrors(page: Page): Promise<void> {
  expect(await readErrorMessages(page)).toEqual([]);
}

/** The Kendo notification toasts Focus uses for warnings. */
export function notifications(page: Page): Locator {
  return page.locator('.k-notification-content');
}
