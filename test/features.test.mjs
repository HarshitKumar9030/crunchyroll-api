import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { CrunchyrollClient, CrunchyrollAbortError, CrunchyrollApiError, CrunchyrollValidationError } from '../dist/index.js';
const session = { accessToken: 'token', tokenType: 'Bearer', profileId: 'profile', accountId: 'account' };
function setup(handler) {
  const calls = [];
  const client = new CrunchyrollClient({ sendCookieWithContentRequests: false, fetchImpl: async (url, init) => {
    calls.push({ url: new URL(url), init });
    return handler(new URL(url), init, calls.length);
  } });
  client.setSession(session);
  return { client, calls };
}
async function collect(iterator) { const items = []; for await (const item of iterator) items.push(item); return items; }
for (const [method, path] of [['getSeriesInfo', 'series'], ['getSeasonInfo', 'seasons']]) {
  test(`${method} supports object and array envelopes, encoding, and locale overrides`, async () => {
    for (const data of [{ id: 'item' }, [{ id: 'item' }]]) {
      const { client, calls } = setup(() => Response.json({ data }));
      assert.equal((await client[method]('id/with space', 'ja-JP')).id, 'item');
      assert.equal(calls[0].url.pathname, `/content/v2/cms/${path}/id%2Fwith%20space`);
      assert.equal(calls[0].url.searchParams.get('locale'), 'ja-JP');
      assert.equal(calls[0].init.headers.get('authorization'), 'Bearer token');
    }
  });
  test(`${method} rejects invalid IDs and malformed envelopes`, async () => {
    const invalid = setup(() => Response.json({ data: [] }));
    await assert.rejects(invalid.client[method]('..'), CrunchyrollValidationError);
    assert.equal(invalid.calls.length, 0);
    await assert.rejects(invalid.client[method]('id'), CrunchyrollApiError);
  });
}
test('getSeriesSeasons returns a validated list and locale', async () => {
  const { client, calls } = setup(() => Response.json({ total: 1, data: [{ id: 'season' }] }));
  assert.equal((await client.getSeriesSeasons('series/id', { locale: 'hi-IN' })).data[0].id, 'season');
  assert.equal(calls[0].url.pathname, '/content/v2/cms/series/series%2Fid/seasons');
  assert.equal(calls[0].url.searchParams.get('locale'), 'hi-IN');
});
for (const [method, args, key, expected] of [
 ['iterateWatchlist', [{ n: 10, start: 3 }], 'start', ['3','5','7']],
 ['iterateSeasonEpisodes', ['season', { n: 10, start: 3 }], 'start', ['3','5','7']],
 ['iterateWatchHistory', [{ page_size: 2, page: 2 }], 'page', ['2','3','4']],
 ['iterateCrunchylistItems', ['list', { page_size: 2, page: 2 }], 'page', ['2','3','4']],
]) {
  test(`${method} is lazy, preserves the query, and stops on an empty page`, async () => {
    const { client, calls } = setup((url, init, n) => Response.json({ data: n < 3 ? [{ id: `${n}-a` }, { id: `${n}-b` }] : [] }));
    const original = JSON.stringify(args);
    const iterator = client[method](...args);
    assert.equal(calls.length, 0);
    assert.equal((await collect(iterator)).length, 4);
    assert.deepEqual(calls.map(call => call.url.searchParams.get(key)), expected);
    assert.equal(JSON.stringify(args), original);
  });
  test(`${method} respects maxPages without requiring an upstream total`, async () => {
    const { client, calls } = setup(() => Response.json({ data: [{ id: 'item' }] }));
    assert.equal((await collect(client[method](...args, { maxPages: 2 }))).length, 2);
    assert.equal(calls.length, 2);
  });
}
test('iterators stop at total, and breaking prevents prefetch', async () => {
  const { client, calls } = setup(() => Response.json({ data: [{ id: 'first' }, { id: 'second' }], total: 2 }));
  assert.equal((await collect(client.iterateWatchlist())).length, 2);
  assert.equal(calls.length, 1);
  for await (const entry of client.iterateWatchlist()) { assert.equal(entry.id, 'first'); break; }
  assert.equal(calls.length, 2);
});
test('numbered pagination counts actual returned entries when upstream caps page size', async () => {
  const { client, calls } = setup(() => Response.json({ data: [{ id: 'item' }], total: 3 }));
  assert.equal((await collect(client.iterateWatchHistory({ page_size: 100 }))).length, 3);
  assert.equal(calls.length, 3);
});
test('iterator errors propagate and invalid limits fail before fetching', async () => {
  const { client, calls } = setup(() => Response.json({ error: 'upstream' }, { status: 500 }));
  for (const maxPages of [0, -1, 1.5, Infinity]) await assert.rejects(collect(client.iterateWatchlist({}, { maxPages })), CrunchyrollValidationError);
  assert.equal(calls.length, 0);
  await assert.rejects(collect(client.iterateWatchlist()), CrunchyrollApiError);
});
test('cancelling an iterator stops before yielding more entries', async () => {
  const { client, calls } = setup(() => Response.json({ data: [{ id: 'first' }, { id: 'second' }] }));
  const controller = new AbortController();
  const iterator = client.iterateWatchlist({}, { signal: controller.signal });
  assert.equal((await iterator.next()).value.id, 'first');
  controller.abort();
  await assert.rejects(iterator.next(), CrunchyrollAbortError);
  assert.equal(calls.length, 1);
});
test('all content methods and aliases accept an already-cancelled signal', async () => {
  const { client, calls } = setup(() => Response.json({ data: [] }));
  const controller = new AbortController(); controller.abort();
  const options = { signal: controller.signal };
  const operations = [
    () => client.getAnonymousToken(options),
    () => client.authenticateWithRtCookie({ cookie: 'etp_rt=test' }, options),
    () => client.getWatchlist({}, options), () => client.getWatchHistory({}, options),
    () => client.getHistory({}, options), () => client.getWatchedAnime({}, options),
    () => client.getCurrentlyWatching({}, options), () => client.getCrunchylists(options),
    () => client.getCrunchylistItems('list', {}, options),
    () => client.getEpisodeInfo('episode', undefined, options),
    () => client.getSeasonEpisodes('season', {}, options),
    () => client.getSeriesInfo('series', undefined, options),
    () => client.getSeasonInfo('season', undefined, options),
    () => client.getSeriesSeasons('series', {}, options),
  ];
  for (const operation of operations) await assert.rejects(operation(), CrunchyrollAbortError);
  assert.equal(calls.length, 0);
});
test('in-flight cancellation is distinct from timeout and releases its listener', async () => {
  const controller = new AbortController();
  const { client } = setup((url, init) => new Promise((resolve,reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
  }));
  const pending = client.getWatchlist({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, CrunchyrollAbortError);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('successful requests release cancellation listeners', async () => {
  const controller = new AbortController();
  const { client } = setup(() => Response.json({ data: [] }));
  await client.getWatchlist({}, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('per-request timeout overrides the client default and validates its range', async () => {
  const controller = new AbortController();
  const { client, calls } = setup((url, init) => new Promise((resolve,reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  await assert.rejects(client.getWatchlist({}, { timeoutMs: 0 }), CrunchyrollValidationError);
  assert.equal(calls.length, 0);
  await assert.rejects(client.getWatchlist({}, { timeoutMs: 5, signal: controller.signal }), error => error instanceof CrunchyrollApiError && !(error instanceof CrunchyrollAbortError) && /5ms/.test(error.message));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('public request options cannot override internal auth or headers', async () => {
  const { client, calls } = setup(() => Response.json({ data: [] }));
  await client.getWatchlist({}, { useBearerAuth: false, headers: { authorization: 'attacker' } });
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer token');
});
