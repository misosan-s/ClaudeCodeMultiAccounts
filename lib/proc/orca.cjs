// Read-only check after a switch. ccs switches accounts by rewriting ~/.claude,
// which is Orca's "System default". If Orca is set to one of its managed
// accounts instead, new Orca tabs and the --restart relaunch (Orca's `claude`
// wrapper reads the selection on every launch) open as that account, so ccs
// warns. ccs never changes Orca's selection: changing it makes Orca relaunch
// every running Claude tab.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// `orca account list --agent claude` took 0.5-2.2s on a live host.
const ORCA_TIMEOUT_MS = 5000;
const MAX_DETAIL_LENGTH = 120;

function findOrcaCli(env, platform, exists) {
  if (env.CCS_ORCA_CLI) {
    return exists(env.CCS_ORCA_CLI) ? env.CCS_ORCA_CLI : null;
  }
  const isWindows = platform === 'win32';
  const paths = isWindows ? path.win32 : path.posix;
  const candidates = [];
  if (isWindows && env.LOCALAPPDATA) {
    candidates.push(paths.join(env.LOCALAPPDATA, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'));
  }
  // Only a real executable: an orca.cmd shim cannot be spawned without a shell.
  for (const dir of String(env.PATH || env.Path || '').split(paths.delimiter)) {
    if (dir) {
      candidates.push(paths.join(dir, isWindows ? 'orca.exe' : 'orca'));
    }
  }
  return candidates.find((candidate) => exists(candidate)) || null;
}

// Orca sets this in its terminals; its `claude` wrapper reads the file it names.
function isOrcaTerminal(env) {
  return Boolean(env.ORCA_CLAUDE_PROFILE_POINTER);
}

function classifyOrcaSelection(block) {
  // Orca 1.4.264 builds activeAccountId as `byRuntime.host ?? activeId ?? null`,
  // so System default should read as null (from Orca's code, not observed).
  if (block.activeAccountId === null) {
    return { status: 'system' };
  }
  const active = block.activeAccountId;
  const account = typeof active === 'string'
    ? block.accounts.find((entry) => entry && entry.id === active)
    : null;
  if (account) {
    return { status: 'managed', email: typeof account.email === 'string' ? account.email : '' };
  }
  // Missing key or an id Orca no longer lists: warn rather than guess.
  return { status: 'unverified', reason: 'unrecognised Orca account selection' };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function describeFailure(step, run, timeoutMs) {
  if (run.error) {
    return run.error.code === 'ETIMEDOUT'
      ? `${step} timed out after ${Math.round(timeoutMs / 1000)}s`
      : `${step} could not run (${run.error.code || run.error.message})`;
  }
  const parsed = parseJson(run.stdout);
  const reportedError = parsed !== null && typeof parsed === 'object' && parsed.ok === false;
  if (run.status === 0 && !reportedError) {
    return null;
  }
  let head = `${step} reported an error`;
  if (run.status === null) {
    head = `${step} was stopped (${run.signal || 'no exit code'})`;
  } else if (run.status !== 0) {
    head = `${step} exited with code ${run.status}`;
  }
  const detail = reportedError && parsed.error && typeof parsed.error.message === 'string'
    ? parsed.error.message
    : String(run.stderr || '').trim().split(/\r?\n/)[0];
  return detail ? `${head}: ${detail.slice(0, MAX_DETAIL_LENGTH)}` : head;
}

function checkOrcaSelection(overrides) {
  const opts = overrides || {};
  try {
    const env = opts.env || process.env;
    const cli = findOrcaCli(env, opts.platform || process.platform, opts.exists || fs.existsSync);
    if (!cli) {
      // No Orca on this machine is normal; inside an Orca terminal it is not.
      return isOrcaTerminal(env) ? { status: 'unverified', reason: 'Orca CLI not found' } : { status: 'absent' };
    }
    const spawn = opts.spawnSync || spawnSync;
    const timeoutMs = opts.timeoutMs || ORCA_TIMEOUT_MS;
    const listRun = spawn(cli, ['account', 'list', '--agent', 'claude', '--json'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      env,
    });
    const failure = describeFailure('orca account list', listRun, timeoutMs);
    if (failure) {
      return { status: 'unverified', reason: failure };
    }
    const listed = parseJson(listRun.stdout);
    const result = listed && listed.result;
    // `--agent claude` returns result.accounts; the unfiltered list nests it under result.claude.
    const block = result && (Array.isArray(result.accounts) ? result : result.claude);
    if (!block || !Array.isArray(block.accounts)) {
      return { status: 'unverified', reason: 'unexpected orca account list output' };
    }
    return classifyOrcaSelection(block);
  } catch (error) {
    return { status: 'unverified', reason: error.message };
  }
}

module.exports = { findOrcaCli, isOrcaTerminal, classifyOrcaSelection, checkOrcaSelection };
