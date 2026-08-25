# Focus write surface — what changes data, and what only looks like it does

**Read this before clicking around Focus, manually or in a test.**

Focus presents almost everything as a report. Several pages write anyway, and
two of the writes have no visible trigger at all. This page is the consolidated
answer to "is it safe to click that?".

Everything below was verified against the running app on 25 Aug 2026 (Focus
3.4.0.53) by reading the shipped bundles and watching the network.

---

## The short version

| Colour | Meaning |
|---|---|
| 🟢 | Read-only. Click freely. |
| 🟡 | Read-only, but sits next to something that writes. |
| 🔴 | **Writes. No undo in the UI.** |

| Page | Control | | What actually happens |
|---|---|---|---|
| All report pages | filters, sorting, Export | 🟢 | GET only. Export renders the current grid client-side. |
| Optimiser Rules | tabs, grids, scheduler | 🟢 | GET only. |
| Optimiser Rules | **Add / edit rule → Ok** | 🔴 | Writes an optimiser rule. Cancel is safe. |
| Optimiser Rules | rule row → Delete | 🔴 | `DELETE /api/OptimiserRule` |
| Re-Optimise | every filter | 🟢 | Only `GET /api/ReOptimise/HasHeadroomBudgets` |
| Re-Optimise | **Re-Optimise button** | 🔴 | `POST /api/ReOptimise` — recalculates recommendations for the scope |
| Bulk Override | filters, **Fetch** | 🟢 | Querying only. |
| Bulk Override | **Override button** | 🔴 | `POST /api/BulkOverrideFlags` across every selected program |
| Recommendations | filters, sorting, Export | 🟢 | GET only. |
| Recommendations | **Send** | 🔴 | `POST /api/Recommendations/SendAndMark` — pushes downstream |
| Recommendations | **Bulk Override** | 🔴 | Writes override flags across the selection |
| Recommendations | **inline flag / min-rate cells** | 🔴 | `POST .../UserFlags` or `/UserMinRate` **on change** — no save step |
| Recommendations | **opening the editor** | 🔴 | `POST /api/Recommendations/SetInspected` **before the window appears** |
| Forecast | editor → Save | 🔴 | `POST` / `PUT /api/forecast` |
| Forecast Blacklists | delete | 🔴 | `DELETE /api/Blacklist` |
| Grid Maintenance | save | 🔴 | `POST` / `PUT /api/gridmaintenance` |

---

## The two invisible writes

These are the ones that catch people out, because nothing on screen suggests a
write is happening.

### 1. Opening a recommendation marks it inspected

The recommendation editor is reached by clicking an event in the
**Schedule View** tab. Focus does this on the way in:

```js
if (!item.inspected) {
  item.inspected = true;
  await controller.setProgramInspectedFlag(item.schedulerProgramId); // POST
}
await this.loadEditor(item.schedulerProgramId);
```

The POST fires **before the window opens**, and **Cancel does not undo it**.
"I only looked at it and cancelled" is not accurate — the record has changed and
there is no way to reset it from the UI.

Consequence for exploratory testing: browsing recommendations by opening them
changes data. Explore via the API or the grid instead.

### 2. Grid cells save as you type

The Recommendations grid has inline editors for **user flag** and **minimum
rate**. They POST on the widget's `change` event. There is no save button, no
confirmation, and no visual difference from a read-only cell.

---

## Verb-split endpoints

Two paths serve both a read and a write, separated only by the HTTP verb:

| Path | GET | POST |
|---|---|---|
| `/api/ReOptimise` | — (see sub-routes) | **starts the job** |
| `/api/ReOptimise/HasHeadroomBudgets` | read-only check | — |
| `/api/ReOptimise/Status` | read-only progress poll | — |
| `/api/BulkOverrideFlags` | read-only progress poll | **performs the override** |

So *loading these pages and changing their filters is safe.* Only the on-screen
action button writes.

(An earlier version of these notes claimed these were GETs that mutate. That was
wrong — corrected 25 Aug 2026.)

---

## What a re-optimise actually does

Verified by a supervised run: Channel 7, markets SUN + WID, 31 May – 6 Jun 2026,
Mon/Tue/Thu, 2000–2030 — two recommendations in scope.

| Observable | Before | After |
|---|---|---|
| `runId`, in-scope rows | 22038 | **22039** |
| `runId`, same markets/week, wider day+time | 22038 | 22038 and 22039 — only the 2 moved |
| `runId`, different market | 22038 | 22038 |
| `runId`, different week | 22038 | 22038 |
| `lastPartialOptimiseDate` | 14/07 11:18 | **25/08 11:54** |
| `lastFullOptimiseDate` | 15/07 06:48 | unchanged |
| flags, discounts, row count | — | **unchanged** |

**The scope is honoured exactly.** Nothing outside the selected market, week,
day-of-week or time window was touched.

**But the recommendation values need not change.** A run that changes nothing is
still a successful run, so *"the recommendations changed"* is not a valid
post-condition. The dependable signature is:

> new `runId` in scope **+** old `runId` out of scope **+** partial timestamp advanced

That is what `tests/destructive/reoptimise.spec.ts` asserts.

---

## Running the destructive tests

Double-gated on purpose — the project grep excludes `@destructive`, and each
spec also requires an explicit opt-in:

```bash
FOCUS_ALLOW_DESTRUCTIVE=1 npm run test:destructive
```

They run single-worker and non-parallel: concurrent optimisation jobs on one
environment interfere with each other and with anyone else using the box.

Before running:

1. **Confirm the environment.** These target `vst-focus-seven`. Never production.
2. **Tell whoever else is using it** — a re-optimise changes what they see
   mid-session.
3. **Know the reset path.** Focus has no undo. Restoring means a database
   restore or re-import; the footer shows the current snapshot date.
4. **Keep the scope narrow.** One channel, one or two markets, one week. The
   verified run above touched exactly two recommendations.

## Adding a new destructive test

- Tag it `@destructive` in the title.
- Call `requireDestructiveOptIn()` at the top.
- Capture a **baseline via the API first**, then act, then diff. Without a
  baseline the only available assertion is "it did not crash", which proves
  nothing.
- Assert the **negative** as well as the positive: that things outside the scope
  did *not* change. A write that quietly widens its blast radius is the serious
  failure, and the UI will not reveal it.
