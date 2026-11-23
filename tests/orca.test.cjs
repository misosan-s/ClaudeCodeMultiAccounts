const test = require('node:test');
const assert = require('node:assert');
const {
  findOrcaCli,
  isOrcaTerminal,
  classifyOrcaSelection,
  checkOrcaSelection,
} = require('../lib/proc/orca.cjs');
const messages = require('../lib/output/messages.cjs');

// Shapes mirror `orca account list --agent claude --json` from Orca 1.4.264
// (values replaced with placeholders).
const CLI = 'Z:\\orca\\bin\\orca.exe';
const POINTER = 'Z:\\orca\\claude-profiles\\selected-host';
const LIST_ARGS = ['account', 'list', '--agent', 'claude', '--json'];

function orcaAccount(id, email) {
  return {
    id,
    email,
    managedAuthRuntime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    organizationUuid: `org-${id}`,
    organizationName: email,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    home: `Z:\\orca\\claude-profiles\\${id}\\home`,
  };
}

const ACCOUNTS = [
  orcaAccount('id-alpha', 'alpha@example.com'),
  orcaAccount('id-beta', 'beta@example.com'),
];

function listJson(activeAccountId, accounts = ACCOUNTS) {
  const result = {
    accounts,
    activeAccountIdsByRuntime: { host: activeAccountId === undefined ? null : activeAccountId, wsl: {} },
    systemDefaultHome: 'Z:\\home\\.claude',
    systemDefaultEmail: 'system@example.com',
    systemDefaultOrganizationUuid: 'org-system',
  };
  if (activeAccountId !== undefined) {
    result.activeAccountId = activeAccountId;
  }
  return JSON.stringify({ id: 'req-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } });
}

function done(stdout) {
  return { status: 0, signal: null, stdout, stderr: '' };
}

function exited(status, stdout, stderr = '') {
  return { status, signal: null, stdout, stderr };
}

function fakeSpawn(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = (command, args, options) => {
    calls.push({ command, args, options });
    if (queue.length === 0) {
      throw new Error('unexpected extra orca call');
    }
    const next = queue.shift();
    return typeof next === 'function' ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

function overrides(spawn, env = { CCS_ORCA_CLI: CLI, ORCA_CLAUDE_PROFILE_POINTER: POINTER }) {
  return { env, platform: 'win32', exists: (candidate) => candidate === CLI, spawnSync: spawn };
}

test('findOrcaCli: CCS_ORCA_CLI wins and is never replaced by a fallback', () => {
  const env = { CCS_ORCA_CLI: 'Z:\\custom\\orca.exe', LOCALAPPDATA: 'Z:\\AppData\\Local' };
  const defaultPath = 'Z:\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
  assert.strictEqual(findOrcaCli(env, 'win32', () => true), 'Z:\\custom\\orca.exe');
  assert.strictEqual(findOrcaCli(env, 'win32', (p) => p === defaultPath), null);
});

test('findOrcaCli: Windows default install path under LOCALAPPDATA', () => {
  const env = { LOCALAPPDATA: 'Z:\\AppData\\Local', PATH: 'Z:\\tools' };
  const expected = 'Z:\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
  assert.strictEqual(findOrcaCli(env, 'win32', (p) => p === expected || p === 'Z:\\tools\\orca.exe'), expected);
});

test('findOrcaCli: falls back to orca.exe on PATH (Windows) and orca on PATH (POSIX)', () => {
  assert.strictEqual(
    findOrcaCli({ Path: 'Z:\\one;Z:\\two' }, 'win32', (p) => p === 'Z:\\two\\orca.exe'),
    'Z:\\two\\orca.exe',
  );
  // An orca.cmd shim needs a shell to run, so it is not a candidate.
  assert.strictEqual(findOrcaCli({ PATH: 'Z:\\one' }, 'win32', (p) => p === 'Z:\\one\\orca.cmd'), null);
  assert.strictEqual(
    findOrcaCli({ PATH: '/usr/bin:/opt/orca/bin' }, 'linux', (p) => p === '/opt/orca/bin/orca'),
    '/opt/orca/bin/orca',
  );
  assert.strictEqual(findOrcaCli({ PATH: '/usr/bin' }, 'darwin', () => false), null);
});

test('isOrcaTerminal: only when Orca\'s profile pointer variable is set', () => {
  assert.strictEqual(isOrcaTerminal({ ORCA_CLAUDE_PROFILE_POINTER: POINTER }), true);
  assert.strictEqual(isOrcaTerminal({ ORCA_CLAUDE_PROFILE_POINTER: '' }), false);
  assert.strictEqual(isOrcaTerminal({}), false);
});

test('classifyOrcaSelection: listed id -> managed, null -> System default, anything else -> unverified', () => {
  assert.deepStrictEqual(classifyOrcaSelection({ accounts: ACCOUNTS, activeAccountId: 'id-beta' }), { status: 'managed', email: 'beta@example.com' });
  assert.deepStrictEqual(classifyOrcaSelection({ accounts: ACCOUNTS, activeAccountId: null }), { status: 'system' });
  for (const active of [undefined, 'id-gone', 'system', 7, '']) {
    assert.strictEqual(classifyOrcaSelection({ accounts: ACCOUNTS, activeAccountId: active }).status, 'unverified', String(active));
  }
});

test('check: Orca on a managed account -> managed with its email, one read-only list call', () => {
  const spawn = fakeSpawn([done(listJson('id-alpha'))]);
  const outcome = checkOrcaSelection(overrides(spawn));

  assert.deepStrictEqual(outcome, { status: 'managed', email: 'alpha@example.com' });
  assert.strictEqual(spawn.calls.length, 1);
  assert.strictEqual(spawn.calls[0].command, CLI);
  assert.deepStrictEqual(spawn.calls[0].args, LIST_ARGS);
  assert.ok(spawn.calls[0].options.timeout > 0, 'the Orca call must have a timeout');
  assert.strictEqual(spawn.calls[0].options.windowsHide, true);
  assert.notStrictEqual(spawn.calls[0].options.shell, true);
});

test('check: Orca on System default (activeAccountId null) -> system', () => {
  const spawn = fakeSpawn([done(listJson(null))]);
  assert.deepStrictEqual(checkOrcaSelection(overrides(spawn)), { status: 'system' });
});

test('check: selection missing or not a listed account -> unverified (warn rather than miss)', () => {
  for (const active of [undefined, 'id-gone']) {
    const spawn = fakeSpawn([done(listJson(active))]);
    const outcome = checkOrcaSelection(overrides(spawn));
    assert.strictEqual(outcome.status, 'unverified', String(active));
    assert.match(outcome.reason, /unrecognised/);
  }
});

test('check: also accepts the unfiltered list shape (result.claude)', () => {
  const unfiltered = JSON.stringify({ ok: true, result: { claude: { accounts: ACCOUNTS, activeAccountId: 'id-beta' } } });
  const outcome = checkOrcaSelection(overrides(fakeSpawn([done(unfiltered)])));
  assert.deepStrictEqual(outcome, { status: 'managed', email: 'beta@example.com' });
});

test('check: no Orca CLI -> silent outside Orca terminals, unverified inside one', () => {
  const outside = fakeSpawn([]);
  assert.deepStrictEqual(
    checkOrcaSelection({ ...overrides(outside, { CCS_ORCA_CLI: CLI }), exists: () => false }),
    { status: 'absent' },
  );
  const inside = fakeSpawn([]);
  assert.deepStrictEqual(
    checkOrcaSelection({ ...overrides(inside), exists: () => false }),
    { status: 'unverified', reason: 'Orca CLI not found' },
  );
  assert.strictEqual(outside.calls.length + inside.calls.length, 0);
});

test('check: Orca call fails -> unverified with a short reason', () => {
  const timedOut = { status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync orca.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
  const jsonError = JSON.stringify({ id: 'local', ok: false, error: { code: 'unavailable', message: 'Orca runtime is not running' } });
  const cases = [
    [timedOut, /^orca account list timed out after \d+s$/],
    [exited(1, jsonError), /^orca account list exited with code 1: Orca runtime is not running$/],
    [done(jsonError), /^orca account list reported an error: Orca runtime is not running$/],
    [exited(2, '', `${'x'.repeat(500)}\nsecond line`), /^orca account list exited with code 2: x{120}$/],
    [done('not json'), /^unexpected orca account list output$/],
    [done('{"ok":true,"result":{}}'), /^unexpected orca account list output$/],
    [done('{"ok":true,"result":{"claude":null}}'), /^unexpected orca account list output$/],
    [() => { throw new Error('boom'); }, /boom/],
  ];
  for (const [response, reason] of cases) {
    const outcome = checkOrcaSelection(overrides(fakeSpawn([response])));
    assert.strictEqual(outcome.status, 'unverified');
    assert.match(outcome.reason, reason);
  }
});

test('the Orca code path never changes Orca\'s selection', () => {
  const spawn = fakeSpawn([done(listJson('id-alpha'))]);
  checkOrcaSelection(overrides(spawn));
  for (const call of spawn.calls) {
    assert.ok(!call.args.includes('select'), `unexpected call: ${call.args.join(' ')}`);
  }
});

test('getOrcaCheckLine: warning for managed / unverified, nothing for System default or no Orca', () => {
  const managed = messages.getOrcaCheckLine({ status: 'managed', email: 'alpha@example.com' });
  const managedNoEmail = messages.getOrcaCheckLine({ status: 'managed', email: '' });
  const unverified = messages.getOrcaCheckLine({ status: 'unverified', reason: 'Orca CLI not found' });

  assert.match(managed, /^Warning: .*alpha@example\.com.*System default/);
  assert.match(managedNoEmail, /^Warning: .*an Orca-managed account.*System default/);
  assert.match(unverified, /^Warning: could not confirm .*System default \(Orca CLI not found\)/);
  for (const line of [managed, managedNoEmail, unverified]) {
    assert.ok(!line.includes('\n'), 'must be a single line');
  }
  assert.strictEqual(messages.getOrcaCheckLine({ status: 'system' }), null);
  assert.strictEqual(messages.getOrcaCheckLine({ status: 'absent' }), null);
});
