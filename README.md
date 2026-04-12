# crunchy-api

Unofficial Crunchyroll API client for Node.js.

## Features

- Cookie-based auth flow (`etp_rt_cookie` grant)
- Watchlist
- Watched anime / watch history
- Currently watching (derived from history progress signals)
- Crunchylists (custom lists)
- Crunchylist items
- Episode info
- Season episode list
- Strict runtime validation and safer error handling

## Install

```bash
npm i crunchy-api
```

## Quick Start

```ts
import { CrunchyrollClient } from "crunchy-api";

const client = new CrunchyrollClient();

await client.authenticateWithRtCookie({
  cookie: process.env.CRUNCHYROLL_COOKIE ?? "",
});

const watchlist = await client.getWatchlist({ n: 25, start: 0, order: "desc" });
const currentlyWatching = await client.getCurrentlyWatching({ page_size: 30, page: 1 });
const crunchylists = await client.getCrunchylists();

console.log(watchlist.data.length, currentlyWatching.data.length, crunchylists.data.length);
```

## API

### `new CrunchyrollClient(options?)`

Main options:

- `baseUrl` (default: `https://beta-api.crunchyroll.com`)
- `locale` (default: `en-US`)
- `timeoutMs` (default: `15000`)
- `fetchImpl` (optional custom fetch)
- `sendCookieWithContentRequests` (default: `true`)
- `allowCookieOnCustomBaseUrl` (default: `false`)

### Authentication

- `getAnonymousToken()`
- `authenticateWithRtCookie({ cookie, deviceType?, deviceId?, basicAuth? })`
- `setSession(session)`
- `getSession()`
- `clearSession()`

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

## Security Notes

- Do not use `NEXT_PUBLIC_*` env vars for cookies or tokens.
- Use this package only in trusted server-side code.
- This client refuses to send cookies to non-default hosts unless you explicitly set `allowCookieOnCustomBaseUrl: true`.
- Cookie and header values are validated against CRLF/header-injection patterns.
- Avoid logging session objects and raw cookies.

## Important Disclaimer

This is an unofficial package and is not affiliated with Crunchyroll.

You are responsible for complying with Crunchyroll Terms of Service and any applicable laws.