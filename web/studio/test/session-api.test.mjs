import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CrunchyrollAuthError } from 'crunchy-api';
import { createStudioApi } from '../lib/studio-api.mjs';

let server, origin;
let clock = Date.now();
const authenticatedCookies = [];
const secret = 'ab'.repeat(32); // Test-only key; production is configured outside source control.
const api = createStudioApi({ secret, now: () => clock, createClient: () => {
  let current;
  return {
    async authenticateWithRtCookie({ cookie }) {
      authenticatedCookies.push(cookie);
      if (cookie.includes('rejected')) throw new CrunchyrollAuthError('private upstream detail: etp_rt=rejected');
      return { accessToken: `access-${cookie.slice(7)}`, tokenType: 'Bearer', cookie, accountId: 'account', profileId: 'profile', refreshToken: 'never-store-this', expiresAt: clock + 3600000 };
    },
    setSession(session) { current = session; },
    async getWatchlist() { return { data: [{ id: current.accessToken }], total: 1 }; },
    async getEpisodeInfo(id) { if (!id) throw new Error('private server failure'); return { id }; },
  };
} });
before(async () => {
  server = createServer(api);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); });
async function post(body, cookie, extraHeaders = {}) {
  return fetch(origin, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) });
}
async function connect(value) {
  const response = await post({ action: 'connect', cookie: value });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('status exposes capabilities without account data', async () => {
  const response = await fetch(origin);
  assert.deepEqual(await response.json(), { available: true, connected: false });
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('connect accepts raw values, discards unrelated cookies, and encrypts credentials', async () => {
  const response = await post({ action: 'connect', cookie: 'other=discard; etp_rt=fixture-token; tracking=discard' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=1800/);
  assert.ok(!cookie.includes('fixture-token'));
  assert.ok(!cookie.includes('access-'));
  const payload = await response.json();
  assert.deepEqual(payload, { connected: true, expiresAt: clock + 1800000 });
  assert.equal(authenticatedCookies.at(-1), 'etp_rt=fixture-token');
  assert.ok(!JSON.stringify(payload).includes('refreshToken'));
  const encrypted = cookie.split(';')[0];
  const status = await (await fetch(origin, { headers: { cookie: encrypted } })).json();
  assert.equal(status.connected, true);
});
test('browser sessions are isolated across concurrent requests', async () => {
  const [first, second] = await Promise.all([connect('first-user'), connect('second-user')]);
  const results = await Promise.all([post({ action: 'request', endpoint: 'watchlist' }, first), post({ action: 'request', endpoint: 'watchlist' }, second)]);
  assert.equal((await results[0].json()).data[0].id, 'access-first-user');
  assert.equal((await results[1].json()).data[0].id, 'access-second-user');
});
test('tampered sessions fail closed and never invoke content requests', async () => {
  const original = await connect('tamper-test');
  const [name, value] = original.split('=');
  const tampered = `${name}=${value[0] === 'a' ? 'b' : 'a'}${value.slice(1)}`;
  const response = await post({ action: 'request', endpoint: 'watchlist' }, tampered);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
test('expired sessions are rejected and cleared', async () => {
  const cookie = await connect('expires-test');
  clock += 1800001;
  const response = await post({ action: 'request', endpoint: 'watchlist' }, cookie);
  assert.equal(response.status, 401);
  clock -= 1800001;
});
test('disconnect clears the encrypted session cookie', async () => {
  const cookie = await connect('disconnect-test');
  const response = await post({ action: 'disconnect' }, cookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await response.json(), { connected: false });
});
test('production sessions use the Secure __Host prefix', async () => {
  const response = await post({ action: 'connect', cookie: 'secure-test' }, null, { 'x-forwarded-proto': 'https', origin: origin.replace('http:', 'https:') });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /^__Host-crunchy_studio=/);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  assert.ok(!response.headers.get('set-cookie').includes('Domain='));
});
test('cross-origin, missing-origin, and cross-site POSTs are rejected', async () => {
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await post({ action: 'connect', cookie: 'test' }, null, headers)).status, 403);
  }
});
test('invalid cookies fail without sending upstream requests', async () => {
  const before = authenticatedCookies.length;
  for (const cookie of ['', 'etp_rt=', 'etp_rt=bad\r\nvalue', 'not_etp_rt=token', 'x'.repeat(4097)]) {
    assert.equal((await post({ action: 'connect', cookie })).status, 400);
  }
  assert.equal(authenticatedCookies.length, before);
});
test('upstream auth errors return a useful message without credentials', async () => {
  const response = await post({ action: 'connect', cookie: 'rejected' });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.match(payload.error, /fresh etp_rt cookie/);
  assert.ok(!JSON.stringify(payload).includes('etp_rt=rejected'));
});
test('unsupported actions/endpoints, oversized bodies, and non-JSON requests are rejected', async () => {
  assert.equal((await post({ action: 'arbitrary' })).status, 400);
  const cookie = await connect('endpoint-test');
  assert.equal((await post({ action: 'request', endpoint: 'constructor' }, cookie)).status, 400);
  assert.equal((await post({ action: 'connect', cookie: 'x'.repeat(9000) })).status, 413);
  assert.equal((await post({ action: 'connect', cookie: 'test' }, null, { 'content-type': 'text/plain' })).status, 415);
});
test('upstream failures do not expose server error details', async () => {
  const cookie = await connect('failure-test');
  const response = await post({ action: 'request', endpoint: 'episode' }, cookie);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private server failure'));
});
