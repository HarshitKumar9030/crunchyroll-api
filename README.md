# crunchy-api

Unofficial, ESM-only Crunchyroll API client for Node.js 18.17 or newer. Use a maintained Node.js release for deployed applications.

## Features

- Cookie-based auth flow (`etp_rt_cookie` grant)
- Watchlist
- Watched anime / watch history
- Currently watching (derived from history progress signals)
- Crunchylists (custom lists)
- Crunchylist items
- Episode info
- Series and season metadata, plus series season listings
- Season episode list
- Lazy async pagination for watchlists, history, list items, and episodes
- Per-request cancellation and timeout overrides
- Developer Studio web app and searchable documentation
- Runtime validation of credentials, request parameters, and response envelopes
- Typed API, authentication, and validation errors

## Install

```bash
npm i crunchy-api
```

## Quick Start

```ts
import { CrunchyrollClient } from "crunchy-api";

const client = new CrunchyrollClient();

await client.authenticateWithRtCookie({
  cookie: process.env.CRUNCHYROLL_COOKIE ?? "", // e.g. "etp_rt=..."
});

const watchlist = await client.getWatchlist({ n: 25, start: 0, order: "desc" });
const currentlyWatching = await client.getCurrentlyWatching({ page_size: 30, page: 1 });
const crunchylists = await client.getCrunchylists();

console.log(watchlist.data.length, currentlyWatching.data.length, crunchylists.data.length);
```

## API

### `new CrunchyrollClient(options?)`

Main options:

- `baseUrl` (default: `https://beta-api.crunchyroll.com`; HTTPS origin only, without credentials, path, query, or fragment)
- `locale` (default: `en-US`)
- `timeoutMs` (default: `15000`; positive integer, at most `2147483647`; covers fetching and reading the response body)
- `fetchImpl` (optional custom fetch; must honor `signal` and `redirect: "error"`)
- `userAgent`, `defaultDeviceType` (optional request/device overrides)
- `anonymousBasicAuth`, `etpRtCookieBasicAuth` (optional authentication header overrides)
- `sendCookieWithContentRequests` (default: `true`)
- `allowCookieOnCustomBaseUrl` (default: `false`)

### Authentication

- `getAnonymousToken()`
- `authenticateWithRtCookie({ cookie, deviceType?, deviceId?, basicAuth? })`
- `setSession(session)`
- `getSession()`
- `clearSession()`
- `isAuthenticated()` (false when the token expires within 30 seconds)

### Content Endpoints

- `getWatchlist(query?)`
- `getWatchHistory(query?)`
- `getHistory(query?)` (alias of watch history)
- `getWatchedAnime(query?)` (alias of watch history)
- `getCurrentlyWatching(query?)`
- `getCrunchylists()`
- `getCrunchylistItems(listId, query?)`
- `getEpisodeInfo(episodeId, locale?)`
- `getSeasonEpisodes(seasonId, query?)`
- `getSeriesInfo(seriesId, locale?)`
- `getSeasonInfo(seasonId, locale?)`
- `getSeriesSeasons(seriesId, query?)`

Every network method accepts a final `CrunchyrollRequestOptions` argument with optional `signal` and `timeoutMs`. For `getCrunchylists()` and `getAnonymousToken()`, this is the first argument.

### Automatic pagination

```ts
for await (const entry of client.iterateWatchlist({ n: 50 }, { maxPages: 20 })) {
  console.log(entry.panel?.title);
}

for await (const episode of client.iterateSeasonEpisodes("season-id")) {
  console.log(episode.title);
}
```

Also available: `iterateWatchHistory(query?, options?)` and `iterateCrunchylistItems(listId, query?, options?)`. Default page size is 100 and the default cap is 1,000 pages. Iterators start at the supplied offset/page and stop on an empty page, the upstream total, a `break`, or the page cap. Reaching the cap completes normally and may produce a partial collection. Without a total, iteration may make one extra request to discover an empty page. Options accept `maxPages`, `signal`, and per-request `timeoutMs`.

### Cancellation

```ts
const controller = new AbortController();
const pending = client.getWatchlist({}, {
  signal: controller.signal,
  timeoutMs: 5_000,
});
controller.abort();
await pending; // Rejects with CrunchyrollAbortError.
```

Cancellation covers fetching and consuming the body. Already-aborted signals fail before fetching. `CrunchyrollAbortError` extends `CrunchyrollApiError`; timeouts remain API errors. Custom fetch implementations must honor the signal.

`getAnonymousToken()` returns a token without storing a session. To use a token from another source, call `setSession({ accessToken, tokenType: "Bearer", ... })`. Set `sendCookieWithContentRequests: false` for a bearer-only session. Watchlists require `profileId`; history and custom lists use `accountId`, falling back to `profileId`. `expiresAt` is a Unix timestamp in **milliseconds**.

Sessions are copied on input/output. Tokens are not refreshed automatically: authenticate again when a token expires. `isAuthenticated()` checks the stored token's local lifetime; it does not contact Crunchyroll to verify whether the token was revoked.

Pagination uses `n >= 1` and `start >= 0` for watchlists/season episodes, and `page_size >= 1` and `page >= 1` for history/custom-list items. Values must be integers. Query `locale` overrides the client default.

`getCurrentlyWatching()` filters only the requested history page using available completion/progress fields. `filtered_from_total` is the number of entries inspected on that page; `total` remains the upstream history total. Results are a heuristic, not a complete account-wide list. `getWatchedAnime()` returns history entries; it does not aggregate or deduplicate series.

Response envelopes and list-item object shapes are checked at runtime. Individual content fields remain optional and extensible because upstream payloads vary.

## Errors

```ts
import { CrunchyrollAbortError, CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from "crunchy-api";

try {
  await client.getWatchlist();
} catch (error) {
  if (error instanceof CrunchyrollAbortError) {
    // The caller cancelled the request.
  } else if (error instanceof CrunchyrollAuthError) {
    // Missing/expired local session, or HTTP 401/403: authenticate again.
  } else if (error instanceof CrunchyrollApiError) {
    console.error(error.status, error.requestId); // May be undefined for network failures.
  } else if (error instanceof CrunchyrollValidationError) {
    // Correct invalid options, credentials, IDs, or query parameters.
  } else {
    throw error;
  }
}
```

## Web app and documentation

**[Open Developer Studio and documentation](https://crunchy-api-studio.citrusmoon128.chatgpt.site)** (private Site).

The Developer Studio lives in [`web/studio`](web/studio). It includes searchable guides, an expandable API reference, highlighted code examples, a sample collection with browser-local favorites and JSON export, and an API playground. GSAP handles page and scroll animations; Framer Motion animates SVG scenes. Both respect reduced-motion preferences.

```bash
npm ci
npm --prefix web/studio ci
npm run web
```

Open `http://127.0.0.1:4173`. To make live read-only requests through the package, set `CRUNCHYROLL_COOKIE` in the server environment before launching. The browser does not receive the cookie or bearer token. The server binds only to `127.0.0.1`, validates Host/Origin headers, and exposes an allowlist of read methods. `CRUNCHY_STUDIO_PORT` overrides the port.

The hosted static version offers documentation and explicitly labeled sample data. Live account access requires the local Node.js server. Stars are browser-local and never update your Crunchyroll watchlist.

Run `npm run web:build` to bundle the static app into `web/studio/dist`.

## Development and verification

```bash
npm ci
npm run check
npm audit
npm pack --dry-run
```

The test suite uses deterministic mocked fetch responses and requires no account or credentials. `npm run check` also packs and installs the package in a temporary project, checks ESM imports and TypeScript usage, and verifies source-map targets. CI runs on Node.js 18, 22, 24, and 26. Packing builds `dist` automatically; source files are included so source and declaration maps resolve correctly. The package has no runtime dependencies.

These checks verify client behavior and packaging. Live Crunchyroll authentication, current upstream endpoint compatibility, and the bundled default client identifiers require a real authorized account to verify. Upstream behavior can change without notice.

## Security Notes

- Do not use `NEXT_PUBLIC_*` env vars for cookies or tokens.
- Use this package only in trusted server-side code.
- For both authentication and content requests, this client refuses to send cookies to non-default origins (including custom ports) unless you explicitly set `allowCookieOnCustomBaseUrl: true`.
- Redirects are rejected to prevent forwarding credentials to another endpoint.
- Cookie and header values are validated against control-character/header-injection patterns.
- Avoid logging session objects and raw cookies.

## Important Disclaimer

This is an unofficial package and is not affiliated with Crunchyroll.

You are responsible for complying with Crunchyroll Terms of Service and any applicable laws.
