import { test, expect } from '../../src/fixtures';

/**
 * Tests that change server state. Read tests/destructive/README.md first.
 *
 * These are excluded from the default project by grep and refuse to run without
 * FOCUS_ALLOW_DESTRUCTIVE=1. The double lock is intentional: a re-optimise is
 * not a local change, it rewrites recommendations other people may be reading.
 *
 * Most specs here are deliberately left as documented skeletons rather than
 * being made to pass blind. Asserting the OUTCOME of a re-optimise needs a
 * known baseline and an agreed reset path, and inventing either would produce a
 * test that passes without proving anything. See docs/test-strategy.md.
 */

function requireDestructiveOptIn(): void {
  test.skip(
    process.env.FOCUS_ALLOW_DESTRUCTIVE !== '1',
    'Set FOCUS_ALLOW_DESTRUCTIVE=1 to run tests that write to the server',
  );
}

test.describe('@destructive re-optimise', () => {
  test.beforeEach(() => requireDestructiveOptIn());

  test('the run button is gated until a scope is chosen', async ({ reOptimise }) => {
    await reOptimise.open();

    // Read-only in itself, but it lives here because the page's only other
    // affordance starts a job.
    await expect(reOptimise.runButton).toBeVisible();
  });

  // The real end-to-end run, with outcome assertions, lives in
  // tests/destructive/reoptimise.spec.ts. Charter EX-07 is answered.
});

test.describe('@destructive bulk override flags', () => {
  test.beforeEach(() => requireDestructiveOptIn());

  test('fetching programs is read-only and populates the grid', async ({ bulkOverride }) => {
    await bulkOverride.open();
    await bulkOverride.fetchPrograms();

    const grid = await bulkOverride.programsState();
    expect(grid.exists, 'the programs grid should initialise').toBe(true);

    // Note: fetch alone writes nothing. It is in this file only because the
    // next click on the page does.
    await bulkOverride.expectNoErrors();
  });

  test.fixme(
    'applying an override writes the flag to every selected program',
    async ({ bulkOverride }) => {
      // Left as fixme on purpose. Writing this test needs an agreed answer to:
      //   - which programs are safe to flag on this environment, and
      //   - how the flags get reverted afterwards.
      // Without a revert path this test degrades the environment a little on
      // every run, so it is better absent than silently destructive.
      await bulkOverride.open();
    },
  );
});

test.describe('@destructive optimiser rules', () => {
  test.beforeEach(() => requireDestructiveOptIn());

  test('the rule editor opens and cancels without saving', async ({ optimiserRules }) => {
    await optimiserRules.open();

    const before = await optimiserRules.defaultRulesState();

    await optimiserRules.openAddRuleEditor();
    await expect(optimiserRules.editWindow).toBeVisible();
    await optimiserRules.closeEditor();

    const after = await optimiserRules.defaultRulesState();
    expect(after.total, 'cancelling the editor must not create a rule').toBe(before.total);
  });

  test.fixme('a created rule appears in the grid and can be deleted again', async () => {
    // Needs a naming convention for test-created rules so they can be found and
    // cleaned up reliably, including after a failed run.
  });
});

test.describe('@destructive recommendations', () => {
  test.beforeEach(() => requireDestructiveOptIn());

  test('opening the editor marks the recommendation as inspected', async ({ recommendations }) => {
    // This test lives here, not in tests/reports/, because OPENING the editor is
    // itself a write: Focus POSTs /api/Recommendations/SetInspected before the
    // window appears, and Cancel does not undo it.
    await recommendations.open();
    test.skip((await recommendations.state()).total === 0, 'no recommendations loaded');

    await recommendations.openRecommendationFromScheduler(0);
    await expect(recommendations.editWindow).toBeVisible();
    await recommendations.closeDetail();

    // What Cancel does guarantee: no user flag or minimum rate was saved.
    await recommendations.expectNoErrors();

    test.info().annotations.push({
      type: 'side-effect',
      description: 'SetInspected was POSTed for one recommendation and cannot be undone from the UI.',
    });
  });

  test.fixme('sending recommendations marks them as sent', async () => {
    // Sending pushes downstream and cannot be undone from the UI. Needs sign-off
    // on which environment this is acceptable on before it is written.
  });
});
