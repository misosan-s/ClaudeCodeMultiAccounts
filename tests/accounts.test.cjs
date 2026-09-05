const test = require('node:test');
const assert = require('node:assert');
const { syncStoreFromLive, getAccountKey, findSelection } = require('../lib/store/accounts.cjs');
const { deepCopy } = require('../lib/store/io.cjs');

const STORE_VERSION = '0.2.9';
const NOW = Date.now();

function liveOauth(suffix) {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt: NOW + 3600000,
    refreshTokenExpiresAt: NOW + 86400000,
    scopes: [],
    subscriptionType: 'pro',
    rateLimitTier: 'default',
  };
}

function makeConfig(uuid, email) {
  return { oauthAccount: { accountUuid: uuid, emailAddress: email } };
}

test('syncStoreFromLive: upserts live account (backward-compatible path)', () => {
  const store = { version: STORE_VERSION, accounts: [] };
  const result = syncStoreFromLive(store, makeConfig('uuid-a', 'a@test.com'), { claudeAiOauth: liveOauth('a') }, deepCopy, STORE_VERSION);

  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.skipped, undefined);
  assert.strictEqual(result.store.accounts.length, 1);
  assert.strictEqual(result.store.accounts[0].key, 'uuid:uuid-a');
  assert.strictEqual(result.store.accounts[0].credentials.claudeAiOauth.accessToken, 'access-a');
});

test('syncStoreFromLive: preserves alias/lastUsedAt/usageSnapshot on re-sync', () => {
  const first = syncStoreFromLive({ version: STORE_VERSION, accounts: [] }, makeConfig('uuid-a', 'a@test.com'), { claudeAiOauth: liveOauth('a') }, deepCopy, STORE_VERSION);
  first.store.accounts[0].alias = 'work';
  first.store.accounts[0].lastUsedAt = '2026-01-01T00:00:00.000Z';

  const second = syncStoreFromLive(first.store, makeConfig('uuid-a', 'a@test.com'), { claudeAiOauth: liveOauth('a2') }, deepCopy, STORE_VERSION);
  assert.strictEqual(second.store.accounts[0].alias, 'work');
  assert.strictEqual(second.store.accounts[0].lastUsedAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(second.store.accounts[0].credentials.claudeAiOauth.accessToken, 'access-a2');
});

test('syncStoreFromLive: live tokens matching another slot -> skipped with warning, store unchanged', () => {
  const oauthA = liveOauth('a');
  const store = {
    version: STORE_VERSION,
    accounts: [{
      key: 'uuid:uuid-a',
      metadata: { accountUuid: 'uuid-a', emailAddress: 'a@test.com' },
      credentials: { claudeAiOauth: oauthA },
    }],
  };
  // Live claims to be account B but carries account A's exact tokens.
  const result = syncStoreFromLive(store, makeConfig('uuid-b', 'b@test.com'), { claudeAiOauth: { ...oauthA } }, deepCopy, STORE_VERSION);

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.changed, false);
  assert.match(result.warning, /different account/);
  assert.strictEqual(result.store.accounts.length, 1);
  assert.strictEqual(result.store.accounts[0].key, 'uuid:uuid-a');
});

test('syncStoreFromLive: still throws on missing oauthAccount / claudeAiOauth', () => {
  assert.throws(() => syncStoreFromLive({ accounts: [] }, {}, { claudeAiOauth: liveOauth('x') }, deepCopy, STORE_VERSION));
  assert.throws(() => syncStoreFromLive({ accounts: [] }, makeConfig('uuid-a', 'a@test.com'), {}, deepCopy, STORE_VERSION));
});

test('getAccountKey: uuid preferred, email fallback', () => {
  assert.strictEqual(getAccountKey({ accountUuid: 'ABC' }), 'uuid:abc');
  assert.strictEqual(getAccountKey({ emailAddress: 'X@Y.com' }), 'email:x@y.com');
  assert.throws(() => getAccountKey({}));
});

const SELECTION_ACCOUNTS = [
  { index: 0, alias: 'Work', metadata: { emailAddress: 'alice@example.com' } },
  { index: 1, metadata: { emailAddress: 'bob@example.com' } },
  { index: 2, metadata: { emailAddress: 'bonnie@example.com' } },
];

test('findSelection: numeric index still takes priority', () => {
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, '1').index, 1);
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, ' 2 ').index, 2);
});

test('findSelection: alias matches case-insensitively', () => {
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, 'work').index, 0);
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, 'WORK').index, 0);
});

test('findSelection: unique email prefix matches', () => {
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, 'a').index, 0);
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, 'bob').index, 1);
  assert.strictEqual(findSelection(SELECTION_ACCOUNTS, 'Bon').index, 2);
});

test('findSelection: ambiguous email prefix throws and names the candidates', () => {
  assert.throws(() => findSelection(SELECTION_ACCOUNTS, 'b'), /matches multiple accounts \(bob@example.com, bonnie@example.com\)/);
});

test('findSelection: unknown selector and empty selector throw', () => {
  assert.throws(() => findSelection(SELECTION_ACCOUNTS, 'zzz'), /No account matched 'zzz'/);
  assert.throws(() => findSelection(SELECTION_ACCOUNTS, '   '), /Selector cannot be empty/);
});
