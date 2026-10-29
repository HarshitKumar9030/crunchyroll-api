import { randomBytes } from 'node:crypto';
import { createStudioApi } from './lib/studio-api.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CrunchyrollClient, CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from '../../dist/index.js';
import './build.mjs';

const hostname = '127.0.0.1';
const port = Number(process.env.CRUNCHY_STUDIO_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CRUNCHY_STUDIO_PORT.');
const origin = `http://${hostname}:${port}`;
const studioApi = createStudioApi({ secret: process.env.STUDIO_SESSION_SECRET || randomBytes(32).toString('hex') });
const client = new CrunchyrollClient();
let authentication;
async function authenticate() {
  if (client.isAuthenticated()) return;
  if (!process.env.CRUNCHYROLL_COOKIE) throw new CrunchyrollAuthError('Set CRUNCHYROLL_COOKIE on the local server first.');
  authentication ??= client.authenticateWithRtCookie({ cookie: process.env.CRUNCHYROLL_COOKIE }).finally(() => { authentication = undefined; });
  await authentication;
}
const assets = { '/aniway-mark.svg': ['aniway-mark.svg', 'image/svg+xml'], '/logo.svg': ['logo.svg', 'image/svg+xml'], '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.js.LEGAL.txt': ['app.js.LEGAL.txt', 'text/plain; charset=utf-8'] };
function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
}
const server = createServer(async (request, response) => {
  // Prevent DNS rebinding and cross-origin reads of the local account proxy.
  if (request.headers.host !== `${hostname}:${port}` || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Only same-origin loopback requests are accepted.' });
  if (new URL(request.url, origin).pathname === '/api/studio') return studioApi(request, response);
  if (request.method !== 'GET') return json(response, 405, { error: 'Only GET requests are supported.' });
  const url = new URL(request.url, origin);
  if (url.pathname === '/api/status') return json(response, 200, { configured: Boolean(process.env.CRUNCHYROLL_COOKIE) });
  if (url.pathname === '/api/request') {
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    const options = { signal: controller.signal };
    try {
      const endpoint = url.searchParams.get('endpoint');
      const id = url.searchParams.get('id') || '';
      const locale = url.searchParams.get('locale') || 'en-US';
      const operations = {
        watchlist: () => client.getWatchlist({ n: 100, locale }, options),
        history: () => client.getWatchHistory({ page_size: 25, locale }, options),
        lists: () => client.getCrunchylists(options),
        series: () => client.getSeriesInfo(id, locale, options),
        seasons: () => client.getSeriesSeasons(id, { locale }, options),
        episode: () => client.getEpisodeInfo(id, locale, options),
        episodes: () => client.getSeasonEpisodes(id, { n: 100, locale }, options),
      };
      if (!Object.hasOwn(operations, endpoint)) return json(response, 400, { error: 'Unsupported endpoint.' });
      await authenticate();
      const result = await operations[endpoint]();
      if (!response.destroyed) json(response, 200, result);
    } catch (error) {
      // Do not forward upstream messages or session credentials to the browser.
      const status = error instanceof CrunchyrollValidationError ? 400 : error instanceof CrunchyrollAuthError ? 401 : 502;
      if (!response.destroyed) json(response, status, { error: status === 400 ? 'Check the resource ID and request options.' : status === 401 ? 'Authentication failed. Check the server cookie or authenticate again.' : 'Upstream request failed. Try again later.', upstreamStatus: error instanceof CrunchyrollApiError ? error.status : undefined });
    }
    return;
  }
  const asset = assets[url.pathname];
  if (!asset) return json(response, 404, { error: 'Not found.' });
  try {
    response.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' https://s4.anilist.co; base-uri 'none'; frame-ancestors 'none'" });
    response.end(await readFile(new URL(`dist/${asset[0]}`, import.meta.url)));
  } catch { response.end('Unable to load asset. Run npm run web:build.'); }
});
server.listen(port, hostname, () => console.log(`Crunchy API Studio: ${origin}`));
