# Crunchy API Studio

A documentation app and developer playground for `crunchy-api`.

## Local development

From the repository root:

```sh
npm ci
npm --prefix web/studio ci
npm run web
```

Open http://127.0.0.1:4173. The local server bundles the app on startup. After source changes run `npm run web:build` and reload the browser. Changes to the server itself require a restart.

Open **Studio → Connection** to enter your own Crunchyroll `etp_rt` cookie value or cookie header. Only the `etp_rt` value is retained. It is exchanged server-side and encrypted with AES-256-GCM in an HttpOnly, SameSite=Strict cookie, capped at 30 minutes. HTTPS deployments use a Secure `__Host-` cookie. No credentials are returned to JavaScript or saved in localStorage. Each browser has its own session; clients are not shared between users.

The `/api/studio` endpoint accepts GET for connection status and same-origin JSON POST for connect, disconnect, or an allowlisted content request. It enforces an 8 KB request limit and masks upstream error details. The local proxy binds to loopback and validates Host/Origin headers. A local server automatically creates an ephemeral encryption key unless `STUDIO_SESSION_SECRET` is supplied; restarting it invalidates connections created with that ephemeral key.

The hosted static private Site links to the Vercel web app for live connections. It offers sample data without a backend. Favorites are browser-local and never modify the upstream account.

## Build

```sh
npm run web:build
```

The app uses esbuild, React, Framer Motion, GSAP, and Highlight.js. Output goes to `dist/`. Package dependencies stay separate from the SDK, which still has no runtime dependencies.

GSAP owns route entrances, scroll reveals, and hover interactions. Framer Motion owns animated SVG illustrations. Route cleanup kills scroll triggers, removes handlers, and unmounts React roots. Reduced-motion preferences disable nonessential animation; SVG loops pause while the document is hidden.

Code is highlighted locally for TypeScript, JavaScript, JSON, and Bash. Google Fonts are optional: system fallbacks keep the app usable if external fonts cannot load.

## Publication

`.openai/hosting.json` identifies the private Site and static directory. Publish the built `dist/` with the Sites source workflow. The local account proxy is not deployed with the static site.

## AniList artwork

The studio uses public cover metadata fetched from AniList's GraphQL API. `data/anilist-artwork.json` stores the matched media IDs, image URLs, titles, and source links for the sample collection. Posters link back to their AniList entries. No authentication or account data is used.

Refresh the five selected titles explicitly with `npm --prefix web/studio run artwork:refresh`. Normal builds use the snapshot, so an AniList API outage does not block deployment. Image failures retain a readable fallback. The hosted/local app permits AniList's image CDN in its image policy.

## Vercel

Import the repository with its root directory set to `.`. The root `vercel.json` explicitly selects the static build, installs the studio's dependencies, runs `npm run web:build`, and serves only `web/studio/dist`.

If you deliberately select `web/studio` as the Vercel project root, its own `vercel.json` runs the equivalent local commands and serves `dist`.

The legitimate `api/studio.js` serverless function handles the account connection; `STUDIO_SESSION_SECRET` must contain a random 32-byte key encoded as 64 hexadecimal characters, stored as a Vercel production secret. Never put this key in source control.

Do not deploy the package's `dist/index.js` as a server function: it is the SDK entrypoint, not an HTTP request handler. The standalone `server.mjs` development listener is not deployed. Vercel serves static assets plus the dedicated account API. The private static Site offers sample data and links to Vercel for account connections.
