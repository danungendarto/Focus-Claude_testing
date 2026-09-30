import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import {
  readGrid, readGridRows, waitForGrid, sortGridBy,
  selectInDropDownTree, setDropDownTreeValue, readDropDownTreeValue,
  setDatePicker, readDatePicker, setComboBox, readComboBox,
  selectDropDownList, readDropDownList, chartExists, type GridState,
} from '../kendo/kendo';
import type { RouteKey } from '../data/focus';

/**
 * The five report pages share one layout: a `#filters-container` of Kendo
 * pickers, a `<prefix>-report-grid`, a `<prefix>-report-chart`, and an Export
 * button. Only the id prefix and which filters exist actually differ.
 *
 * Subclasses declare their prefix and route; anything page-specific is added
 * there rather than special-cased here.
 */
export class ReportPage extends BasePage {
  constructor(
    page: Page,
    protected readonly prefix: string,
    protected readonly route: RouteKey,
  ) {
    super(page);
  }

  async open(): Promise<this> {
    await this.goto(this.route);
    return this;
  }

  /* -- element ids ------------------------------------------------ */

  protected id(suffix: string): string {
    return `${this.prefix}-${suffix}`;
  }

  get gridId(): string {
    return `${this.prefix}-report-grid`;
  }

  get chartId(): string {
    return `${this.prefix}-report-chart`;
  }

  /* -- locators --------------------------------------------------- */

  get filtersContainer(): Locator {
    return this.page.locator('#filters-container, .filters-container').first();
  }

  get grid(): Locator {
    return this.page.locator('#' + this.gridId);
  }

  get chart(): Locator {
    return this.page.locator('#' + this.chartId);
  }

  get exportButton(): Locator {
    return this.page.locator('#' + this.id('filter-Export'));
  }

  /* -- grid ------------------------------------------------------- */

  async waitForGrid(timeout = 30_000): Promise<void> {
    await waitForGrid(this.page, this.gridId, timeout);
  }

  async gridState(): Promise<GridState> {
    return readGrid(this.page, this.gridId);
  }

  async rows<T = Record<string, unknown>>(limit = 100): Promise<T[]> {
    return readGridRows<T>(this.page, this.gridId, limit);
  }

  async sortBy(columnTitle: string): Promise<void> {
    await sortGridBy(this.page, this.gridId, columnTitle);
  }

  async hasChart(): Promise<boolean> {
    return chartExists(this.page, this.chartId);
  }

  /* -- filters ---------------------------------------------------- */
  /* Not every report has every filter; call only what the page renders. */

  async selectChannels(codes: string[]): Promise<void> {
    await selectInDropDownTree(this.page, this.id('filter-MultiChannel'), codes);
  }

  async selectMarkets(codes: string[]): Promise<void> {
    await selectInDropDownTree(this.page, this.id('filter-MultiStation'), codes);
  }

  async selectDays(days: string[]): Promise<void> {
    await selectInDropDownTree(this.page, this.id('filter-DayOfWeekMulti'), days);
  }

  /** Arrange-only shortcut that sets channels by id through the widget API. */
  async setChannelIds(ids: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, this.id('filter-MultiChannel'), ids);
  }

  async setMarketIds(ids: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, this.id('filter-MultiStation'), ids);
  }

  /**
   * Arrange-only shortcut for the Day of Week tree. Values are the day bits
   * (Monday 1 ... Sunday 64); the page ORs them into `dayOfWeekId`.
   */
  async setDayMask(bits: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, this.id('filter-DayOfWeekMulti'), bits);
  }

  async selectedChannelValue(): Promise<unknown> {
    return readDropDownTreeValue(this.page, this.id('filter-MultiChannel'));
  }

  /** Dates are dd/MM/yyyy, matching what Focus renders. */
  async setDateRange(startDdMmYyyy: string, endDdMmYyyy: string): Promise<void> {
    await setDatePicker(this.page, this.id('filter-WeekStart'), startDdMmYyyy);
    await setDatePicker(this.page, this.id('filter-WeekEnd'), endDdMmYyyy);
  }

  async dateRange(): Promise<{ start: string; end: string }> {
    return {
      start: await readDatePicker(this.page, this.id('filter-WeekStart')),
      end: await readDatePicker(this.page, this.id('filter-WeekEnd')),
    };
  }

  /** Times are HHmm strings, e.g. "1800". */
  async setTimeRange(start: string, end: string): Promise<void> {
    await setComboBox(this.page, this.id('filter-StartTime'), start);
    await setComboBox(this.page, this.id('filter-EndTime'), end);
  }

  async timeRange(): Promise<{ start: string; end: string }> {
    return {
      start: await readComboBox(this.page, this.id('filter-StartTime')),
      end: await readComboBox(this.page, this.id('filter-EndTime')),
    };
  }

  async setSummaryBy(text: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-SummaryType'), text);
  }

  /* -- export ----------------------------------------------------- */

  /**
   * Clicks Export and returns the download. Export is read-only: it renders
   * the current grid, it does not write to the server.
   */
  async export() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60_000 }),
      this.exportButton.click(),
    ]);
    return download;
  }
}

/* ------------------------------------------------------------------ *
 * Concrete report pages
 * ------------------------------------------------------------------ */

export class InventorySummaryPage extends ReportPage {
  constructor(page: Page) {
    super(page, 'pir', 'inventorySummary');
  }

  /** This page carries a second chart below the grid: Inventory Booking Pace. */
  get paceChart(): Locator {
    return this.page.locator('#pir-report-chart');
  }
}

export class BookingPaceSummaryPage extends ReportPage {
  constructor(page: Page) {
    super(page, 'bps', 'bookingPaceSummary');
  }
}

export class AboveBelowForecastPage extends ReportPage {
  constructor(page: Page) {
    super(page, 'abf', 'aboveBelowForecast');
  }
}

/**
 * Booking / Discount Pace uses single-select Channel and Station pickers and a
 * single Week picker rather than the multi-pickers and date range.
 */
export class BookingDiscountPacePage extends ReportPage {
  constructor(page: Page) {
    super(page, 'bdp', 'bookingDiscountPace');
  }

  async selectChannel(text: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-Channel'), text);
  }

  async selectStation(text: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-Station'), text);
  }

  async setWeek(ddMmYyyy: string): Promise<void> {
    await setDatePicker(this.page, this.id('filter-Week'), ddMmYyyy);
  }
}

/**
 * Program vs. Forecast charts one programme's paid fill against forecast
 * curves, by weeks prior to air. Its filters differ from the other reports:
 *
 * - Channel and Day of Week are single-select DropDownLists, Market a
 *   DropDownTree, and there is one Week picker rather than a date range.
 * - Day of Week bits start at **Sunday = 1** (Monday = 2 ... Saturday = 64),
 *   unlike the multi-select day trees elsewhere, where Monday = 1.
 * - The Program list is reloaded (`/api/program/`) when the week or day
 *   changes, and its ids are per week, so pick the day before the programme.
 */
export class ProgramVsForecastPage extends ReportPage {
  constructor(page: Page) {
    super(page, 'pvf', 'programVsForecast');
  }

  get currentForecastDescription(): Locator {
    return this.page.locator('#pvf-currentForecast-description');
  }

  get currentForecastIsProgramSpecific(): Locator {
    return this.page.locator('#pvf-currentForecast-isProgrammeSpecific');
  }

  get currentForecastModifier(): Locator {
    return this.page.locator('#pvf-currentForecast-modifier');
  }

  get compareProgramSpecificCheckbox(): Locator {
    return this.page.locator('#pvf-filter-CompareWithProgrammeSpecific');
  }

  async selectChannel(code: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-Channel'), code);
  }

  /** Arrange-only shortcut: sets the single-market tree by id. */
  async setStationId(id: number): Promise<void> {
    await setDropDownTreeValue(this.page, this.id('filter-Station'), id);
  }

  /** The Sunday that starts the week, dd/MM/yyyy. */
  async setWeek(ddMmYyyy: string): Promise<void> {
    await setDatePicker(this.page, this.id('filter-Week'), ddMmYyyy);
  }

  async week(): Promise<string> {
    return readDatePicker(this.page, this.id('filter-Week'));
  }

  /** Full day name, e.g. "Monday". */
  async selectDay(day: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-DayOfWeek'), day);
  }

  /** As the list shows it, e.g. "1800: Seven News". */
  async selectProgramme(text: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-Programme'), text);
  }

  async selectedProgramme(): Promise<string> {
    return readDropDownList(this.page, this.id('filter-Programme'));
  }

  /**
   * Forecast descriptions are stored with irregular spacing
   * ("7MAIN:  1800 NEWS"), so pass the text exactly as the widget holds it.
   */
  async selectCompareForecast(text: string): Promise<void> {
    await selectDropDownList(this.page, this.id('filter-CompareWithForecast'), text);
  }

  async setCompareProgramSpecific(on: boolean): Promise<void> {
    await this.compareProgramSpecificCheckbox.setChecked(on);
  }
}
