import { type Page, type Request } from '@playwright/test';

/**
 * Counts in-flight requests to one endpoint, at the network level.
 *
 * Why this exists: the report pages fetch their grid data with XHRs that do not
 * go through jQuery and do not set `#is-loading`, so `waitForGrid` and
 * `waitForAjaxIdle` cannot see them. That is usually harmless, but a test whose
 * result depends on WHICH response landed last -- see FOCUS-KI-008 -- needs to
 * know that every request it caused has actually finished.
 */
export class InflightRequests {
  private inflight = new Set<Request>();
  /** Every matching request URL, in the order it was sent. */
  readonly sent: string[] = [];

  constructor(private readonly page: Page, private readonly urlFragment: string) {
    page.on('request', (r) => {
      if (!r.url().includes(urlFragment)) return;
      this.inflight.add(r);
      this.sent.push(r.url());
    });
    const done = (r: Request) => this.inflight.delete(r);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  get count(): number {
    return this.inflight.size;
  }

  /**
   * Resolves once nothing is in flight and nothing new has started for
   * `quietMs`. The quiet period covers the gap between a filter change and its
   * request going out.
   */
  async settled(quietMs = 500, timeout = 30_000): Promise<void> {
    const deadline = Date.now() + timeout;
    let quietSince = Date.now();
    let lastSent = this.sent.length;
    while (Date.now() < deadline) {
      if (this.count > 0 || this.sent.length !== lastSent) {
        quietSince = Date.now();
        lastSent = this.sent.length;
      } else if (Date.now() - quietSince >= quietMs) {
        return;
      }
      await this.page.waitForTimeout(50);
    }
    throw new Error(`${this.urlFragment}: ${this.count} request(s) still in flight after ${timeout}ms`);
  }
}
