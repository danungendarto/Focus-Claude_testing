import { test as base, expect, type Page } from '@playwright/test';
import { partitionKnown } from './data/known-issues';
import { BasePage } from './pages/BasePage';
import {
  InventorySummaryPage, BookingPaceSummaryPage, BookingDiscountPacePage,
  ProgramVsForecastPage, AboveBelowForecastPage,
} from './pages/ReportPage';
import {
  OptimiserRulesPage, ReOptimisePage, BulkOverridePage,
  RecommendationsPage, GridMaintenancePage,
} from './pages/OptimisePages';
import {
  ForecastPage, ForecastBlacklistsPage, ForecastDiscountCurvesPage,
} from './pages/ForecastPages';

/**
 * Collects the browser-side problems Focus does not surface on its own.
 *
 * Focus fails quietly: a broken Kendo binding logs to the console and leaves an
 * empty grid, which a naive "page loaded" assertion happily passes. Every test
 * gets one of these so that class of defect cannot hide.
 */
export class PageDiagnostics {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly failedRequests: string[] = [];
  /** Non-OK HTTP responses, captured WITH their URL. */
  readonly httpErrors: string[] = [];
  /** Requests the browser cancelled -- normally benign, but see FOCUS-KI-002. */
  readonly abortedRequests: string[] = [];

  constructor(page: Page) {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // "Failed to load resource" carries no URL and always duplicates an entry
      // in httpErrors, which does. Keep the useful one only.
      if (msg.text().includes('Failed to load resource')) return;
      this.consoleErrors.push(msg.text());
    });

    page.on('pageerror', (err) => this.pageErrors.push(err.message));

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_ABORTED')) {
        this.abortedRequests.push(`${req.method()} ${short(req.url())} -- ${failure}`);
        return;
      }
      this.failedRequests.push(`${req.method()} ${short(req.url())} -- ${failure}`);
    });

    page.on('response', (res) => {
      if (res.status() >= 400) {
        this.httpErrors.push(`${res.status()} ${res.request().method()} ${short(res.url())}`);
      }
    });
  }

  /** Everything worth failing a test over, as one list. */
  all(): string[] {
    return [
      ...this.pageErrors.map((e) => 'pageerror: ' + e),
      ...this.consoleErrors.map((e) => 'console.error: ' + e),
      ...this.failedRequests.map((e) => 'request failed: ' + e),
      ...this.httpErrors.map((e) => 'http error: ' + e),
    ];
  }

  /**
   * Fails on anything not already registered in KNOWN_ISSUES, and annotates the
   * report with the known ones so they stay visible rather than silently passing.
   */
  expectClean(): void {
    const { unexpected, known } = partitionKnown(this.all());

    for (const { issue, line } of known) {
      test.info().annotations.push({
        type: 'known-issue',
        description: `${issue.id}: ${line}`,
      });
    }

    expect(unexpected, 'browser reported errors during this test').toEqual([]);
  }
}

/** Query strings on Focus API calls are long; keep failure output readable. */
function short(url: string): string {
  const [path, query] = url.split('?');
  if (!query) return path;
  return `${path}?${query.slice(0, 120)}${query.length > 120 ? '...' : ''}`;
}

type FocusFixtures = {
  diagnostics: PageDiagnostics;
  basePage: BasePage;
  inventorySummary: InventorySummaryPage;
  bookingPaceSummary: BookingPaceSummaryPage;
  bookingDiscountPace: BookingDiscountPacePage;
  programVsForecast: ProgramVsForecastPage;
  aboveBelowForecast: AboveBelowForecastPage;
  forecast: ForecastPage;
  forecastBlacklists: ForecastBlacklistsPage;
  forecastDiscountCurves: ForecastDiscountCurvesPage;
  optimiserRules: OptimiserRulesPage;
  gridMaintenance: GridMaintenancePage;
  reOptimise: ReOptimisePage;
  bulkOverride: BulkOverridePage;
  recommendations: RecommendationsPage;
};

export const test = base.extend<FocusFixtures>({
  // Attached before any navigation so nothing is missed.
  diagnostics: async ({ page }, use) => {
    await use(new PageDiagnostics(page));
  },

  basePage: async ({ page }, use) => { await use(new BasePage(page)); },
  inventorySummary: async ({ page }, use) => { await use(new InventorySummaryPage(page)); },
  bookingPaceSummary: async ({ page }, use) => { await use(new BookingPaceSummaryPage(page)); },
  bookingDiscountPace: async ({ page }, use) => { await use(new BookingDiscountPacePage(page)); },
  programVsForecast: async ({ page }, use) => { await use(new ProgramVsForecastPage(page)); },
  aboveBelowForecast: async ({ page }, use) => { await use(new AboveBelowForecastPage(page)); },
  forecast: async ({ page }, use) => { await use(new ForecastPage(page)); },
  forecastBlacklists: async ({ page }, use) => { await use(new ForecastBlacklistsPage(page)); },
  forecastDiscountCurves: async ({ page }, use) => { await use(new ForecastDiscountCurvesPage(page)); },
  optimiserRules: async ({ page }, use) => { await use(new OptimiserRulesPage(page)); },
  gridMaintenance: async ({ page }, use) => { await use(new GridMaintenancePage(page)); },
  reOptimise: async ({ page }, use) => { await use(new ReOptimisePage(page)); },
  bulkOverride: async ({ page }, use) => { await use(new BulkOverridePage(page)); },
  recommendations: async ({ page }, use) => { await use(new RecommendationsPage(page)); },
});

export { expect } from '@playwright/test';
