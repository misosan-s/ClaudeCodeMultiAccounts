const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'cc-switch.cjs');
const NOW = Date.now();

function makeFixtures({ storedSlotExpired = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-cli-test-'));
  const configPath = path.join(dir, '.claude.json');
  const credentialsPath = path.join(dir, '.credentials.json');
  const storePath = path.join(dir, 'store.json');
  const backupDir = path.join(dir, 'backups');

  const config = {
    oauthAccount: {
      accountUuid: 'uuid-live-a',
      emailAddress: 'live-a@test.com',
      organizationRole: 'admin',
    },
    unrelatedTopLevelKey: 'must-survive',
  };

  const credentials = {
    claudeAiOauth: {
      accessToken: 'live-access-a',
      refreshToken: 'live-refresh-a',
      expiresAt: NOW + 3600000,
      refreshTokenExpiresAt: NOW + 86400000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: 'default',
    },
    futureCcSiblingKey: { deviceId: 'must-survive' },
  };

  const storedSlot = {
    key: 'uuid:uuid-stored-b',
    metadata: { accountUuid: 'uuid-stored-b', emailAddress: 'stored-b@test.com' },
    credentials: {
      claudeAiOauth: {
        accessToken: 'stored-access-b',
        refreshToken: 'stored-refresh-b',
        expiresAt: storedSlotExpired ? NOW - 3600000 : NOW + 3600000,
        refreshTokenExpiresAt: storedSlotExpired ? NOW - 1000 : NOW + 86400000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_5x',
      },
    },
    capturedAt: new Date(NOW - 100000).toISOString(),
    lastSyncedAt: new Date(NOW - 100000).toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf8');
  fs.writeFileSync(storePath, JSON.stringify({ version: '0.2.9', accounts: [storedSlot] }, null, 2), 'utf8');

  return { dir, configPath, credentialsPath, storePath, backupDir };
}

// The CLI must never reach the real Orca or restart a real session from tests:
// drop Orca's terminal markers and CLAUDE_PID, and point the Orca CLI at a path
// that does not exist. `inOrca` adds back only the profile pointer marker.
function testEnv(fixtures, { inOrca = false } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^ORCA_/i.test(key) && key.toUpperCase() !== 'CLAUDE_PID') {
      env[key] = value;
    }
  }
  env.CCS_ORCA_CLI = path.join(fixtures.dir, 'missing-orca.exe');
  if (inOrca) {
    env.ORCA_CLAUDE_PROFILE_POINTER = path.join(fixtures.dir, 'selected-host');
  }
  return env;
}

function runCli(fixtures, args, envOptions) {
  return execFileSync(process.execPath, [
    CLI,
    ...args,
    '--config', fixtures.configPath,
    '--credentials', fixtures.credentialsPath,
    '--store', fixtures.storePath,
    '--backup-dir', fixtures.backupDir,
  ], { encoding: 'utf8', env: testEnv(fixtures, envOptions) });
}

test('switch to valid stored slot: swaps both live files, preserves siblings, no re-login path', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['0']);

  assert.match(output, /Switched active account to \[0\]/);

  const config = JSON.parse(fs.readFileSync(fixtures.configPath, 'utf8'));
  assert.strictEqual(config.oauthAccount.accountUuid, 'uuid-stored-b');
  assert.strictEqual(config.unrelatedTopLevelKey, 'must-survive');

  const credentials = JSON.parse(fs.readFileSync(fixtures.credentialsPath, 'utf8'));
  assert.strictEqual(credentials.claudeAiOauth.accessToken, 'stored-access-b');
  assert.deepStrictEqual(credentials.futureCcSiblingKey, { deviceId: 'must-survive' });

  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  assert.strictEqual(store.accounts.length, 2);
  const outgoing = store.accounts.find((e) => e.key === 'uuid:uuid-live-a');
  assert.ok(outgoing, 'outgoing live account must be captured into the store before switching');
  assert.strictEqual(outgoing.credentials.claudeAiOauth.accessToken, 'live-access-a');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('switch to dead slot (refresh token expired): aborts, live files untouched, exit 1', () => {
  const fixtures = makeFixtures({ storedSlotExpired: true });
  const configBefore = fs.readFileSync(fixtures.configPath, 'utf8');
  const credentialsBefore = fs.readFileSync(fixtures.credentialsPath, 'utf8');

  let failed = null;
  try {
    runCli(fixtures, ['0']);
  } catch (error) {
    failed = error;
  }

  assert.ok(failed, 'CLI must exit non-zero');
  assert.strictEqual(failed.status, 1);
  assert.match(String(failed.stdout), /Switch aborted/);
  assert.match(String(failed.stdout), /\/login/);

  assert.strictEqual(fs.readFileSync(fixtures.configPath, 'utf8'), configBefore);
  assert.strictEqual(fs.readFileSync(fixtures.credentialsPath, 'utf8'), credentialsBefore);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('regression: sync captures live account into store', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['sync']);

  assert.match(output, /Synced current account/);
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  assert.ok(store.accounts.some((e) => e.key === 'uuid:uuid-live-a'));

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('switch outside Orca with no Orca CLI: succeeds (exit 0) and says nothing about Orca', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['0']);

  assert.match(output, /Switched active account to \[0\]/);
  assert.doesNotMatch(output, /Orca/);
  const config = JSON.parse(fs.readFileSync(fixtures.configPath, 'utf8'));
  assert.strictEqual(config.oauthAccount.accountUuid, 'uuid-stored-b');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('switch inside an Orca terminal whose CLI cannot be found: one warning line, exit 0', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['0'], { inOrca: true });

  const orcaLines = output.split(/\r?\n/).filter((line) => line.includes('Orca'));
  assert.strictEqual(orcaLines.length, 1);
  assert.match(orcaLines[0], /^Warning: could not confirm .*System default \(Orca CLI not found\)/);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('switch --restart: the Orca check is printed before the restart step', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['0', '--restart'], { inOrca: true });

  const lines = output.split(/\r?\n/);
  const orcaAt = lines.findIndex((line) => line.startsWith('Warning: could not confirm'));
  const restartAt = lines.findIndex((line) => line.startsWith('Auto-restart skipped'));
  assert.ok(orcaAt >= 0, 'Orca line missing');
  assert.ok(restartAt >= 0, 'restart line missing');
  assert.ok(orcaAt < restartAt, 'the Orca check must run before the restart is scheduled');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('failed switch and non-switch commands never touch Orca', () => {
  const dead = makeFixtures({ storedSlotExpired: true });
  let failed = null;
  try {
    runCli(dead, ['0'], { inOrca: true });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, 'CLI must exit non-zero');
  assert.doesNotMatch(String(failed.stdout), /Orca/);
  fs.rmSync(dead.dir, { recursive: true, force: true });

  const fixtures = makeFixtures();
  assert.doesNotMatch(runCli(fixtures, ['sync'], { inOrca: true }), /Orca/);
  assert.doesNotMatch(runCli(fixtures, ['rename', '0', 'Example'], { inOrca: true }), /Orca/);
  assert.doesNotMatch(runCli(fixtures, ['remove', '0'], { inOrca: true }), /Orca/);
  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});
