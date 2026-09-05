const { verifyLiveIdentity } = require('../auth/guard.cjs');

function getAccountKey(account) {
  if (account?.accountUuid && String(account.accountUuid).trim()) {
    return `uuid:${String(account.accountUuid).trim().toLowerCase()}`;
  }
  if (account?.emailAddress && String(account.emailAddress).trim()) {
    return `email:${String(account.emailAddress).trim().toLowerCase()}`;
  }
  throw new Error('Account entry is missing both accountUuid and emailAddress.');
}

function normalizeStore(store, storeVersion) {
  const normalized = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(normalized.accounts)) {
    normalized.accounts = [];
  }
  normalized.version = storeVersion;
  return normalized;
}

function getDisplayAccounts(store, currentMetadata) {
  const currentKey = currentMetadata ? getAccountKey(currentMetadata) : null;
  return store.accounts.map((entry, index) => ({
    ...entry,
    index,
    current: currentKey && getAccountKey(entry.metadata) === currentKey,
  }));
}

function syncStoreFromLive(store, config, credentials, deepCopy, storeVersion) {
  if (!config?.oauthAccount) {
    throw new Error('The Claude config does not contain oauthAccount.');
  }
  if (!credentials?.claudeAiOauth) {
    throw new Error('The Claude credentials file does not contain claudeAiOauth.');
  }

  const key = getAccountKey(config.oauthAccount);

  const identity = verifyLiveIdentity(config, credentials, store, getAccountKey);
  if (!identity.ok) {
    return {
      changed: false,
      store: normalizeStore(deepCopy(store), storeVersion),
      key,
      skipped: true,
      warning: identity.reason,
    };
  }

  const now = new Date().toISOString();
  const existingEntry = store.accounts?.find((e) => e.key === key);
  const snapshot = {
    key,
    metadata: deepCopy(config.oauthAccount),
    credentials: deepCopy(credentials),
    capturedAt: now,
    lastSyncedAt: now,
    lastUsedAt: existingEntry?.lastUsedAt || undefined,
    usageSnapshot: existingEntry?.usageSnapshot || undefined,
    alias: existingEntry?.alias || undefined,
  };

  const nextStore = normalizeStore(deepCopy(store), storeVersion);
  const existingIndex = nextStore.accounts.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    nextStore.accounts[existingIndex] = snapshot;
  } else {
    nextStore.accounts.push(snapshot);
  }

  nextStore.updatedAt = new Date().toISOString();

  return {
    changed: JSON.stringify(store) !== JSON.stringify(nextStore),
    store: nextStore,
    key,
  };
}

function findSelection(accounts, selector) {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error('Selector cannot be empty.');
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && String(numeric) === trimmed) {
    const byIndex = accounts.find((entry) => Number(entry.index) === numeric);
    if (byIndex) return byIndex;
  }

  // Alias and email-prefix selectors, so a switch is one keystroke instead of
  // an index lookup: `ccs work` matches alias "work", `ccs a` matches the only
  // account whose email starts with "a".
  const lower = trimmed.toLowerCase();
  const byAlias = accounts.filter(
    (entry) => entry.alias && String(entry.alias).trim().toLowerCase() === lower
  );
  if (byAlias.length === 1) return byAlias[0];

  const byEmail = accounts.filter((entry) =>
    String(entry.metadata?.emailAddress || '').toLowerCase().startsWith(lower)
  );
  if (byEmail.length === 1) return byEmail[0];
  if (byEmail.length > 1) {
    const emails = byEmail.map((entry) => entry.metadata?.emailAddress).join(', ');
    throw new Error(`Selector '${trimmed}' matches multiple accounts (${emails}). Use a longer prefix or a numeric index.`);
  }

  throw new Error(`No account matched '${trimmed}'. Use a numeric index, alias, or email prefix.`);
}

function removeStoredAccount(store, removeIndex) {
  if (typeof removeIndex !== 'number' || removeIndex < 0 || removeIndex >= store.accounts.length) {
    throw new Error(`Invalid account index. Use an index between 0 and ${store.accounts.length - 1}.`);
  }
  const removed = store.accounts.splice(removeIndex, 1)[0];
  store.accounts.forEach((entry, i) => {
    entry.index = i;
  });
  return removed;
}

module.exports = {
  getAccountKey,
  normalizeStore,
  getDisplayAccounts,
  syncStoreFromLive,
  findSelection,
  removeStoredAccount,
};
