import fs from 'node:fs';
import path from 'node:path';
import { type TestInfo } from '@playwright/test';

/**
 * Benchmarks pin the exact figures a report produced for one fixed scope, so a
 * later run can tell whether the numbers moved.
 *
 * They are not invariants. A benchmark failing means "these figures differ from
 * the day they were captured" -- which is a regression if the code changed, and
 * expected if the data was re-imported. That is why every baseline records the
 * footer's data vintage alongside the rows: check it first when one fails.
 *
 * Baselines live in tests/benchmarks/baselines/ and are committed. Re-baseline
 * deliberately, with Playwright's own flag:
 *
 *   npx playwright test --project=chromium tests/benchmarks --update-snapshots
 *
 * A missing baseline is written on first run and the test fails, mirroring how
 * toMatchSnapshot behaves, so a new benchmark is never silently green.
 */

export const BASELINE_DIR = path.join(__dirname, '..', '..', 'tests', 'benchmarks', 'baselines');

export interface BenchmarkBaseline<Row> {
  name: string;
  description: string;
  /** The scope in human terms, as a tester would describe it. */
  scope: Record<string, string>;
  /** The exact query sent to the API. */
  query: Record<string, string | number | boolean>;
  capturedAt: string;
  /** Footer metadata at capture time. If it has changed, suspect the data first. */
  dataVintage: Record<string, string>;
  rows: Row[];
}

export interface CompareOptions<Row> {
  /** Identifies a row across runs. */
  key: (row: Row) => string;
  /** Fields compared exactly. */
  exact: Array<keyof Row & string>;
  /** Fields compared within `tolerance` (ratios, averages). */
  approx?: Array<keyof Row & string>;
  tolerance?: number;
}

/** Every difference between two row sets, one human-readable line each. */
export function diffRows<Row>(expected: Row[], actual: Row[], opts: CompareOptions<Row>): string[] {
  const tolerance = opts.tolerance ?? 1e-9;
  const diffs: string[] = [];
  const actualByKey = new Map(actual.map((r) => [opts.key(r), r]));
  const expectedKeys = new Set(expected.map(opts.key));

  for (const exp of expected) {
    const k = opts.key(exp);
    const act = actualByKey.get(k);
    if (!act) {
      diffs.push(`${k}: row missing`);
      continue;
    }
    for (const f of opts.exact) {
      if (exp[f] !== act[f]) diffs.push(`${k}: ${f} expected ${exp[f]}, got ${act[f]}`);
    }
    for (const f of opts.approx ?? []) {
      const e = Number(exp[f]);
      const a = Number(act[f]);
      if (!(Math.abs(e - a) <= tolerance)) diffs.push(`${k}: ${f} expected ${e}, got ${a}`);
    }
  }
  for (const act of actual) {
    const k = opts.key(act);
    if (!expectedKeys.has(k)) diffs.push(`${k}: unexpected extra row`);
  }
  return diffs;
}

/** Keeps only the benchmarked fields, so a baseline does not churn on cosmetic ones. */
export function pick<Row>(rows: Row[], fields: Array<keyof Row & string>): Row[] {
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])) as Row);
}

export function baselinePath(name: string): string {
  return path.join(BASELINE_DIR, `${name}.json`);
}

export function readBaseline<Row>(name: string): BenchmarkBaseline<Row> | undefined {
  const file = baselinePath(name);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BenchmarkBaseline<Row>;
}

export function writeBaseline<Row>(baseline: BenchmarkBaseline<Row>): string {
  const file = baselinePath(baseline.name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
  return file;
}

/**
 * Whether this run should (re)write baselines, following `--update-snapshots`:
 * 'all' / 'changed' rewrite, the default 'missing' only creates absent ones.
 */
export function shouldWriteBaseline(testInfo: TestInfo, exists: boolean): boolean {
  const mode = testInfo.config.updateSnapshots;
  if (mode === 'all' || mode === 'changed') return true;
  return !exists && mode === 'missing';
}
