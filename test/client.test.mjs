import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrunchyrollClient, CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from '../dist/index.js';

const session = { accessToken: 'test-token', tokenType: 'Bearer', accountId: 'account', profileId: 'profile', cookie: 'etp_rt=secret' };
const token = { access_token: 'new-token', token_type: 'Bearer', expires_in: 3600, account_id: 'account', profile_id: 'profile', refresh_token: 'refresh' };
const json = (payload, init) => Response.json(payload, init);
function setup(payload = { data: [], total: 0 }, options = {}) {
  const calls = [];
  const client = new CrunchyrollClient({ fetchImpl: async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    return typeof payload === 'function' ? payload(url, init) : json(payload);
  }, ...options });
  client.setSession(session);
  return { client, calls };
}

test('public exports and error inheritance', () => {
  assert.ok(new CrunchyrollAuthError('failure') instanceof CrunchyrollApiError);
  assert.equal(new CrunchyrollValidationError('bad').name, 'CrunchyrollValidationError');
});

test('cookie authentication sends the grant and stores an isolated session', async () => {
  const { client, calls } = setup(token);
  const result = await client.authenticateWithRtCookie({ cookie: session.cookie, deviceId: 'device' });
  assert.equal(calls[0].url.pathname, '/auth/v1/token');
  assert.equal(calls[0].headers.get('cookie'), session.cookie);
  assert.match(calls[0].headers.get('authorization'), /^Basic /);
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'etp_rt_cookie');
  assert.equal(new URLSearchParams(calls[0].body).get('device_id'), 'device');
  assert.ok(result.expiresAt > Date.now());
  result.accessToken = 'mutated';
  assert.equal(client.getSession().accessToken, token.access_token);
});

test('anonymous authentication omits session credentials and does not replace session', async () => {
  const { client, calls } = setup(token);
  await client.getAnonymousToken();
  assert.equal(calls[0].headers.has('cookie'), false);
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'client_id');
  assert.equal(client.getSession().accessToken, session.accessToken);
});

for (const baseUrl of ['https://example.com', 'https://beta-api.crunchyroll.com:444']) {
  test(`cookies are blocked for authentication and content at ${baseUrl}`, async () => {
    const { client, calls } = setup(token, { baseUrl });
    await assert.rejects(client.authenticateWithRtCookie({ cookie: session.cookie }), CrunchyrollValidationError);
    await assert.rejects(client.getWatchlist(), CrunchyrollValidationError);
    assert.equal(calls.length, 0);
  });
}

test('explicit custom origin opt-in and cookie-free bearer sessions', async () => {
  const opted = setup(token, { baseUrl: 'https://example.com', allowCookieOnCustomBaseUrl: true });
  await opted.client.authenticateWithRtCookie({ cookie: session.cookie });
  assert.equal(opted.calls[0].headers.get('cookie'), session.cookie);
  const { client, calls } = setup(undefined, { baseUrl: 'https://example.com', sendCookieWithContentRequests: false });
  client.setSession({ accessToken: 'token', tokenType: 'Bearer', profileId: 'profile' });
  await client.getWatchlist();
  assert.equal(calls[0].headers.has('cookie'), false);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer token');
  assert.equal(calls[0].redirect, 'error');
});

for (const cookie of ['not_etp_rt=secret', 'etp_rt=', 'etp_rt=; other=value', 'etp_rt=value\r\n', 'etp_rt=x\0', 'x'.repeat(4097)]) {
  test(`invalid cookie rejected: ${JSON.stringify(cookie.slice(0, 30))}`, async () => {
    const { client, calls } = setup();
    await assert.rejects(client.authenticateWithRtCookie({ cookie }), CrunchyrollValidationError);
    assert.equal(calls.length, 0);
  });
}

for (const options of [{ timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { timeoutMs: 0.5 }, { timeoutMs: 2 ** 31 }, { baseUrl: 'http://example.com' }, { baseUrl: 'https://user:pass@example.com' }, { baseUrl: 'https://example.com/path' }, { baseUrl: 'https://example.com?x=1' }, { userAgent: 'bad\n' }, { anonymousBasicAuth: 'Basic ' }]) {
  test(`invalid constructor options: ${JSON.stringify(options)}`, () => {
    assert.throws(() => new CrunchyrollClient(options), CrunchyrollValidationError);
  });
}

test('session validation is atomic, copied, and expiry-aware', async () => {
  const { client, calls } = setup();
  for (const patch of [{ accessToken: '' }, { accessToken: 'x\r\n' }, { tokenType: 'Basic' }, { expiresAt: NaN }, { expiresAt: 0 }, { profileId: '\r\n' }]) {
    assert.throws(() => client.setSession({ ...session, ...patch }), CrunchyrollValidationError);
    assert.deepEqual(client.getSession(), session);
  }
  client.getSession().accessToken = 'mutated';
  assert.equal(client.getSession().accessToken, session.accessToken);
  client.setSession({ ...session, expiresAt: Date.now() + 1000 });
  assert.equal(client.isAuthenticated(), false);
  await assert.rejects(client.getWatchlist(), CrunchyrollAuthError);
  assert.equal(calls.length, 0);
  client.clearSession();
  assert.equal(client.getSession(), null);
  assert.equal(client.isAuthenticated(), false);
  await assert.rejects(client.getWatchlist(), CrunchyrollAuthError);
});

for (const [method, args, path] of [
  ['getWatchlist', [{ n: 25, start: 0, is_favorite: false }], '/content/v2/discover/profile/watchlist'],
  ['getWatchHistory', [], '/content/v2/account/watch-history'],
  ['getHistory', [], '/content/v2/account/watch-history'],
  ['getWatchedAnime', [], '/content/v2/account/watch-history'],
  ['getCrunchylists', [], '/content/v2/account/custom-lists'],
  ['getCrunchylistItems', ['list/one'], '/content/v2/account/custom-lists/list%2Fone'],
  ['getSeasonEpisodes', ['season/one'], '/content/v2/cms/seasons/season%2Fone/episodes'],
]) {
  test(`${method} builds correct authenticated URL`, async () => {
    const { client, calls } = setup();
    await client[method](...args);
    assert.equal(calls[0].url.pathname, path);
    assert.equal(calls[0].url.searchParams.get('locale'), 'en-US');
    assert.equal(calls[0].headers.get('authorization'), 'Bearer test-token');
    if (method === 'getWatchlist') assert.equal(calls[0].url.searchParams.get('is_favorite'), 'false');
  });
}

test('account endpoints fall back to profile and require an identifier', async () => {
  const { client, calls } = setup();
  client.setSession({ ...session, accountId: undefined });
  await client.getHistory();
  assert.equal(calls[0].url.pathname, '/content/v2/profile/watch-history');
  client.setSession({ accessToken: 'token', tokenType: 'Bearer' });
  await assert.rejects(client.getHistory(), CrunchyrollAuthError);
});

test('episode accepts object and array envelopes and locale override', async () => {
  for (const data of [{ id: 'episode' }, [{ id: 'episode' }]]) {
    const { client, calls } = setup({ data });
    assert.equal((await client.getEpisodeInfo('episode', 'ja-JP')).id, 'episode');
    assert.equal(calls[0].url.searchParams.get('locale'), 'ja-JP');
  }
});

for (const query of [{ n: -1 }, { start: 0.1 }, { n: NaN }, { n: '25' }, { order: 'invalid' }, { is_favorite: 'true' }, { locale: '' }]) {
  test(`invalid query: ${JSON.stringify(query)}`, async () => {
    const { client, calls } = setup();
    await assert.rejects(client.getWatchlist(query), CrunchyrollValidationError);
    assert.equal(calls.length, 0);
  });
}

test('invalid pagination and IDs fail before fetching', async () => {
  const { client, calls } = setup();
  await assert.rejects(client.getHistory({ page: 0 }), CrunchyrollValidationError);
  await assert.rejects(client.getCrunchylistItems(''), CrunchyrollValidationError);
  await assert.rejects(client.getEpisodeInfo('..'), CrunchyrollValidationError);
  assert.equal(calls.length, 0);
});

test('currently watching respects completed flags and consistent time units', async () => {
  const { client } = setup({ total: 100, data: [
    { id: 'fraction', progress: 0.5 },
    { id: 'seconds', playhead: 5, duration: 10 },
    { id: 'milliseconds', playhead_ms: 500, duration_ms: 1000 },
    { id: 'nested', panel: { progress: 0.1 } },
    { id: 'complete', progress: 0.5, panel: { fully_watched: true } },
    { id: 'ended', fully_watched: false, playhead: 10, duration: 10 },
    { id: 'mixed-units', playhead: 10, duration_ms: 1000 },
    { id: 'unstarted', progress: 0 },
  ] });
  const result = await client.getCurrentlyWatching();
  assert.deepEqual(result.data.map(x => x.id), ['fraction', 'seconds', 'milliseconds', 'nested']);
  assert.equal(result.total, 100);
  assert.equal(result.filtered_from_total, 8);
});

for (const payload of [null, [], {}, { data: null }, { data: [null] }, { data: [1] }, { data: [], total: -1 }]) {
  test(`malformed list: ${JSON.stringify(payload)}`, async () => {
    await assert.rejects(setup(payload).client.getWatchlist(), CrunchyrollApiError);
  });
}

for (const payload of [{}, { ...token, expires_in: 0 }, { ...token, expires_in: -1 }, { ...token, access_token: ' ' }, { ...token, token_type: 'Basic' }]) {
  test('malformed token is rejected without replacing session', async () => {
    const { client } = setup(payload);
    await assert.rejects(client.authenticateWithRtCookie({ cookie: session.cookie }), CrunchyrollApiError);
    assert.deepEqual(client.getSession(), session);
  });
}

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} preserves status and request ID`, async () => {
    const { client } = setup(() => json({ error_description: 'failure' }, { status, headers: { 'x-request-id': 'request' } }));
    await assert.rejects(client.getWatchlist(), error => {
      assert.ok(error instanceof (status === 401 || status === 403 ? CrunchyrollAuthError : CrunchyrollApiError));
      assert.equal(error.status, status);
      assert.equal(error.requestId, 'request');
      assert.match(error.message, /failure/);
      return true;
    });
  });
}

test('malformed JSON retains HTTP diagnostics', async () => {
  const { client } = setup(() => new Response('{', { status: 502, headers: { 'content-type': 'application/json', 'x-request-id': 'bad-json' } }));
  await assert.rejects(client.getWatchlist(), error => error instanceof CrunchyrollApiError && error.status === 502 && error.requestId === 'bad-json');
});

test('plain text HTTP errors and network errors use API errors', async () => {
  await assert.rejects(setup(() => new Response('unavailable', { status: 503 })).client.getWatchlist(), /unavailable/);
  await assert.rejects(setup(() => { throw new TypeError('connection lost'); }).client.getWatchlist(), CrunchyrollApiError);
});

test('timeout includes body consumption and recognizes custom fetch abort errors', async () => {
  const { client } = setup((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), { timeoutMs: 10 });
  await assert.rejects(client.getWatchlist(), /timed out after 10ms/);
  const body = setup((url, init) => new Response(new ReadableStream({ start(controller) {
    init.signal.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
  } })), { timeoutMs: 10 });
  await assert.rejects(body.client.getWatchlist(), /timed out after 10ms/);
});
