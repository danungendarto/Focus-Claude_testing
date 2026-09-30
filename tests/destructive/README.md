# Destructive tests

Everything in this folder changes server state. None of it runs in the default
suite.

> **The full write-surface map — including the two writes with no visible
> trigger — lives in [`docs/write-surface.md`](../../docs/write-surface.md).**
> Read that first; this file covers only how to run these specs.

## What "destructive" means here

| Spec area | What it writes |
|---|---|
| Re-Optimise | Starts a server-side optimisation job that **rewrites recommendations** for the selected channel/market/date scope. |
| Bulk Override Flags | Writes override flags across **every selected program**, in bulk. |
| Optimiser Rules | Creates, edits and deletes optimiser rules, which change how future optimisation runs behave. |
| Recommendations | Sends recommendations downstream, and edits user flags / max discounts. |
| Forecast | Creates, updates and deletes forecasts and blacklists. |

A re-optimise in particular is not a local change: it recalculates
recommendations that other people may be reading or acting on.

## Running them

Two locks, both deliberate. The project grep already excludes `@destructive`,
and each spec additionally refuses to run without an explicit opt-in variable:

```bash
FOCUS_ALLOW_DESTRUCTIVE=1 npm run test:destructive
```

They also run single-worker and non-parallel (see `playwright.config.ts`),
because concurrent optimisation jobs on one environment interfere with each
other and with anyone else using the box.

## Before you run them

1. **Confirm the target environment.** These are written against
   `vst-focus-seven`, a test instance. Never point them at production.
2. **Tell whoever else is using the environment.** A re-optimise changes what
   they see mid-session.
3. **Know the reset path.** Focus has no undo in the UI. Restoring means a
   database restore or a re-import, so check that a recent snapshot exists
   first — the footer shows the current one.

## Writing new ones

- Tag the test `@destructive` in its title.
- Call `requireDestructiveOptIn()` at the top of the spec.
- Prefer the narrowest scope that still exercises the feature: one channel, one
  market, one day — not "all". The verified re-optimise run touched exactly two
  recommendations.
- **Capture a baseline via the API first**, then act, then diff. Without a
  baseline the only available assertion is "it did not crash".
- **Assert the negative too** — that things outside the scope did *not* change.
  A write that quietly widens its blast radius is the serious failure, and the
  UI will not reveal it. `reoptimise.spec.ts` is the worked example.
- Do not assert that values changed. A re-optimise that changes nothing is still
  a successful run; assert the run *happened* (new `runId`, advanced timestamp)
  rather than that it had an effect.
