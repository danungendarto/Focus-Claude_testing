import { expect, type Page, type Locator } from '@playwright/test';
import { waitForPageReady, readErrorMessages } from '../kendo/kendo';
import { ROUTES, type RouteKey } from '../data/focus';

/**
 * Shared chrome: the fixed top navbar, the footer snapshot dates, and the
 * page-level readiness contract. Every Focus page renders these.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  /* -- navigation ------------------------------------------------- */

  get navbar(): Locator {
    return this.page.locator('nav.navbar');
  }

  get logo(): Locator {
    return this.page.locator('img.focus-logo');
  }

  get footer(): Locator {
    return this.page.locator('footer.footer');
  }

  get pageTitle(): Locator {
    return this.page.locator('.page-title').first();
  }

  /** Opens a top-level navbar dropdown by its label, e.g. "Reports". */
  async openMenu(label: string): Promise<void> {
    await this.page.locator('.navbar .nav-item.dropdown > a.nav-link', { hasText: label }).first().click();
    await this.page.locator('.dropdown-menu.show').first().waitFor({ state: 'visible' });
  }

  /** Clicks through the navbar the way a user would, rather than goto(). */
  async navigateViaMenu(menu: string, item: string): Promise<void> {
    await this.openMenu(menu);
    await this.page.locator('.dropdown-menu.show a', { hasText: item }).first().click();
    await this.waitUntilReady();
  }

  async goto(route: RouteKey | string): Promise<void> {
    const path = route in ROUTES ? ROUTES[route as RouteKey] : String(route);
    await this.page.goto(path);
    await this.waitUntilReady();
  }

  async waitUntilReady(timeout = 30_000): Promise<void> {
    await waitForPageReady(this.page, timeout);
  }

  /* -- footer snapshot metadata ----------------------------------- */

  /**
   * The footer reports the data vintage. Tests that assert on figures are only
   * meaningful against a known snapshot, so surface it in failure output.
   */
  async readFooterMetadata(): Promise<Record<string, string>> {
    return this.page.evaluate(() => {
      const text = document.querySelector('footer .col-xs-7, footer .col-md-8')?.textContent ?? '';
      const grab = (label: string) => {
        const m = text.match(new RegExp(label + ':\\s*([^\\n]*?)(?=\\s{2,}|[A-Z][a-z]+ [a-z]|$)'));
        return (m?.[1] ?? '').trim();
      };
      return {
        latestSnapshot: grab('Latest snapshot'),
        importedOn: grab('Imported on'),
        lastFullOptimise: document.querySelector('#footer-lastFullOptimiseDateTime')?.textContent?.trim() ?? '',
        lastPartialOptimise: document.querySelector('#footer-lastPartialOptimiseDate')?.textContent?.trim() ?? '',
        version: document.querySelector('footer .col-lg-2')?.textContent?.trim() ?? '',
      };
    });
  }

  /* -- error surface ---------------------------------------------- */

  async errors(): Promise<string[]> {
    return readErrorMessages(this.page);
  }

  async expectNoErrors(): Promise<void> {
    expect(await this.errors(), 'page reported errors in #errorMessages').toEqual([]);
  }
}
