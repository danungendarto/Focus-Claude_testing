#!/usr/bin/env node
/**
 * Read-only Axosoft connectivity check. Creates nothing.
 *
 * Run this BEFORE enabling defect filing:
 *
 *   node scripts/verify-axosoft.mjs
 *
 * It authenticates, lists your projects and priorities so you can fill in the
 * ids, and probes whether free-text search works — which is what deduplication
 * depends on. If any of that is wrong for your instance, you find out here
 * rather than after forty duplicate defects.
 *
 * Plain .mjs on purpose: it runs with bare `node`, no build step, so it still
 * works when the TypeScript build is broken.
 */

const env = process.env;
const baseUrl = (env.AXOSOFT_URL ?? '').replace(/\/+$/, '');
const apiVersion = env.AXOSOFT_API_VERSION ?? 'v5';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

if (!baseUrl) {
  bad('AXOSOFT_URL is not set.');
  info('Set it to your Axosoft base URL, e.g. https://acme.axosoft.com');
  info('Copy .env.example to .env and fill it in, then re-run.');
  process.exit(1);
}

async function getToken() {
  if (env.AXOSOFT_TOKEN) return { token: env.AXOSOFT_TOKEN, how: 'pre-supplied access token' };

  const { AXOSOFT_CLIENT_ID, AXOSOFT_CLIENT_SECRET, AXOSOFT_USERNAME, AXOSOFT_PASSWORD } = env;
  if (!AXOSOFT_CLIENT_ID || !AXOSOFT_CLIENT_SECRET || !AXOSOFT_USERNAME || !AXOSOFT_PASSWORD) {
    throw new Error(
      'Credentials incomplete — need AXOSOFT_CLIENT_ID, AXOSOFT_CLIENT_SECRET, ' +
        'AXOSOFT_USERNAME and AXOSOFT_PASSWORD.',
    );
  }

  const params = {
    grant_type: 'password',
    client_id: AXOSOFT_CLIENT_ID,
    client_secret: AXOSOFT_CLIENT_SECRET,
    username: AXOSOFT_USERNAME,
    password: AXOSOFT_PASSWORD,
    scope: 'read write',
  };

  // POST first so the password stays out of URLs and logs; fall back to the
  // GET form Axosoft documents if this instance rejects POST.
  const url = `${baseUrl}/api/oauth2/token`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).catch(() => null);

  let usedGet = false;
  if (!res || !res.ok) {
    res = await fetch(`${url}?${new URLSearchParams(params)}`, { method: 'GET' });
    usedGet = true;
  }

  if (!res.ok) {
    throw new Error(`Token request returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error('Response contained no access_token');

  return {
    token: body.access_token,
    how: `OAuth2 password grant (via ${usedGet ? 'GET' : 'POST'})`,
    user: body.data ? `${body.data.first_name ?? ''} ${body.data.last_name ?? ''}`.trim() : null,
  };
}

async function api(token, path) {
  const res = await fetch(`${baseUrl}/api/${apiVersion}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  console.log(`\nChecking Axosoft at ${baseUrl} (API ${apiVersion})`);

  heading('1. Authentication');
  let token, how, user;
  try {
    ({ token, how, user } = await getToken());
    ok(`authenticated via ${how}${user ? ` as ${user}` : ''}`);
  } catch (error) {
    bad(`authentication failed: ${error.message}`);
    info('');
    info('Axosoft has no "personal access token", and API keys are NOT under');
    info('your avatar menu. They live here:');
    info('');
    info('  Tools  →  System Settings  →  Axosoft API Settings');
    info('    1. tick "Enable Axosoft API"');
    info('    2. click "Manage API Keys"  →  Add / Generate New API Keys');
    info('    3. register it as a PRIVATE application');
    info('       (the username/password grant only works for private apps)');
    info('');
    info('Your version may label that menu "System Options" instead of');
    info('"System Settings" — they are the same thing. Hover it to expand;');
    info('"Axosoft API Settings" sits alongside General, System Labels,');
    info('Field Names, Details Panel, SMTP Server and Localization.');
    info('');
    info('That gives you AXOSOFT_CLIENT_ID and AXOSOFT_CLIENT_SECRET.');
    info('AXOSOFT_USERNAME / AXOSOFT_PASSWORD are your own Axosoft login.');
    info('');
    info('If "System Settings" is greyed out, you lack the permission to');
    info('reach it — ask whoever administers your Axosoft account.');
    process.exit(1);
  }

  heading('2. Projects — put the right id in AXOSOFT_PROJECT_ID');
  const projects = await api(token, '/projects');
  if (!projects.ok) {
    bad(`GET /projects returned ${projects.status}`);
    info(projects.text.slice(0, 300));
    info('If this is a 404, your instance may use a different API version.');
    info('Try AXOSOFT_API_VERSION=v6 and re-run.');
    process.exit(1);
  }
  const projectList = projects.json?.data ?? [];
  ok(`${projectList.length} project(s) visible`);
  for (const p of projectList.slice(0, 25)) info(`id=${p.id}  ${p.name}`);

  const configuredProject = Number(env.AXOSOFT_PROJECT_ID);
  if (configuredProject) {
    const match = projectList.find((p) => p.id === configuredProject);
    if (match) ok(`AXOSOFT_PROJECT_ID=${configuredProject} resolves to "${match.name}"`);
    else bad(`AXOSOFT_PROJECT_ID=${configuredProject} is not in the list above`);
  } else {
    info('AXOSOFT_PROJECT_ID is not set yet — pick one from the list.');
  }

  heading('3. Priorities — optional, for AXOSOFT_PRIORITY_ID');
  const priorities = await api(token, '/picklists/priorities');
  if (priorities.ok) {
    const list = priorities.json?.data ?? [];
    ok(`${list.length} priority value(s)`);
    for (const p of list.slice(0, 15)) info(`id=${p.id}  ${p.name}`);
  } else {
    info(`GET /picklists/priorities returned ${priorities.status} — skip AXOSOFT_PRIORITY_ID.`);
  }

  heading('4. Defect listing and search (deduplication depends on this)');
  const defects = await api(token, '/defects?page_size=1&columns=id,name');
  if (!defects.ok) {
    bad(`GET /defects returned ${defects.status}`);
    info(defects.text.slice(0, 300));
  } else {
    ok('defects are readable');

    // Deduplication relies on search_string actually filtering. If the server
    // ignores it, an unmatchable string still returns rows -- and dedup would
    // silently treat every new failure as a duplicate.
    const nonsense = 'focus-autotest-fp:zzzzzzzzzzzz';
    const search = await api(
      token,
      `/defects?search_string=${encodeURIComponent(nonsense)}&columns=id&page_size=5`,
    );
    const hits = search.json?.data?.length ?? 0;

    if (!search.ok) {
      bad(`search_string query returned ${search.status} — dedup will not work`);
      info('Fix this before enabling filing, or you will get duplicate defects.');
    } else if (hits === 0) {
      ok('search_string filters correctly — deduplication will work');
    } else {
      bad(`search_string appears to be ignored (${hits} rows for a nonsense term)`);
      info('Deduplication cannot be trusted on this instance.');
      info('Consider a custom field for the fingerprint instead, and adjust');
      info('findDefectsByFingerprint() in src/reporting/axosoft-client.ts.');
    }
  }

  heading('Summary');
  if (env.AXOSOFT_CREATE_DEFECTS === '1') {
    console.log('  AXOSOFT_CREATE_DEFECTS=1 — a failing run WILL create defects.');
  } else {
    console.log('  AXOSOFT_CREATE_DEFECTS is not 1 — runs stay in dry-run mode.');
    console.log('  Do a dry run first:  npm test');
  }
  console.log('');
}

main().catch((error) => {
  bad(`unexpected error: ${error.message}`);
  process.exit(1);
});
