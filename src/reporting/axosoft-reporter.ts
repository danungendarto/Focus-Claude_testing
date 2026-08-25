/**
 * Playwright reporter that files Focus test failures into Axosoft.
 *
 * The API calls are the easy part. The rules below are what make this something
 * a team keeps switched on rather than mutes after the first bad night.
 *
 *  1. DRY RUN BY DEFAULT. Nothing is written unless AXOSOFT_CREATE_DEFECTS=1.
 *     Unconfigured or local runs are silent no-ops.
 *  2. ONLY UNEXPECTED FAILURES. Playwright's own outcome() already excludes
 *     skipped tests, flaky-then-passed, and the @known-issue specs that are
 *     *expected* to fail. We never re-file a defect we already know about.
 *  3. AN UNEXPECTED *PASS* IS NOT A DEFECT. When a test.fail() known-issue spec
 *     starts passing, the bug is fixed. That gets reported, not filed.
 *  4. DEDUPLICATION. Every defect carries a fingerprint of the test identity;
 *     a repeat failure comments on the existing defect instead of creating one.
 *  5. CIRCUIT BREAKER. Above a failure threshold, file ONE run-wide defect
 *     instead of N. Forty failures is one environment problem, not forty bugs.
 *  6. FAILURES HERE NEVER FAIL THE RUN. A tracker outage must not turn a green
 *     test run red; problems are printed and the exit code is left alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult,
} from '@playwright/test/reporter';
import { AxosoftClient, axosoftConfigFromEnv, AxosoftError } from './axosoft-client';
import { buildDefect, buildRunFailureDefect, fingerprintOf, type RunContext } from './defect-content';

interface Failure {
  test: TestCase;
  result: TestResult;
}

export default class AxosoftReporter implements Reporter {
  private readonly failures: Failure[] = [];
  private readonly fixedKnownIssues: TestCase[] = [];
  private readonly flaky: TestCase[] = [];
  private totalTests = 0;
  private context!: RunContext;

  private readonly enabled = process.env.AXOSOFT_CREATE_DEFECTS === '1';
  private readonly maxDefects = Number(process.env.AXOSOFT_MAX_DEFECTS ?? 8);
  private readonly maxFailureRatio = Number(process.env.AXOSOFT_MAX_FAILURE_RATIO ?? 0.25);

  onBegin(config: FullConfig, suite: Suite): void {
    this.totalTests = suite.allTests().length;

    const project = config.projects[0];
    this.context = {
      baseUrl: String(project?.use?.baseURL ?? process.env.FOCUS_BASE_URL ?? 'unknown'),
      projectName: project?.name ?? 'chromium',
      runLabel:
        process.env.BUILD_NUMBER ??
        process.env.GITHUB_RUN_ID ??
        process.env.CI_PIPELINE_ID ??
        'local run',
      artifactBaseUrl: process.env.FOCUS_ARTIFACT_BASE_URL,
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();

    if (outcome === 'flaky') {
      this.flaky.push(test);
      return;
    }
    if (outcome !== 'unexpected') return;

    // A test.fail() spec that passed: the known issue is fixed. Report it,
    // do not file a defect for it.
    if (result.status === 'passed') {
      this.fixedKnownIssues.push(test);
      return;
    }

    this.failures.push({ test, result });
  }

  async onEnd(_result: FullResult): Promise<void> {
    this.reportNonDefects();

    if (this.failures.length === 0) return;

    const runWide = this.isRunWideFailure();
    const drafts = runWide
      ? [buildRunFailureDefect(this.failures, this.context, this.totalTests)]
      : this.failures.map((f) => buildDefect(f.test, f.result, this.context));

    if (runWide) {
      this.warn(
        `${this.failures.length} of ${this.totalTests} tests failed. Filing ONE run-wide ` +
          'defect instead of one per test — this pattern is usually a single shared cause.',
      );
    }

    // Always written, whether or not Axosoft is reachable. Generating an API key
    // needs admin rights, so the suite has to stay useful without one: this file
    // is ready to paste straight into Axosoft by hand.
    this.writeDraftFile(drafts);

    const config = axosoftConfigFromEnv();
    if (!config) {
      if (this.enabled) {
        this.warn(
          'AXOSOFT_CREATE_DEFECTS=1 but AXOSOFT_URL / AXOSOFT_PROJECT_ID are unset. ' +
            'Nothing was filed — use the draft file above.',
        );
      }
      return;
    }

    if (!this.enabled) {
      this.printDryRun(drafts);
      return;
    }

    const client = new AxosoftClient(config);
    try {
      await client.authenticate();
    } catch (error) {
      this.warn(`Could not authenticate with Axosoft, so nothing was filed. ${describe(error)}`);
      return;
    }

    for (const draft of drafts) {
      try {
        const existing = await client.findDefectsByFingerprint(draft.fingerprint);

        if (existing.length > 0) {
          const match = existing[0];
          const step = match.workflow_step?.name ? ` (${match.workflow_step.name})` : '';
          await client.addComment(
            match.id,
            `Failed again in ${this.context.runLabel} against ${this.context.baseUrl}.`,
          );
          this.log(`recurring → commented on defect ${match.id}${step}: ${client.defectUrl(match.id)}`);
          continue;
        }

        const created = await client.createDefect({
          name: draft.name,
          description: draft.description,
        });
        this.log(`filed defect ${created.id}: ${client.defectUrl(created.id)}`);
      } catch (error) {
        // Never let a tracker problem fail the test run.
        this.warn(`Could not file "${draft.name}". ${describe(error)}`);
      }
    }
  }

  /* -- helpers ------------------------------------------------------- */

  /**
   * True when the failure count or ratio suggests one shared cause.
   * Both thresholds are configurable; the ratio catches small suites where a
   * fixed count would not.
   */
  private isRunWideFailure(): boolean {
    if (this.totalTests === 0) return false;
    return (
      this.failures.length > this.maxDefects ||
      this.failures.length / this.totalTests > this.maxFailureRatio
    );
  }

  private reportNonDefects(): void {
    for (const test of this.fixedKnownIssues) {
      this.log(
        `KNOWN ISSUE APPEARS FIXED — "${test.titlePath().filter(Boolean).join(' › ')}" ` +
          'passed while marked test.fail(). Remove its entry from src/data/known-issues.ts ' +
          'and delete the spec. No defect filed.',
      );
    }
    if (this.flaky.length > 0) {
      this.log(
        `${this.flaky.length} flaky test(s) passed on retry; no defects filed. ` +
          'Flakiness is worth investigating but is not a product defect.',
      );
    }
  }

  /**
   * Writes the drafts to a file that can be pasted into Axosoft by hand.
   *
   * This is the no-credentials path. Generating an Axosoft API key requires
   * admin rights (Tools → System Settings), which a tester may not have, and
   * "you cannot use this until someone else grants you access" is a bad place
   * for a test suite to leave you.
   */
  private writeDraftFile(drafts: Array<{ name: string; text: string }>): void {
    try {
      const dir = 'test-results';
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'axosoft-defects.md');

      const body = [
        `# Defect drafts — Focus test run`,
        ``,
        `Environment: ${this.context.baseUrl}`,
        `Run: ${this.context.runLabel}`,
        `${drafts.length} defect(s) to raise.`,
        ``,
        `Copy each block into Axosoft: the heading is the defect Name, the text`,
        `below it is the Description. Keep the \`${'focus-autotest-fp'}:…\` marker —`,
        `it is what lets a later automated run recognise the same failure instead`,
        `of raising a duplicate.`,
        ``,
        ...drafts.flatMap((d) => [`---`, ``, `## ${d.name}`, ``, d.text, ``]),
      ].join('\n');

      writeFileSync(file, body, 'utf8');
      this.log(`draft defects written to ${file} — paste-ready, no API key needed`);
    } catch (error) {
      this.warn(`could not write the draft file: ${describe(error)}`);
    }
  }

  private printDryRun(drafts: Array<{ name: string; fingerprint: string }>): void {
    this.log(
      `DRY RUN — ${drafts.length} defect(s) would be filed. ` +
        'Set AXOSOFT_CREATE_DEFECTS=1 to file them for real.',
    );
    for (const draft of drafts) {
      this.log(`  • ${draft.name}   [${draft.fingerprint}]`);
    }
  }

  private log(message: string): void {
    console.log(`[axosoft] ${message}`);
  }

  private warn(message: string): void {
    console.warn(`[axosoft] ${message}`);
  }
}

function describe(error: unknown): string {
  if (error instanceof AxosoftError) {
    return `${error.message}${error.body ? ` — ${error.body}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export { fingerprintOf };
