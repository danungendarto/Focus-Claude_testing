/**
 * Defects found in Focus that are real, reported, and not yet fixed.
 *
 * The point of this register is to keep the suite green on KNOWN breakage
 * without hiding it. Each entry is covered by a dedicated spec in
 * tests/known-issues/ that pins the current wrong behaviour, so when the bug is
 * fixed that spec reports an unexpected pass -- the prompt to delete the entry.
 *
 * `suppress` is deliberately separate from registration. Registering a defect
 * documents it; only an entry with a `suppress` pattern is excluded from the
 * generic "no browser errors" assertion, and even then it is attached to the
 * report as a `known-issue` annotation rather than passing silently.
 *
 * Nothing that indicates data loss or a server crash gets a `suppress` pattern.
 * A 500 should always turn a test red, known or not.
 */

export interface KnownIssue {
  /** Local tracking id; replace with the real ticket when one exists. */
  id: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
  /**
   * Optional. When present, diagnostic lines matching this are downgraded from
   * failures to annotations. Omit for anything that must always fail.
   */
  suppress?: RegExp;
}

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: 'FOCUS-KI-001',
    severity: 'medium',
    summary:
      'Focus API endpoints return HTTP 404 with a plain-text body (e.g. "No Optimise Rules ' +
      'found.") when a filter combination matches no data, instead of 200 with an empty ' +
      'array. Confirmed on /api/OptimiserRule, /api/AboveBelowForecast, /api/Blacklist, ' +
      '/api/Recommendations and /api/BookingDiscountPace. Consequences: a console error on ordinary empty-result page ' +
      'loads, "not found" indistinguishable from "no rows", and false alarms in any ' +
      'monitoring that watches 4xx rates.',
    // Scoped to /api/ 404s so a genuine missing route elsewhere still fails.
    suppress: /http error: 404 GET \S*\/api\//,
  },
  {
    id: 'FOCUS-KI-002',
    severity: 'low',
    summary:
      'Report pages issue their first data request twice on load: the first is cancelled ' +
      '(ERR_ABORTED) and immediately re-sent. Functionally harmless, but it doubles server ' +
      'load for every page view and makes request-count assertions unreliable.',
    // No suppress pattern needed: aborted requests are already excluded from
    // diagnostics, because Kendo also cancels fetches legitimately on filter change.
  },
  {
    id: 'FOCUS-KI-005',
    severity: 'high',
    summary:
      'The Re-Optimise headroom safeguard is unreachable. ' +
      '/api/ReOptimise/HasHeadroomBudgets returns {"isBudgetEnabled": ...} (camelCase) but ' +
      'the client reads e.IsBudgetEnabled (PascalCase), which is always undefined. The ' +
      'branch that forces whole-week scope, widens the time range, disables the Day of Week ' +
      'and Time controls and shows the explanatory warning can therefore never run. A ' +
      'planner could re-optimise at a narrower scope than headroom budgets require, with no ' +
      'warning and no visible sign anything is wrong.',
    // Not suppressed: it produces no console error of its own -- the failure is
    // silent, which is precisely what makes it dangerous.
  },
  {
    id: 'FOCUS-KI-004',
    severity: 'medium',
    summary:
      'The Recommendations page shows an empty grid on load because the ' +
      '"Recommendations" filter defaults to "Any Change", which matches no rows for a ' +
      'typical single week. 99 recommendations existed for the current week while the ' +
      'grid showed nothing. There is no empty-state message explaining that a filter is ' +
      'excluding rows, so the page reads as "nothing to review" or as broken.',
    // Not suppressed: the underlying 404 is already covered by KI-001's pattern,
    // and this entry documents the user-facing consequence rather than log noise.
  },
  {
    id: 'FOCUS-KI-003',
    severity: 'high',
    summary:
      'A well-formed but unknown channelId (e.g. 5012) makes /api/ProgramInventory return ' +
      'HTTP 500 with a full HTML error page, from an endpoint that otherwise returns JSON. ' +
      'A non-numeric channelId is correctly rejected with 400, so the input path is only ' +
      'half-validated.',
    // Deliberately NOT suppressed: a 500 must always fail a test.
  },
  {
    id: 'FOCUS-KI-006',
    severity: 'high',
    summary:
      '/api/InventoryBookingPace returns HTTP 500 with an HTML error page unless itemDate is ' +
      'a parseable date. Empty, absent and malformed all crash it -- and the EMPTY STRING is ' +
      'the documented default of the shared report query contract that every Focus page ' +
      'sends, so the ordinary call shape is the crashing one. itemDate has no validation at ' +
      'all, while sibling parameters on the same endpoint do: a malformed summaryType is ' +
      'correctly rejected with 400 problem+json, and a valid itemDate with no data correctly ' +
      'returns 404 problem+json. Same half-validated shape as FOCUS-KI-003.',
    // Deliberately NOT suppressed: a 500 must always fail a test.
  },
  {
    id: 'FOCUS-KI-007',
    severity: 'high',
    summary:
      'Availability is reported inconsistently for the same inventory. For channel 7 / ' +
      'Sydney / week 2026-06-21 / 0600-2359, /api/ProgramInventory reports 30105 seconds ' +
      'available while /api/Recommendations and /api/BookingPaceSummary both report 24255 -- ' +
      'a 24% gap -- even though capacity, paid and bonus agree row-for-row across all 99 ' +
      'rows. Within a single /api/Recommendations response the four duration fields fail to ' +
      'reconcile on 15 of 99 rows: capacityDuration !== paidDuration + bonusDuration + ' +
      'availabilityDuration. The shortfall equals totalGrid on 12 rows, is ignored on 20 ' +
      'rows that also carry grid inventory, and is partial on 3 -- so it is not a consistent ' +
      'definitional difference. Availability drives what the optimiser believes it can sell.',
    // Not suppressed: it produces no console error. The page renders perfectly
    // and the number is wrong, which is the failure mode that matters most here.
  },
];

/** Splits diagnostic lines into genuinely new problems and suppressed ones. */
export function partitionKnown(lines: string[]): {
  unexpected: string[];
  known: Array<{ issue: KnownIssue; line: string }>;
} {
  const unexpected: string[] = [];
  const known: Array<{ issue: KnownIssue; line: string }> = [];

  for (const line of lines) {
    const issue = KNOWN_ISSUES.find((k) => k.suppress?.test(line));
    if (issue) known.push({ issue, line });
    else unexpected.push(line);
  }
  return { unexpected, known };
}
