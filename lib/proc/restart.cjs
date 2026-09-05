// Auto-restart of the current Claude Code session after an account switch.
// The helper (restart-claude.ps1) is launched via Win32_Process.Create so it is
// parented under WmiPrvSE - outside Claude Code's process tree/job object - and
// survives while the old session exits.
const path = require('path');
const { spawnSync } = require('child_process');

function canScheduleRestart(env, platform) {
  const environment = env || process.env;
  const os = platform || process.platform;
  if (os !== 'win32') {
    return { available: false, reason: 'auto-restart is only implemented on Windows' };
  }
  const pid = Number.parseInt(environment.CLAUDE_PID || '', 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { available: false, reason: 'not running inside a Claude Code session (CLAUDE_PID missing)' };
  }
  return { available: true, claudePid: pid };
}

function scheduleClaudeRestart(overrides) {
  const opts = overrides || {};
  const env = opts.env || process.env;
  const check = canScheduleRestart(env, opts.platform);
  if (!check.available) {
    return { scheduled: false, reason: check.reason };
  }

  const scriptPath = opts.scriptPath || path.join(__dirname, '..', '..', 'restart-claude.ps1');
  const claudeExe = env.CLAUDE_CODE_EXECPATH || '';
  const cwd = opts.cwd !== undefined ? opts.cwd : process.cwd();
  const resumeCommand = opts.resumeCommand || 'claude -c';
  const delayMs = opts.delayMs || 1200;

  const innerParts = [
    'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', `"${scriptPath}"`,
    '-ClaudePid', String(check.claudePid),
    '-ResumeCommand', `"${resumeCommand}"`,
    '-DelayMs', String(delayMs),
  ];
  if (claudeExe) {
    innerParts.push('-ClaudeExe', `"${claudeExe}"`);
  }
  if (cwd) {
    innerParts.push('-Cwd', `"${cwd}"`);
  }
  const inner = innerParts.join(' ');

  const script = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${inner.replace(/'/g, "''")}' }; exit $r.ReturnValue`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 15000,
    stdio: 'ignore',
  });
  if (run.error || run.status !== 0) {
    const reason = run.error ? run.error.message : `Win32_Process.Create returned ${run.status}`;
    return { scheduled: false, reason };
  }
  return { scheduled: true, claudePid: check.claudePid };
}

module.exports = { canScheduleRestart, scheduleClaudeRestart };
