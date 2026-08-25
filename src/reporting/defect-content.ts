/**
 * Turns a Playwright failure into a defect a developer can act on, plus the
 * fingerprint that stops it being filed twice.
 *
 * Content is built once as a list of blocks and rendered twice:
 *   - `description` — HTML, for Axosoft's rich-text field via the API
 *   - `text`        — plain text, for pasting by hand
 *
 * The plain-text rendering is not a nicety. Generating an Axosoft API key needs
 * admin rights that not every tester has, so the suite must still produce
 * something usable while that is being sorted out.
 */
import { createHash } from 'node:crypto';
import type { TestCase, TestResult } from '@playwright/test/reporter';

/** Marker embedded in every filed defect so we can find it again. */
export const FINGERPRINT_PREFIX = 'focus-autotest-fp';

/**
 * A stable identity for a test, independent of run conditions.
 *
 * Deliberately built from the file path and title chain only — NOT the error
 * message (it changes between runs) and NOT the line number (it shifts whenever
 * anyone edits the file above it). Either would break deduplication.
 */
export function fingerprintOf(test: TestCase): string {
  const parts = [test.location.file.replace(/\\/g, '/').split('/tests/').pop() ?? '', ...test.titlePath()];
  const hash = createHash('sha1').update(parts.join('::')).digest('hex').slice(0, 12);
  return `${FINGERPRINT_PREFIX}:${hash}`;
}

export interface DefectDraft {
  name: string;
  /** HTML, for the Axosoft API. */
  description: string;
  /** Plain text, for pasting into Axosoft by hand. */
  text: string;
  fingerprint: string;
}

export interface RunContext {
  baseUrl: string;
  projectName: string;
  runLabel: string;
  artifactBaseUrl?: string;
}

/* ------------------------------------------------------------------ *
 * Content blocks, rendered to either HTML or plain text
 * ------------------------------------------------------------------ */

type Block =
  | { t: 'p'; text: string; bold?: boolean }
  | { t: 'heading'; text: string }
  | { t: 'kv'; rows: Array<[string, string]> }
  | { t: 'code'; text: string }
  | { t: 'list'; items: Array<{ label: string; href?: string }> }
  | { t: 'rule' }
  | { t: 'small'; text: string };

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'p':
          return `<p>${b.bold ? `<b>${esc(b.text)}</b>` : esc(b.text)}</p>`;
        case 'heading':
          return `<p><b>${esc(b.text)}</b></p>`;
        case 'kv':
          return `<table>${b.rows
            .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`)
            .join('')}</table>`;
        case 'code':
          return `<pre style="white-space:pre-wrap">${esc(b.text.trim())}</pre>`;
        case 'list':
          return `<ul>${b.items
            .map((i) =>
              i.href ? `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>` : `<li>${esc(i.label)}</li>`,
            )
            .join('')}</ul>`;
        case 'rule':
          return '<hr/>';
        case 'small':
          return `<p><small>${esc(b.text)}</small></p>`;
      }
    })
    .join('\n');
}

function renderText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'p':
          return b.text;
        case 'heading':
          return `${b.text}\n${'-'.repeat(b.text.length)}`;
        case 'kv': {
          const width = Math.max(...b.rows.map(([k]) => k.length));
          return b.rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n');
        }
        case 'code':
          return b.text
            .trim()
            .split('\n')
            .map((l) => `    ${l}`)
            .join('\n');
        case 'list':
          return b.items.map((i) => `  - ${i.label}${i.href ? ` (${i.href})` : ''}`).join('\n');
        case 'rule':
          return '-'.repeat(60);
        case 'small':
          return b.text;
      }
    })
    .join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Error text
 * ------------------------------------------------------------------ */

/** Strips Playwright's ANSI colour codes out of error text. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}

/**
 * Playwright's `stack` normally already begins with `message`, so naively
 * joining both prints the whole assertion twice. Prefer the stack when it
 * already contains the message.
 */
function errorTextOf(result: TestResult): string {
  const parts = result.errors.map((e) => {
    const message = (e.message ?? '').trim();
    const stack = (e.stack ?? '').trim();
    if (!stack) return message;
    if (!message) return stack;

    const firstLine = message.split('\n')[0];
    return stack.includes(firstLine) ? stack : `${message}\n${stack}`;
  });

  return stripAnsi(parts.filter(Boolean).join('\n\n')) || 'No error message captured.';
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ *
 * Drafts
 * ------------------------------------------------------------------ */

export function buildDefect(test: TestCase, result: TestResult, context: RunContext): DefectDraft {
  const fingerprint = fingerprintOf(test);
  const titlePath = test.titlePath().filter(Boolean).join(' › ');
  const specPath = test.location.file.replace(/\\/g, '/').split('/').slice(-3).join('/');

  const errorText = errorTextOf(result);

  // The first line of a Playwright assertion failure is the useful one.
  const headline = errorText.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'Test failed';

  const artifacts = result.attachments
    .filter((a) => a.path)
    .map((a) => {
      const rel = a.path!.replace(/\\/g, '/').split('/test-results/').pop() ?? a.path!;
      return context.artifactBaseUrl
        ? { label: a.name, href: `${context.artifactBaseUrl.replace(/\/+$/, '')}/${rel}` }
        : { label: `${a.name}: test-results/${rel}` };
    });

  const annotations = test.annotations
    .filter((a) => a.type !== 'known-issue')
    .map((a) => ({ label: `${a.type}${a.description ? `: ${a.description}` : ''}` }));

  const blocks: Block[] = [
    { t: 'p', text: 'Automated test failure in the Focus suite.', bold: true },
    { t: 'heading', text: 'What failed' },
    { t: 'p', text: headline },
    {
      t: 'kv',
      rows: [
        ['Test', titlePath],
        ['Spec', specPath],
        ['Environment', context.baseUrl],
        ['Browser project', context.projectName],
        ['Run', context.runLabel],
        ['Duration', `${Math.round(result.duration)} ms`],
        ['Retries', String(result.retry)],
      ],
    },
    { t: 'heading', text: 'Error' },
    { t: 'code', text: errorText.slice(0, 4000) },
    { t: 'heading', text: 'Reproduce locally' },
    {
      t: 'code',
      text: `npx playwright test --project=${context.projectName} "${specPath}" -g "${test.title}"`,
    },
  ];

  if (artifacts.length) {
    blocks.push({ t: 'heading', text: 'Artifacts' }, { t: 'list', items: artifacts });
  }
  if (annotations.length) {
    blocks.push({ t: 'heading', text: 'Annotations' }, { t: 'list', items: annotations });
  }

  blocks.push(
    { t: 'rule' },
    {
      t: 'small',
      text:
        'Filed automatically by the Focus Playwright suite. Do not edit the marker below — ' +
        `it is how repeat failures are matched to this defect.  ${fingerprint}`,
    },
  );

  return {
    // Keep the title stable across runs: no timestamps, no durations, nothing
    // run-specific. A searchable, repeatable title is worth more than a vivid one.
    name: truncate(`[Focus autotest] ${titlePath}`, 190),
    description: renderHtml(blocks),
    text: renderText(blocks),
    fingerprint,
  };
}

/**
 * The defect raised when the whole run collapses.
 *
 * Filing one of these instead of N individual defects is the difference between
 * a useful integration and one everyone mutes: forty tests failing at once is
 * one environment problem, not forty bugs.
 */
export function buildRunFailureDefect(
  failures: Array<{ test: TestCase; result: TestResult }>,
  context: RunContext,
  totalTests: number,
): DefectDraft {
  const fingerprint = `${FINGERPRINT_PREFIX}:runwide:${createHash('sha1')
    .update(`${context.projectName}::${context.baseUrl}`)
    .digest('hex')
    .slice(0, 12)}`;

  const blocks: Block[] = [
    { t: 'p', text: `${failures.length} of ${totalTests} tests failed in a single run.`, bold: true },
    {
      t: 'p',
      text:
        'Individual defects were NOT filed. A failure rate this high almost always means ' +
        'one shared cause — the environment being down, a deployment in progress, or an ' +
        'auth/network change — rather than many independent bugs. Triage the run first; if ' +
        'there really are separate defects, file them from the report.',
    },
    {
      t: 'kv',
      rows: [
        ['Environment', context.baseUrl],
        ['Browser project', context.projectName],
        ['Run', context.runLabel],
        ['Failed', `${failures.length} / ${totalTests}`],
      ],
    },
    { t: 'heading', text: 'Failing tests' },
    {
      t: 'list',
      items: failures.slice(0, 40).map((f) => ({ label: f.test.titlePath().filter(Boolean).join(' › ') })),
    },
  ];

  if (failures.length > 40) {
    blocks.push({ t: 'p', text: `…and ${failures.length - 40} more.` });
  }

  blocks.push({ t: 'rule' }, { t: 'small', text: fingerprint });

  return {
    name: truncate(`[Focus autotest] Run-wide failure: ${failures.length}/${totalTests} tests failed`, 190),
    description: renderHtml(blocks),
    text: renderText(blocks),
    fingerprint,
  };
}
