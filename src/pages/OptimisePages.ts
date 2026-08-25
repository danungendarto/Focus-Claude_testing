import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import {
  readGrid, readGridRows, waitForGrid, sortGridBy,
  selectDropDownList, readDropDownList, setDatePicker, readDatePicker,
  setComboBox, readComboBox, setDropDownTreeValue, readDropDownTreeValue,
  selectInDropDownTree,
  type GridState,
} from '../kendo/kendo';

/**
 * The Optimise and Recommendations pages. Several of these can write to the
 * server or start long-running jobs -- those methods are marked DESTRUCTIVE and
 * must only be called from specs tagged @destructive.
 */

export class OptimiserRulesPage extends BasePage {
  async open(): Promise<this> {
    await this.goto('optimiserRules');
    return this;
  }

  /** The page is a tabstrip: Default, Exception, Gaps/Overlaps, Schedule View. */
  get tabstrip(): Locator {
    return this.page.locator('#optimiser-tabstrip');
  }

  async selectTab(label: string): Promise<void> {
    await this.tabstrip.locator('.k-tabstrip-items .k-item', { hasText: label }).first().click();
    await this.waitUntilReady();
  }

  get defaultRulesGrid(): Locator {
    return this.page.locator('#optimiser-grid-default');
  }

  get exceptionRulesGrid(): Locator {
    return this.page.locator('#optimiser-grid-exception');
  }

  get gapsOverlapsGrid(): Locator {
    return this.page.locator('#optimiser-grid-gapsOverlaps');
  }

  get scheduler(): Locator {
    return this.page.locator('#optimiser-scheduler');
  }

  get addDefaultRuleButton(): Locator {
    return this.page.locator('#optimiser-add-default');
  }

  get editWindow(): Locator {
    return this.page.locator('#optimiser-edit-window');
  }

  async defaultRulesState(): Promise<GridState> {
    await waitForGrid(this.page, 'optimiser-grid-default');
    return readGrid(this.page, 'optimiser-grid-default');
  }

  async defaultRules<T = Record<string, unknown>>(limit = 100): Promise<T[]> {
    return readGridRows<T>(this.page, 'optimiser-grid-default', limit);
  }

  /**
   * Opens the rule editor without saving. Read-only as long as you close with
   * Cancel -- which `closeEditor` does.
   */
  async openAddRuleEditor(): Promise<void> {
    await this.addDefaultRuleButton.click();
    await this.editWindow.waitFor({ state: 'visible' });
  }

  async closeEditor(): Promise<void> {
    await this.page.locator('#optimiser-edit-Cancel').click();
    await this.editWindow.waitFor({ state: 'hidden' });
  }

  /** DESTRUCTIVE: writes an optimiser rule. @destructive specs only. */
  async saveEditor(): Promise<void> {
    await this.page.locator('#optimiser-edit-Ok').click();
    await this.waitUntilReady();
  }
}

export class ReOptimisePage extends BasePage {
  async open(): Promise<this> {
    await this.goto('reOptimise');
    return this;
  }

  get runButton(): Locator {
    return this.page.locator('#rop-button-reOptimise');
  }

  get progressBar(): Locator {
    return this.page.locator('#rop-progress-bar');
  }

  get headroomMessage(): Locator {
    return this.page.locator('#rop_headroomMessage');
  }

  /* -- filters -----------------------------------------------------
   * All read-only. Changing a filter fires GET /api/ReOptimise/HasHeadroomBudgets
   * and nothing else; only the Re-Optimise button POSTs.
   */

  async setChannelIds(ids: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, 'rop-filter-MultiChannel', ids);
  }

  async setMarketIds(ids: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, 'rop-filter-MultiStation', ids);
  }

  /** Day bits: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. */
  async setDayIds(bits: number[]): Promise<void> {
    await setDropDownTreeValue(this.page, 'rop-filter-DayOfWeekMulti', bits);
  }

  async selectChannels(codes: string[]): Promise<void> {
    await selectInDropDownTree(this.page, 'rop-filter-MultiChannel', codes);
  }

  async selectMarkets(codes: string[]): Promise<void> {
    await selectInDropDownTree(this.page, 'rop-filter-MultiStation', codes);
  }

  /** Dates are dd/MM/yyyy, matching what Focus renders. */
  async setDateRange(startDdMmYyyy: string, endDdMmYyyy: string): Promise<void> {
    await setDatePicker(this.page, 'rop-filter-WeekStart', startDdMmYyyy);
    await setDatePicker(this.page, 'rop-filter-WeekEnd', endDdMmYyyy);
  }

  async dateRange(): Promise<{ start: string; end: string }> {
    return {
      start: await readDatePicker(this.page, 'rop-filter-WeekStart'),
      end: await readDatePicker(this.page, 'rop-filter-WeekEnd'),
    };
  }

  /** Times are HHmm strings, e.g. "2000". */
  async setTimeRange(start: string, end: string): Promise<void> {
    await setComboBox(this.page, 'rop-filter-StartTime', start);
    await setComboBox(this.page, 'rop-filter-EndTime', end);
  }

  async timeRange(): Promise<{ start: string; end: string }> {
    return {
      start: await readComboBox(this.page, 'rop-filter-StartTime'),
      end: await readComboBox(this.page, 'rop-filter-EndTime'),
    };
  }

  async selectedMarketIds(): Promise<unknown> {
    return readDropDownTreeValue(this.page, 'rop-filter-MultiStation');
  }

  async selectedDayIds(): Promise<unknown> {
    return readDropDownTreeValue(this.page, 'rop-filter-DayOfWeekMulti');
  }

  /**
   * Whether Focus has locked Day of Week and Time Range.
   *
   * When the headroom check reports budgets are enabled, Focus forces Day of
   * Week to all seven days, widens the times to their extremes, and disables all
   * three controls. See FOCUS-KI-005 — the check that drives this looks broken.
   */
  async headroomLockApplied(): Promise<boolean> {
    return this.page.evaluate(() => {
      const jq = (window as any).jQuery;
      const dow = jq('#rop-filter-DayOfWeekMulti').data('kendoDropDownTree');
      return !!dow && dow.enable === false
        ? true
        : jq('#rop-filter-DayOfWeekMulti')
            .closest('.k-input,.k-picker')
            .hasClass('k-disabled');
    });
  }

  /**
   * DESTRUCTIVE: POSTs /api/ReOptimise, starting a server-side job that rewrites
   * recommendations for the selected scope. @destructive specs only.
   */
  async runReOptimise(): Promise<void> {
    await this.runButton.click();
  }
}

export class BulkOverridePage extends BasePage {
  async open(): Promise<this> {
    await this.goto('bulkOverride');
    return this;
  }

  get fetchButton(): Locator {
    return this.page.locator('#bof-button-fetch');
  }

  get fetchMoreButton(): Locator {
    return this.page.locator('#bof-button-fetch-more');
  }

  get cancelFetchButton(): Locator {
    return this.page.locator('#bof-button-cancel-fetch');
  }

  get programsGrid(): Locator {
    return this.page.locator('#bof-programs-grid');
  }

  get selectionCountTop(): Locator {
    return this.page.locator('#bof-selection-count-top');
  }

  get overrideButton(): Locator {
    return this.page.locator('#bof-button-override');
  }

  get fetchStatus(): Locator {
    return this.page.locator('#bof-fetch-status');
  }

  /** Read-only: fetching programs only queries, it does not override anything. */
  async fetchPrograms(): Promise<void> {
    await this.fetchButton.click();
    await this.waitUntilReady(60_000);
  }

  async programsState(): Promise<GridState> {
    return readGrid(this.page, 'bof-programs-grid');
  }

  /** DESTRUCTIVE: writes override flags to every selected program. */
  async applyOverride(): Promise<void> {
    await this.overrideButton.click();
  }
}

export class RecommendationsPage extends BasePage {
  async open(): Promise<this> {
    await this.goto('recommendations');
    return this;
  }

  get tabStrip(): Locator {
    return this.page.locator('#rec-tabStrip');
  }

  get grid(): Locator {
    return this.page.locator('#rec-grid');
  }

  get scheduler(): Locator {
    return this.page.locator('#rec-scheduler');
  }

  get sendButton(): Locator {
    return this.page.locator('#rec-send-button');
  }

  get exportButton(): Locator {
    return this.page.locator('#rec-filter-Export');
  }

  get editWindow(): Locator {
    return this.page.locator('#recommendation-edit-window');
  }

  async waitForGrid(timeout = 30_000): Promise<void> {
    await waitForGrid(this.page, 'rec-grid', timeout);
  }

  async state(): Promise<GridState> {
    await this.waitForGrid();
    return readGrid(this.page, 'rec-grid');
  }

  async rows<T = Record<string, unknown>>(limit = 100): Promise<T[]> {
    return readGridRows<T>(this.page, 'rec-grid', limit);
  }

  /* -- filters ----------------------------------------------------- */

  /** Manual / Automatic / Both. Defaults to Manual. */
  async setOptimisationType(text: 'Manual' | 'Automatic' | 'Both'): Promise<void> {
    await selectDropDownList(this.page, 'rec-filter-OptimisationType', text);
  }

  /**
   * All / No Change / Any Change / Increase in Discount / Decrease in Discount.
   *
   * Defaults to "Any Change", which returns nothing for most single weeks — so a
   * test that needs rows must either widen the date range or switch to "All".
   */
  async setRecommendationFilter(
    text: 'All' | 'No Change' | 'Any Change' | 'Increase in Discount' | 'Decrease in Discount',
  ): Promise<void> {
    await selectDropDownList(this.page, 'rec-filter-Recommendations', text);
  }

  /** All / Sent / Not Sent. */
  async setStatus(text: 'All' | 'Sent' | 'Not Sent'): Promise<void> {
    await selectDropDownList(this.page, 'rec-filter-Status', text);
  }

  async currentOptimisationType(): Promise<string> {
    return readDropDownList(this.page, 'rec-filter-OptimisationType');
  }

  /** Dates are dd/MM/yyyy, matching what Focus renders. */
  async setDateRange(startDdMmYyyy: string, endDdMmYyyy: string): Promise<void> {
    await setDatePicker(this.page, 'rec-filter-WeekStart', startDdMmYyyy);
    await setDatePicker(this.page, 'rec-filter-WeekEnd', endDdMmYyyy);
  }

  /** Times are HHmm strings, e.g. "1800". */
  async setTimeRange(start: string, end: string): Promise<void> {
    await setComboBox(this.page, 'rec-filter-StartTime', start);
    await setComboBox(this.page, 'rec-filter-EndTime', end);
  }

  async sortBy(columnTitle: string): Promise<void> {
    await sortGridBy(this.page, 'rec-grid', columnTitle);
  }

  /** Switches between the grid and scheduler views. */
  async showGridView(): Promise<void> {
    await this.page.locator('#rec-viewtype-grid').click();
    await this.waitUntilReady();
  }

  async showSchedulerView(): Promise<void> {
    await this.page.locator('#rec-viewtype-scheduler').click();
    await this.waitUntilReady();
  }

  /**
   * DESTRUCTIVE: opens the recommendation editor from the Scheduler view.
   *
   * Two things make this a write, both non-obvious:
   *
   *  1. The editor cannot be opened from the grid at all — the grid has no
   *     detail popup. Focus binds it to `.k-event` clicks in the SCHEDULER view
   *     only, so this switches views first.
   *  2. Opening it POSTs `/api/Recommendations/SetInspected` BEFORE the editor
   *     appears, marking the recommendation as inspected. Cancelling does not
   *     undo that — the write has already happened.
   *
   * @destructive specs only.
   */
  async openRecommendationFromScheduler(eventIndex = 0): Promise<void> {
    await this.showSchedulerView();
    await this.scheduler.locator('.k-event').nth(eventIndex).click();
    await this.editWindow.waitFor({ state: 'visible' });
  }

  /**
   * Closes the editor without saving. Note this does NOT undo the `SetInspected`
   * write that opening it performed.
   */
  async closeDetail(): Promise<void> {
    await this.page.locator('#recommendation-edit-Cancel').click();
    await this.editWindow.waitFor({ state: 'hidden' });
  }

  /**
   * The grid's inline editors. DESTRUCTIVE: changing a user flag or minimum
   * rate POSTs to /api/Recommendations/UserFlags or /UserMinRate immediately on
   * change — there is no save step and no confirmation.
   *
   * Exposed so tests can assert these controls EXIST without operating them.
   */
  get inlineAcceptCheckboxes(): Locator {
    return this.grid.locator('.rec-accept');
  }

  /** DESTRUCTIVE: pushes accepted recommendations downstream. */
  async sendRecommendations(): Promise<void> {
    await this.sendButton.click();
  }
}

export class GridMaintenancePage extends BasePage {
  async open(): Promise<this> {
    await this.goto('gridMaintenance');
    return this;
  }
}
