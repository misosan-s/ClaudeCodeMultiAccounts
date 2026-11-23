const test = require('node:test');
const assert = require('node:assert');
const { buildResumeCommand, scheduleClaudeRestart } = require('../lib/proc/restart.cjs');

// Placeholder values only.
const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const PLUGIN_DIR = 'Z:\\orca\\plugins\\orca-agent-view';

test('resume command: every value present -> same conversation with plugin dir and effort', () => {
  assert.strictEqual(
    buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: PLUGIN_DIR, CLAUDE_EFFORT: 'xhigh' }),
    `claude --plugin-dir ${PLUGIN_DIR} --effort xhigh --resume ${SESSION_ID}`,
  );
});

test('resume command: missing optional values are left out', () => {
  assert.strictEqual(
    buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, CLAUDE_EFFORT: 'high' }),
    `claude --effort high --resume ${SESSION_ID}`,
  );
  assert.strictEqual(
    buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: PLUGIN_DIR, CLAUDE_EFFORT: '' }),
    `claude --plugin-dir ${PLUGIN_DIR} --resume ${SESSION_ID}`,
  );
  assert.strictEqual(buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID }), `claude --resume ${SESSION_ID}`);
});

test('resume command: no usable session id -> claude -c', () => {
  const full = { ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: PLUGIN_DIR, CLAUDE_EFFORT: 'xhigh' };
  assert.strictEqual(buildResumeCommand(full), 'claude -c');
  assert.strictEqual(buildResumeCommand({ ...full, CLAUDE_CODE_SESSION_ID: '' }), 'claude -c');
  for (const unsafe of ['abc def', 'abc"def', "abc'def", 'abc;rm', '-x', 'a$b']) {
    assert.strictEqual(buildResumeCommand({ ...full, CLAUDE_CODE_SESSION_ID: unsafe }), 'claude -c', unsafe);
  }
});

test('resume command: values with spaces, quotes or shell characters are dropped, not quoted', () => {
  for (const unsafeDir of ['Z:\\Program Files\\orca', 'Z:\\orca"x', "Z:\\orca'x", 'Z:\\a;b', 'Z:\\a&b', 'Z:\\$env', 'Z:\\a(b)', '-Z:\\orca']) {
    assert.strictEqual(
      buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: unsafeDir, CLAUDE_EFFORT: 'xhigh' }),
      `claude --effort xhigh --resume ${SESSION_ID}`,
      unsafeDir,
    );
  }
  for (const unsafeEffort of ['x high', 'max"', 'high;exit']) {
    assert.strictEqual(
      buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, CLAUDE_EFFORT: unsafeEffort }),
      `claude --resume ${SESSION_ID}`,
      unsafeEffort,
    );
  }
  assert.strictEqual(
    buildResumeCommand({ CLAUDE_CODE_SESSION_ID: SESSION_ID, ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: '/opt/orca/plugins/orca-agent-view' }),
    `claude --plugin-dir /opt/orca/plugins/orca-agent-view --resume ${SESSION_ID}`,
  );
});

function decodeLaunch(call) {
  const encoded = call.args[call.args.indexOf('-EncodedCommand') + 1];
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

test('scheduleClaudeRestart: hands the helper the exact-session resume command (spawn intercepted)', () => {
  const calls = [];
  const outcome = scheduleClaudeRestart({
    platform: 'win32',
    env: {
      CLAUDE_PID: '4242',
      CLAUDE_CODE_EXECPATH: 'Z:\\bin\\claude.exe',
      CLAUDE_CODE_SESSION_ID: SESSION_ID,
      ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: PLUGIN_DIR,
      CLAUDE_EFFORT: 'xhigh',
    },
    scriptPath: 'Z:\\ccs\\restart-claude.ps1',
    cwd: 'Z:\\work',
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  const expected = `claude --plugin-dir ${PLUGIN_DIR} --effort xhigh --resume ${SESSION_ID}`;
  assert.deepStrictEqual(outcome, { scheduled: true, claudePid: 4242, resumeCommand: expected });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].command, 'powershell.exe');
  assert.strictEqual(calls[0].options.windowsHide, true);
  const script = decodeLaunch(calls[0]);
  assert.ok(script.includes('Win32_Process'), script);
  assert.ok(script.includes(`-ResumeCommand "${expected}"`), script);
  assert.ok(script.includes('-ClaudePid 4242'), script);
  assert.ok(script.includes('-File "Z:\\ccs\\restart-claude.ps1"'), script);
});

test('scheduleClaudeRestart: no session id -> helper gets claude -c; failed launch is reported', () => {
  const calls = [];
  const outcome = scheduleClaudeRestart({
    platform: 'win32',
    env: { CLAUDE_PID: '4242' },
    scriptPath: 'Z:\\ccs\\restart-claude.ps1',
    cwd: '',
    spawnSync: (command, args) => {
      calls.push({ command, args });
      return { status: 3 };
    },
  });
  assert.strictEqual(outcome.scheduled, false);
  assert.match(outcome.reason, /returned 3/);
  assert.ok(decodeLaunch(calls[0]).includes('-ResumeCommand "claude -c"'));
});

test('scheduleClaudeRestart: outside a Claude Code session nothing is spawned', () => {
  let spawned = false;
  const outcome = scheduleClaudeRestart({ platform: 'win32', env: {}, spawnSync: () => { spawned = true; return { status: 0 }; } });
  assert.strictEqual(outcome.scheduled, false);
  assert.strictEqual(spawned, false);
});
