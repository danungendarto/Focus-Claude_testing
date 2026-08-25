import { test, expect } from '@playwright/test';

/**
 * FOCUS-KI-005 — the Re-Optimise headroom check is unreachable.
 *
 * `/api/ReOptimise/HasHeadroomBudgets` returns `{"isBudgetEnabled": ...}`
 * (camelCase, the ASP.NET Core default). The client reads `e.IsBudgetEnabled`
 * (PascalCase). JavaScript property access is case-sensitive, so the value is
 * always `undefined`, always falsy, and the branch that reacts to headroom
 * budgets can never run.
 *
 * This is written as a CONTRACT test rather than a hard-coded expectation: it
 * reads the property name out of the shipped bundle and compares it with the
 * keys the API actually returns. That way it passes as soon as either side is
 * corrected — whether the fix lands on the server or in the client.
 */

const HEADROOM_URL =
  '/api/ReOptimise/HasHeadroomBudgets' +
  '?channelId=1&stationId=1&dayOfWeekId=127&startTime=600&endTime=2359' +
  '&startDate=2026-05-31&endDate=2026-06-06&selectedChannels=1&selectedStations=1';

test.describe('@known-issue re-optimise headroom', () => {
  test('FOCUS-KI-005 the client reads the property name the API actually sends', async ({
    request,
  }) => {
    test.fail(true, 'FOCUS-KI-005: client reads IsBudgetEnabled, API sends isBudgetEnabled');

    const bundle = await request.get('/js/dist/optimiser.bundled.js');
    expect(bundle.status(), 'optimiser bundle should be served').toBe(200);

    const source = await bundle.text();
    const match = source.match(/\.([A-Za-z]*BudgetEnabled)\b/);
    expect(match, 'the bundle should read some *BudgetEnabled property').not.toBeNull();
    const clientKey = match![1];

    const api = await request.get(HEADROOM_URL);
    expect(api.status()).toBe(200);
    const body = (await api.json()) as Record<string, unknown>;

    expect(
      Object.keys(body),
      `the client reads "${clientKey}" but the API returns ${JSON.stringify(Object.keys(body))} — ` +
        'the headroom branch can never execute',
    ).toContain(clientKey);
  });

  test('FOCUS-KI-005 documents the current mismatch', async ({ request }) => {
    const bundle = await request.get('/js/dist/optimiser.bundled.js');
    const source = await bundle.text();
    const clientKey = source.match(/\.([A-Za-z]*BudgetEnabled)\b/)?.[1];

    const body = (await (await request.get(HEADROOM_URL)).json()) as Record<string, unknown>;
    const apiKeys = Object.keys(body);

    test.skip(
      !clientKey || apiKeys.includes(clientKey),
      'FOCUS-KI-005 appears to be fixed; delete this spec and its KNOWN_ISSUES entry',
    );

    // Case-insensitively they match, which is what makes this a casing bug
    // rather than a missing field — and why it is easy to miss in review.
    const caseInsensitiveMatch = apiKeys.find(
      (k) => k.toLowerCase() === String(clientKey).toLowerCase(),
    );
    expect(
      caseInsensitiveMatch,
      'the field exists, only its casing differs — a pure casing defect',
    ).toBeTruthy();

    test.info().annotations.push({
      type: 'known-issue',
      description:
        `FOCUS-KI-005: client reads "${clientKey}", API returns "${caseInsensitiveMatch}". ` +
        'The headroom lock (force all 7 days, widen times, disable the controls) is dead code.',
    });
  });
});
