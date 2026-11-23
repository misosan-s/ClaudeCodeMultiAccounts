function getListGuidance(usageCommand) {
  return [
    `Run ${usageCommand} <index> to make one of these stored entries the active Claude account.`,
    `Run ${usageCommand} --remove <index> to remove a stored account.`,
  ];
}

function getRestartNotice() {
  return 'Note: Restart Claude Code to apply the account change.';
}

function getAutoRestartNotice() {
  return 'Auto-restart: this Claude Code session will now exit and reopen this conversation in this terminal.';
}

function getAutoRestartSkipped(reason) {
  return `Auto-restart skipped (${reason}). Restart Claude Code manually to apply the account change.`;
}

// One line, or null when there is nothing to say (System default, or no Orca).
function getOrcaCheckLine(outcome) {
  if (outcome.status === 'managed') {
    const account = outcome.email ? `the Orca-managed account ${outcome.email}` : 'an Orca-managed account';
    return `Warning: Orca's Claude account is set to ${account}, so new Orca tabs and restarts inside Orca open as that account, not the one ccs switched to. Set it to System default in Orca.`;
  }
  if (outcome.status === 'unverified') {
    return `Warning: could not confirm that Orca's Claude account is System default (${outcome.reason}). If it is not, new Orca tabs and restarts inside Orca will not use the account ccs switched to.`;
  }
  return null;
}

function getAvailableAccountsHeading() {
  return 'Available Claude accounts:';
}

function getStoredAccountsHeading() {
  return 'Stored account list:';
}

function getRemainingAccountsHeading() {
  return 'Remaining accounts:';
}

function getRunningSessionsWarning(count) {
  return `Warning: ${count} running Claude Code process(es) detected. They may rewrite credentials after the switch; close them and restart Claude Code once the switch completes.`;
}

function getRefreshProgress(index) {
  return `Stored access token for [${index}] is expired or expiring soon - refreshing...`;
}

function getRefreshSuccess() {
  return 'Token refreshed.';
}

function getSwitchAbortedLines(abort, label, usageCommand) {
  const lines = [];
  if (abort.code === 'refresh-expired' || abort.code === 'revoked') {
    lines.push(`Switch aborted: the stored credentials for ${label} are no longer usable (${abort.reason}).`);
    lines.push('Your current live login was left untouched.');
    lines.push(`Recover that account by logging into it in Claude Code (/login), then run '${usageCommand} sync' to re-capture it.`);
  } else if (abort.code === 'rate-limited') {
    lines.push(`Switch aborted: ${abort.reason}.`);
    lines.push('Your current live login was left untouched. Try again in a few minutes.');
  } else {
    lines.push(`Switch aborted: ${abort.reason}.`);
    lines.push('Your current live login was left untouched.');
  }
  return lines;
}

function getSyncSkippedWarning(reason) {
  return `Warning: ${reason}`;
}

module.exports = {
  getListGuidance,
  getRestartNotice,
  getAutoRestartNotice,
  getAutoRestartSkipped,
  getOrcaCheckLine,
  getAvailableAccountsHeading,
  getStoredAccountsHeading,
  getRemainingAccountsHeading,
  getRunningSessionsWarning,
  getRefreshProgress,
  getRefreshSuccess,
  getSwitchAbortedLines,
  getSyncSkippedWarning,
};
