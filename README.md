# Claude Code Multi-Account Switcher (modified fork)

> **Attribution.** The original project is [Leuconoe/ClaudeCodeMultiAccounts](https://github.com/Leuconoe/ClaudeCodeMultiAccounts) by **Leuconoe**, released under the MIT License (see [LICENSE](LICENSE)). All credit for the switcher itself goes to the original author.
>
> **This fork** is a modified version maintained by [misosan-s](https://github.com/misosan-s). The `patched` branch is upstream **v0.3.10** plus the changes listed below; the `main` branch tracks upstream unchanged. Everything after the "What this fork changes" section is the original README.
>
> 원작자 Leuconoe의 MIT 프로젝트를 misosan-s가 변형한 버전입니다. 아래 "What this fork changes" 이후는 원본 README 그대로입니다.

## What this fork changes

1. **Switch by alias or email prefix.** `cc-switch`/`ccs` accepted only a numeric index. Now `ccs work` matches an alias set with `--rename`, and `ccs w` matches the only stored account whose email starts with `w`. An ambiguous prefix lists the candidates instead of guessing.
2. **`--restart`: switch and relaunch in the same terminal (Windows).** After a successful switch inside a Claude Code session, a detached helper (`restart-claude.ps1`) force-kills that exact session and types `claude -c` into the parent shell, so you land back in the same terminal on the new account. Falls back to a new window; activity is logged to `~/.claude/multi-account-switch/restart.log`. Windows only; other platforms print "Auto-restart skipped".
3. **Statusline shows the new account right away.** The previous account's cached usage (`cachedUsageUtilization` and statusline sidecar caches) is dropped on switch, so the statusline refetches instead of showing the old account until a manual `/usage`.
4. **`/ccs` slash command.** Short alias for `/cc-switch` that also passes `--restart`, so `/ccs w` switches and relaunches in one step. On Windows the generated slash commands now match their `allowed-tools` pattern exactly (unquoted forward-slash path, backslash spelling listed too, `//ccs` usage label), which fixes the "Shell command permission check failed" error upstream's `/cc-switch` hits under Git Bash.

### Installing this fork

`npx claude-code-multi-accounts` installs the upstream package, not this fork. Install from source:

```bash
git clone -b patched https://github.com/misosan-s/ClaudeCodeMultiAccounts.git
cd ClaudeCodeMultiAccounts
./install.cmd   # Windows
./install.sh    # macOS / Linux / WSL
```

Running it over an existing upstream install is fine: it replaces the files under `~/.claude/multi-account-switch` and rewrites the slash commands. As upstream does, the installer wraps an existing `statusLine.command`; if you want your own statusline back unchanged, restore it from `~/.claude/multi-account-switch/hooks/statusline-target.json`.

### Usage added by this fork

```bash
ccs              # list accounts (unchanged)
ccs work         # switch by alias
ccs w            # switch by unique email prefix
ccs w --restart  # switch, then relaunch Claude Code in this terminal (Windows)
```

```text
/ccs w           # inside Claude Code: switch + auto-restart in one step
```

Notes:
- Tested on Windows 11 (PowerShell, Git Bash). The `/ccs` permission fix and auto-restart were validated on Windows only.
- Windows: the installer writes the `ccs`/`cc-switch` wrappers to `%USERPROFILE%\bin` but does not add that folder to `PATH` (upstream behaviour). Add it yourself if the shell cannot find `ccs`; the `/ccs` slash command works regardless.
- These changes target upstream v0.3.10. Upstream v0.4.0 later added guards that refuse or stage a switch while a Claude Code session is running; this branch does not include them.

---

# Claude Code Multi-Account Switcher (original README)

[![npm version](https://img.shields.io/npm/v/claude-code-multi-accounts?label=npm)](https://www.npmjs.com/package/claude-code-multi-accounts)
[![npm downloads](https://img.shields.io/npm/dm/claude-code-multi-accounts)](https://www.npmjs.com/package/claude-code-multi-accounts)

This project installs a local workaround for switching Claude Code OAuth accounts by keeping account snapshots in `~/.ClaudeCodeMultiAccounts.json` and writing only the active account back into Claude's live files when switching.

Supported user-facing commands:
- `cc-switch`
- `cc-switch <index>`
- `cc-sync-oauth`
- `ccs` (short alias for `cc-switch`)
- `ccso` (short alias for `cc-sync-oauth`)
- `/cc-switch`
- `/cc-sync-oauth`

Supported environments:
- Windows (PowerShell/CMD/Git Bash)
- Ubuntu WSL
- Native macOS/Linux with Node.js
- Claude chat shell mode via `!cc-switch` and `!cc-sync-oauth`

Prerequisites:
- Node.js 18+
- Claude Code already installed and logged in at least once

Install:

**Recommended (via npm):**

```bash
npx claude-code-multi-accounts install
```

**Manual (from source):**

```bash
git clone https://github.com/Leuconoe/ClaudeCodeMultiAccounts.git
cd ClaudeCodeMultiAccounts
./install.cmd   # Windows
./install.sh    # macOS / Linux / WSL
```

What install does:
- copies the Node CLI into `~/.claude/multi-account-switch/bin`
- installs `cc-switch`, `cc-sync-oauth`, `ccs`, and `ccso` wrapper commands
- keeps stored account snapshots in `~/.ClaudeCodeMultiAccounts.json`
- adds an `auth_success` hook entry to `~/.claude/settings.json`
- adds a `SessionStart` reminder hook to `~/.claude/settings.json`
- if `statusLine.command` already exists, wraps it and prepends `use !cc-switch / !ccs` to the existing HUD output
- installs global Claude command wrappers in `~/.claude/commands`
- creates backups under `~/.claude/backups/multi-account-switch-installer`

Uninstall:

**Recommended (via npm):**

```bash
npx claude-code-multi-accounts uninstall
```

**Manual (from source):**

```powershell
./uninstall.cmd   # Windows
```

```bash
./uninstall.sh    # macOS / Linux / WSL
```

Usage:

```bash
cc-switch
cc-switch 1
cc-switch --rename 1 Personal
cc-switch --rename 1
cc-sync-oauth
ccs
ccso
```

`cc-switch --rename <index> <name>` sets a custom label for a stored account
(handy when several accounts share the same Claude display name). The alias
survives syncs. Omit `<name>` to clear it and fall back to the account's display
name.

Example shell output:

```text
$ cc-switch
--- Usage ---
5h remaining/reset: 78.0% / 2026. 4. 22. 2:00 PM
7d remaining/reset: 94.0% / 2026. 4. 24. 9:00 AM

Available Claude accounts:
* [0] Alex Example | Pro | 5H:78%(~2h 44min) | 7D:94%(1D 21h) | used:3m ago
  [1] Taylor Example | Team Std | 5H:71%(now) | 7D:81%(1D 21h) | used:19h ago
  [2] Jordan Example | Team Prem | 5H:0%(now) | 7D:65%(2D 5h) | used:1d ago

Run cc-switch <index> to make one of these stored entries the active Claude account.
Run cc-switch --remove <index> to remove a stored account.
```

```text
$ cc-switch 1
Switched active account to [1] Taylor Example <taylor@example.invalid> (Teams).

Stored account list:
  [0] Alex Example | Pro | 5H:78%(?) | 7D:94%(?) | used:19m ago
* [1] Taylor Example | Team Std | 5H:71%(?) | 7D:81%(?) | used:just now
  [2] Jordan Example | Team Prem | 5H:0%(?) | 7D:65%(?) | used:1d ago
```

Output columns:
- `5H`: Current or cached 5-hour remaining quota and reset estimate
- `7D`: Current or cached 7-day remaining quota and reset estimate
- `used`: When the account was last selected, or when Claude startup refreshed the active account marker
- Top usage block: live `5h remaining/reset` and `7d remaining/reset` values fetched from Claude when available

Claude chat shell usage:

```bash
!cc-switch
!cc-switch 1
!cc-sync-oauth
!ccs
!ccso
```

Claude `/command` usage:

```text
/cc-switch
/cc-switch 1
/cc-sync-oauth
```

`/cc-switch` currently still goes through Claude's command-processing path, so `!cc-switch` remains the primary deterministic execution path. The slash command is installed now so it can benefit from future improvements in Claude's command handling.

Claude startup reminder:

```text
Claude Code Multi-Account Switcher is available.
Use !cc-switch or !ccs to list/switch accounts.
Use !cc-sync-oauth or !ccso to sync the active account into oauthList.
```

Platform notes:
- Windows installs `cc-switch.cmd` and `cc-sync-oauth.cmd` into `~/bin`, plus Git Bash-friendly `cc-switch` and `cc-sync-oauth` wrappers in the same directory.
- Short aliases `ccs` and `ccso` are installed alongside the full command names.
- Native macOS/Linux installs commands into `~/.local/bin`.
- WSL also uses the Unix shell wrappers.
- If a shell says `command not found` right after install, restart the shell or run `hash -r` once.

Behavior notes:
- The tool stores metadata and credential snapshots in `~/.ClaudeCodeMultiAccounts.json`.
- `cc-sync-oauth` imports the current live account into that store.
- Switching writes only the active `oauthAccount` back into `~/.claude.json` and the active credential snapshot back into `~/.claude/.credentials.json`.
- It creates backups before writing live files or the store file.
- Stored account ordering is stable.
- If a stored `displayName` is already corrupted, output falls back to the email local part.
- The displayed plan type is a best-effort inference from the available account fields and credential snapshot.
- The `reset:` column shows rate limit countdown for the current account, or a 7-day window estimate for others.
- Usage info from the Claude API is shown before the account list when rate limited.

Warnings:
- This is a local workaround, not an official Claude plugin.
- It still mutates internal Claude live files when switching accounts, but it no longer uses `~/.claude.json` as the primary multi-account store.
- Native macOS/Linux support is implemented, but still needs real-host validation beyond Windows/WSL testing.
- npm packaging is prepared, but npm registry publish still requires npm authentication.

After this:
- npm / `npx` release refresh for `v0.3.7`
- non-AI hook execution path for `/cc-switch` if Claude exposes a direct command hook in the future
- improve plan type detection beyond the current best-effort inference

## Star History

<a href="https://www.star-history.com/?repos=Leuconoe%2FClaudeCodeMultiAccounts&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
 </picture>
</a>
