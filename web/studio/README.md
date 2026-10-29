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

To enable live read-only account requests, supply `CRUNCHYROLL_COOKIE` to the server environment. No cookie-entry UI exists: credentials are exchanged and retained on the server. The proxy uses the local package build, binds to loopback, validates Host/Origin headers, and allows only predefined read methods. The status endpoint reports whether a cookie is configured; it does not validate that cookie.

The static hosted app always offers a clearly labeled sample-data mode. It cannot connect to a visitor's localhost server. Favorites are browser-local; they never mutate an upstream account.

## Build

```sh
npm run web:build
```

The app uses esbuild, React, Framer Motion, GSAP, and Highlight.js. Output goes to `dist/`. Package dependencies stay separate from the SDK, which still has no runtime dependencies.

GSAP owns route entrances, scroll reveals, and hover interactions. Framer Motion owns animated SVG illustrations. Route cleanup kills scroll triggers, removes handlers, and unmounts React roots. Reduced-motion preferences disable nonessential animation; SVG loops pause while the document is hidden.

Code is highlighted locally for TypeScript, JavaScript, JSON, and Bash. Google Fonts are optional: system fallbacks keep the app usable if external fonts cannot load.

## Publication

`.openai/hosting.json` identifies the private Site and static directory. Publish the built `dist/` with the Sites source workflow. The local account proxy is not deployed with the static site.
