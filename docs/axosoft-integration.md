# Filing defects into Axosoft automatically

A custom Playwright reporter (`src/reporting/axosoft-reporter.ts`) watches the
run and creates Axosoft defects for failures, over Axosoft's REST API.

The API calls are the easy part. **The hard part is not filing hundreds of
defects**, and that is what most of this design is about.

## Setup

### 1. Get credentials

**Axosoft has no "personal access token" feature**, and API keys are *not* under
your avatar menu. They are generated in the admin area, and you need
**Administrator** permission to reach it:

> **Tools** → **System Settings** → **Axosoft API Settings**
> 1. tick **Enable Axosoft API**
> 2. click **Manage API Keys** → **Add** / **Generate New API Keys**
> 3. register the key as a **private** application

Depending on your Axosoft version the second menu item is labelled either
**System Settings** or **System Options** — they are the same thing, and
Axosoft's own documentation uses both names. It expands into a list of seven
sections; **Axosoft API Settings** is one of them, alongside General, System
Labels, Field Names, Details Panel, SMTP Server and Localization.

Step 3 matters: Axosoft only permits the username/password grant for *private*
client applications. A key registered as public will authenticate correctly in a
browser flow and fail here.

That gives you a **Client ID** and **Client Secret**. Combined with an Axosoft
login (`AXOSOFT_USERNAME` / `AXOSOFT_PASSWORD`), the reporter exchanges them for
a bearer token on each run.

If **System Settings** is greyed out in your Tools menu, you do not have the
permission to reach it — ask whoever administers your Axosoft account. They only
need to do it once, and can hand you the client id and secret. (Items like
**Manage Account** and **Manage Extensions** are commonly greyed out for
non-owners; that on its own does not mean you lack API access.)

Two practical notes:

- **Use a dedicated service account** for `AXOSOFT_USERNAME` if you can, so
  defects are attributed to automation rather than to a person, and so rotating
  the password doesn't mean changing someone's login.
- The account needs permission to **create defects** in the target project.
  Read-only access authenticates fine and then fails at filing time.


### If System Settings is greyed out

Then you don't have the permission, and no amount of clicking will help — an
Axosoft administrator has to do it once. Here is a request you can forward:

> **Subject: Axosoft API key for automated test defect filing**
>
> I'm setting up our Playwright test suite for Focus to raise defects in Axosoft
> automatically. That needs an API key, and **System Settings** is greyed out for
> my account.
>
> Could you please:
>
> 1. Go to **Tools → System Settings → Axosoft API Settings**
> 2. Tick **Enable Axosoft API**
> 3. **Manage API Keys → Add**, and register it as a **private** application
>    (the username/password grant only works for private apps)
> 4. Send me the **Client ID** and **Client Secret**
>
> Two optional extras that would help:
>
> - A dedicated Axosoft user (e.g. "Focus Automation") with permission to create
>   defects in the Focus project, so automated defects are attributed to the
>   automation rather than to me.
> - Confirmation of which project the defects should go into.
>
> I don't need your password — I authenticate with my own login (or the service
> account's). The client id and secret are the only things I can't generate
> myself.

Nothing else is blocked in the meantime: see below.

### Working without an API key

Every failing run writes **`test-results/axosoft-defects.md`** regardless of
whether Axosoft is configured:

```
[axosoft] draft defects written to test-resultsaxosoft-defects.md — paste-ready, no API key needed
```

Each entry has the defect **Name** as a heading and a plain-text **Description**
underneath — headline, context table, full error, a copy-pasteable reproduce
command, and artifact paths. Paste them straight into Axosoft.

Keep the `focus-autotest-fp:…` marker at the bottom when you paste. It is what
lets the automated filing recognise the same failure later and comment on your
manually-raised defect instead of creating a duplicate. So work done by hand now
is not thrown away when the key arrives.

### 2. Configure

```bash
cp .env.example .env
```

Fill in `AXOSOFT_URL`, the four credential variables, and
`AXOSOFT_PROJECT_ID`. Leave `AXOSOFT_CREATE_DEFECTS=0` for now. `.env` is
gitignored.

### 3. Verify — read-only, creates nothing

```bash
npm run axosoft:verify
```

This authenticates, lists your projects and priorities (so you can fill in the
ids), and — importantly — **checks that free-text search actually filters**.
Deduplication depends on it. If your instance ignores `search_string`, the script
says so, and you must fix that before enabling filing or you'll get duplicates.

It also catches the two common setup mistakes: a version mismatch (if
`/api/v5/projects` 404s, set `AXOSOFT_API_VERSION=v6`), and an API key
registered as a *public* rather than private application, which makes the
password grant fail.

On failure it prints the full admin navigation path, so you can forward it to
whoever administers your Axosoft.

### 4. Dry run

```bash
npm test
```

With `AXOSOFT_CREATE_DEFECTS=0` the reporter prints what it *would* file:

```
[axosoft] DRY RUN — 2 defect(s) would be filed. Set AXOSOFT_CREATE_DEFECTS=1 to file them for real.
[axosoft]   • [Focus autotest] @integrity inventory arithmetic › paid + bonus …   [focus-autotest-fp:6b68496c6e77]
```

### 5. Enable, in CI only

```bash
AXOSOFT_CREATE_DEFECTS=1 npm test
```

Set this in your CI job, **not** on developer machines. Otherwise every local
run of a work-in-progress test files a defect.

## The rules that keep it useful

These are the difference between an integration a team keeps on and one they
mute after the first bad night.

### Only unexpected failures

The reporter uses Playwright's own `test.outcome()`, which already excludes:

- **skipped** tests
- **flaky** tests that passed on retry — reported, not filed. Flakiness is worth
  investigating; it is not a product defect.
- **`@known-issue` specs failing as expected.** Our `test.fail()` specs are
  *supposed* to fail while the bug is open. Re-filing KI-001 every night would be
  the fastest possible way to get this integration switched off.

### An unexpected *pass* is not a defect

When a `test.fail()` known-issue spec starts passing, the bug has been **fixed**.
Filing a defect saying "a test passed" would be nonsense. Instead:

```
[axosoft] KNOWN ISSUE APPEARS FIXED — "FOCUS-KI-003 an unknown channelId should not
produce a 500" passed while marked test.fail(). Remove its entry from
src/data/known-issues.ts and delete the spec. No defect filed.
```

### Deduplication by fingerprint

Every defect carries a marker in its description:

```
focus-autotest-fp:6b68496c6e77
```

It is a hash of the **spec file path plus the test title chain** — deliberately
*not* the error message (changes between runs) and *not* the line number (shifts
when anyone edits the file above it). Either would break matching and produce a
fresh duplicate every night.

Before filing, the reporter searches for that marker. On a match it **adds a
comment** to the existing defect instead of creating a new one:

```
[axosoft] recurring → commented on defect 4821 (In Progress): https://acme.axosoft.com/viewitem?id=4821&type=defects
```

If the match is a *closed* defect, the workflow step is printed alongside it —
that is your regression signal.

### The circuit breaker ⭐

The most important rule. Above **8 failures** or **25% of the suite** (both
configurable), the reporter files **one run-wide defect** instead of one per test:

```
[axosoft] 34 of 67 tests failed. Filing ONE run-wide defect instead of one per
test — this pattern is usually a single shared cause.
```

Thirty-four simultaneous failures is Focus being down, a deployment in flight, or
a network change. It is one problem, not thirty-four bugs. Without this, the
first bad night buries the tracker and everyone stops trusting the automation.

Tune with `AXOSOFT_MAX_DEFECTS` and `AXOSOFT_MAX_FAILURE_RATIO`.

### Tracker problems never fail the test run

If Axosoft is unreachable or rejects a payload, the reporter prints a warning and
leaves the exit code alone. A green test run must not go red because a tracker
was down.

## What a filed defect contains

- **Title** — stable and searchable: `[Focus autotest] <full test path>`. No
  timestamps or durations, so the same failure always produces the same title.
- **Headline** — the assertion message, which is why the custom messages in our
  specs (`row "Seven News": sold and unsold inventory must account for capacity`)
  matter: they become the defect summary.
- **Context table** — environment, browser project, CI run, duration, retries.
- **Full error and stack.**
- **A copy-pasteable reproduce command.**
- **Artifact links** — trace, screenshot, video. Set `FOCUS_ARTIFACT_BASE_URL` to
  where CI publishes `test-results/` and these become clickable; otherwise they
  are listed as paths.

## Before you trust it

**Axosoft's API shape varies by version and install.** Everything
version-specific is confined to `src/reporting/axosoft-client.ts` and marked with
`VERIFY:` comments. The four things to confirm against your instance:

1. **The token endpoint verb.** Axosoft documents `/api/oauth2/token` as a
   **GET** with query parameters — which would put the password in server and
   proxy logs. The client tries **POST** with a form body first and falls back to
   the documented GET only if the server rejects it, so credentials stay out of
   logs wherever the server allows it.
2. **The create payload envelope.** The client posts `{ item: { … } }` to
   `/defects`. If your instance rejects it, the error body names the offending
   field — adjust `createDefect()`.
3. **`search_string` filtering** — checked by `npm run axosoft:verify`.
4. **The notes endpoint** for recurrence comments (`/defects/{id}/notes`).

There is a deliberate guard in `findDefectsByFingerprint`: if a search returns
more than 20 rows it is treated as no match, because a 12-hex-character
fingerprint cannot legitimately match that many. That prevents a server which
silently ignores the search filter from making every new failure look like a
duplicate.

## Suggested rollout

1. Run `npm run axosoft:verify` and fix anything it flags.
2. Dry-run for a week. Read the `[axosoft]` lines. Are those defects you would
   actually want raised?
3. Point it at a **sandbox Axosoft project** first and enable for real. Check the
   formatting, dedup on a second run, and the recurrence comment.
4. Switch to the real project, in CI only.
5. Review the circuit-breaker thresholds after a month against real failure
   patterns.

## Extending it

- **Attachments.** Traces and screenshots are currently *linked*, not uploaded.
  If you want them in the ticket, add an upload call — but check the file-size
  limits, Playwright traces get large.
- **Severity mapping.** All defects file at the default priority. The suite
  already carries tags (`@integrity`, `@smoke`, `@api`); mapping `@integrity`
  failures to a higher priority would be reasonable, since a wrong number matters
  more than a slow page.
- **Auto-close.** When a fingerprint's test passes again, you could move the
  defect along its workflow. Worth doing carefully — a test passing once is not
  proof the bug is gone.
