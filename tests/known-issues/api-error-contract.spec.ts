import { test, expect } from '@playwright/test';
import { READ_API, defaultReportQuery, CHANNELS, type ReportQuery } from '../../src/data/focus';

/**
 * Specs for defects that are real, reported, and not yet fixed.
 *
 * Specs that assert the CORRECT behaviour call `test.fail()` in the test body,
 * so Playwright expects them to fail and the suite stays green while the bug
 * exists. The moment the bug is fixed the test "unexpectedly passes" and
 * Playwright reports it -- which is the prompt to delete the spec and its
 * KNOWN_ISSUES entry. The assertion doubles as the acceptance criteria.
 *
 * Specs that merely DOCUMENT the current blast radius do not call test.fail();
 * they skip themselves once the behaviour changes.
 */

function qs(query: ReportQuery): string {
  return Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function unknownChannelId(): number {
  return Math.max(...CHANNELS.map((c) => c.id)) + 5000;
}

test.describe('@known-issue API error contract', () => {
  test('FOCUS-KI-001 empty result sets should be 200 with an empty array', async ({ request }) => {
    test.fail(true, 'FOCUS-KI-001: an empty result set is returned as 404');

    // The Optimiser Rules page issues exactly this call on load and gets a 404
    // whenever the filters match no rules, which is an ordinary, valid state.
    const res = await request.get(
      `${READ_API.optimiserRule}?${qs(defaultReportQuery({
        sortBy: 'Description',
        sortOrder: 'asc',
      }))}&ruleType=default`,
    );

    expect(
      res.status(),
      '"no rows matched" is a successful query, not a missing resource',
    ).toBe(200);
  });

  test('FOCUS-KI-001 the 404 body is plain text, not the problem+json used elsewhere', async ({
    request,
  }) => {
    const res = await request.get(
      `${READ_API.optimiserRule}?${qs(defaultReportQuery({
        sortBy: 'Description',
        sortOrder: 'asc',
      }))}&ruleType=default`,
    );

    test.skip(res.status() !== 404, 'FOCUS-KI-001 appears to be fixed; delete this spec');

    // Focus returns RFC7807 problem+json for validation errors but a bare string
    // here, so a client cannot handle Focus errors uniformly.
    const contentType = res.headers()['content-type'] ?? '';
    expect(contentType, 'the empty-result 404 currently returns plain text').not.toContain('json');

    test.info().annotations.push({
      type: 'known-issue',
      description: `FOCUS-KI-001: 404 body was "${(await res.text()).trim().slice(0, 80)}" as ${contentType}`,
    });
  });
});

test.describe('@known-issue unhandled input', () => {
  test('FOCUS-KI-003 an unknown channelId should not produce a 500', async ({ request }) => {
    test.fail(true, 'FOCUS-KI-003: a valid-but-unknown channelId crashes the endpoint');

    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({
        channelId: unknownChannelId(),
        selectedChannels: String(unknownChannelId()),
      }))}`,
    );

    // A non-numeric channelId is correctly rejected with a 400; an id that is
    // well-formed but does not exist should behave the same way, or return no
    // rows -- not crash.
    expect(res.status(), 'an unknown id should be handled, not thrown on').toBeLessThan(500);
  });

  test('FOCUS-KI-003 the 500 leaks an HTML error page from a JSON endpoint', async ({ request }) => {
    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery({
        channelId: unknownChannelId(),
        selectedChannels: String(unknownChannelId()),
      }))}`,
    );

    test.skip(res.status() !== 500, 'FOCUS-KI-003 appears to be fixed; delete this spec');

    // Documents the current blast radius: an API client parsing JSON gets an
    // HTML document instead, so it fails at the parse rather than surfacing the
    // real error to the user.
    expect(res.headers()['content-type'], 'the 500 currently returns text/html').toContain('html');
    expect(await res.text(), 'the response is a full error page').toContain('<!DOCTYPE html>');

    test.info().annotations.push({
      type: 'known-issue',
      description:
        'FOCUS-KI-003: /api/ProgramInventory returns a 500 with a full HTML error page ' +
        'for a well-formed but unknown channelId.',
    });
  });

  test('a non-numeric channelId is still correctly rejected with a 400', async ({ request }) => {
    // The counterpart to KI-003: this path IS handled. Pinning it makes clear
    // the defect is half-validation, not absent validation.
    const res = await request.get(
      `${READ_API.programInventory}?${qs(defaultReportQuery())}`.replace('channelId=1', 'channelId=abc'),
    );

    expect(res.status()).toBe(400);
  });
});

test.describe('@known-issue duplicate requests', () => {
  test('FOCUS-KI-002 report pages fetch their data twice on load', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/BookingPaceSummary')) apiCalls.push(req.url());
    });

    await page.goto('/BookingPaceSummary');
    await page.waitForLoadState('networkidle');

    test.skip(apiCalls.length < 2, 'FOCUS-KI-002 appears to be fixed; delete this spec');

    // Focus issues the first request, aborts it, and immediately re-sends an
    // identical one. Harmless functionally, but it doubles server load on every
    // page view and makes request-count assertions unreliable.
    expect(new Set(apiCalls).size, 'the duplicate calls are byte-identical').toBe(1);

    test.info().annotations.push({
      type: 'known-issue',
      description: `FOCUS-KI-002: /api/BookingPaceSummary requested ${apiCalls.length}x on one page load`,
    });
  });
});
