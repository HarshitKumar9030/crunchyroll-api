import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CrunchyrollClient, CrunchyrollAuthError, CrunchyrollValidationError } from 'crunchy-api';

const SESSION_SECONDS = 1800;
const MAX_BODY_BYTES = 8192;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function normalizeCookie(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096 || /[\x00-\x1f\x7f-\uffff]/.test(input)) {
    throw new HttpError(400, 'Paste a valid etp_rt cookie value or cookie header.');
  }
  const text = input.trim();
  const match = /(?:^|;\s*)etp_rt=([^;\s]+)/.exec(text);
  if (!match && /(?:^|;\s*)etp_rt=/.test(text)) throw new HttpError(400, 'The etp_rt cookie value is empty.');
  const value = match ? match[1] : text;
  if (!/^[A-Za-z0-9._~%+/-]+=*$/.test(value)) throw new HttpError(400, 'The cookie must contain an etp_rt value.');
  return `etp_rt=${value}`;
}
function seal(session, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('crunchy-studio-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value, key, now) {
  try {
    if (!value || value.length > 3800) return null;
    const data = Buffer.from(value, 'base64url');
    if (data.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from('crunchy-studio-v1'));
    decipher.setAuthTag(data.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
    if (!Number.isFinite(session.expiresAt) || now() + 30000 >= session.expiresAt) return null;
    return session;
  } catch { return null; }
}
async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  }
  let body = request.body;
  if (body === undefined) {
    body = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      request.on('data', chunk => { size += Buffer.byteLength(chunk); if (size <= MAX_BODY_BYTES) chunks.push(Buffer.from(chunk)); });
      request.on('end', () => size > MAX_BODY_BYTES ? reject(new HttpError(413, 'Request is too large.')) : resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', () => reject(new HttpError(400, 'Unable to read request.')));
    });
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
    try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.');
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  return body;
}
function send(response, status, data) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store, private');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.statusCode = status;
  response.end(JSON.stringify(data));
}

/** Each browser has its own authenticated, encrypted session; clients are never shared. */
export function createStudioApi({ secret = process.env.STUDIO_SESSION_SECRET, createClient = () => new CrunchyrollClient(), now = Date.now } = {}) {
  const key = typeof secret === 'string' && /^[a-f0-9]{64}$/i.test(secret) ? Buffer.from(secret, 'hex') : null;
  return async function studioApi(request, response) {
    const secure = request.headers['x-forwarded-proto'] === 'https' || Boolean(request.socket?.encrypted);
    const name = secure ? '__Host-crunchy_studio' : 'crunchy_studio';
    const setCookie = (value, seconds) => response.setHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
    const cookieHeader = typeof request.headers.cookie === 'string' ? request.headers.cookie : '';
    const encrypted = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    const session = key ? unseal(encrypted, key, now) : null;
    if (request.method === 'GET') {
      if (encrypted && !session) setCookie('', 0);
      return send(response, 200, { available: Boolean(key), connected: Boolean(session), ...(session ? { expiresAt: session.expiresAt } : {}) });
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'GET, POST');
      return send(response, 405, { error: 'Only GET and POST are supported.' });
    }
    try {
      const origin = request.headers.origin;
      const expected = `${secure ? 'https' : 'http'}://${request.headers.host}`;
      if (origin !== expected || request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Only same-origin requests are accepted.');
      if (!key) throw new HttpError(503, 'Account connections are not configured on this host.');
      const body = await readJson(request);
      if (body.action === 'disconnect') {
        setCookie('', 0);
        return send(response, 200, { connected: false });
      }
      if (body.action === 'connect') {
        const cookie = normalizeCookie(body.cookie);
        const client = createClient();
        const authenticated = await client.authenticateWithRtCookie({ cookie });
        const expiresAt = Math.min(authenticated.expiresAt ?? now() + SESSION_SECONDS * 1000, now() + SESSION_SECONDS * 1000);
        if (expiresAt <= now() + 30000) throw new HttpError(401, 'The Crunchyroll session is already expired.');
        const stored = { accessToken: authenticated.accessToken, tokenType: authenticated.tokenType, expiresAt, cookie };
        if (authenticated.profileId !== undefined) stored.profileId = authenticated.profileId;
        if (authenticated.accountId !== undefined) stored.accountId = authenticated.accountId;
        const value = seal(stored, key);
        if (value.length > 3800) throw new HttpError(400, 'The session is too large. Paste only the etp_rt cookie value.');
        setCookie(value, Math.max(1, Math.floor((expiresAt - now()) / 1000)));
        return send(response, 200, { connected: true, expiresAt });
      }
      if (body.action !== 'request') throw new HttpError(400, 'Unsupported action.');
      if (!session) { setCookie('', 0); throw new HttpError(401, 'Connect your Crunchyroll account first.'); }
      const client = createClient();
      client.setSession(session);
      const id = typeof body.id === 'string' ? body.id : '';
      const locale = typeof body.locale === 'string' ? body.locale : 'en-US';
      const operations = {
        watchlist: () => client.getWatchlist({ n: 100, locale }),
        history: () => client.getWatchHistory({ page_size: 25, locale }),
        lists: () => client.getCrunchylists(),
        series: () => client.getSeriesInfo(id, locale),
        seasons: () => client.getSeriesSeasons(id, { locale }),
        episode: () => client.getEpisodeInfo(id, locale),
        episodes: () => client.getSeasonEpisodes(id, { n: 100, locale }),
      };
      if (typeof body.endpoint !== 'string' || !Object.hasOwn(operations, body.endpoint)) throw new HttpError(400, 'Unsupported endpoint.');
      return send(response, 200, await operations[body.endpoint]());
    } catch (error) {
      if (error instanceof HttpError) return send(response, error.status, { error: error.message });
      if (error instanceof CrunchyrollValidationError) return send(response, 400, { error: 'Check the cookie value, resource ID, and request options.' });
      if (error instanceof CrunchyrollAuthError || error?.status === 401 || error?.status === 403) {
        if (request.method === 'POST' && session) setCookie('', 0);
        return send(response, 401, { error: 'Crunchyroll rejected the session. Copy a fresh etp_rt cookie from your logged-in browser and try again.' });
      }
      return send(response, 502, { error: 'Crunchyroll could not complete the request. Please try again later.' });
    }
  };
}
