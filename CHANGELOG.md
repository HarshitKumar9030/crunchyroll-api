# Changelog

## 0.2.0

- Add series details, season details, and series season listings.
- Add lazy pagination iterators for watchlists, history, custom-list items, and season episodes.
- Support per-request AbortSignal cancellation and timeout overrides, with CrunchyrollAbortError for cancellation.
- Add Developer Studio: searchable guides, API reference, sample collections, favorites, JSON export, and a request playground.
- Add an optional loopback-only Node.js proxy that uses server environment credentials for live read-only account requests.
- Add GSAP page and scroll animations, Framer Motion SVG illustrations, and syntax highlighting for TypeScript, JavaScript, JSON, and shell examples.

## 0.1.2

- Enforce cookie origin restrictions for both authentication and content requests, including non-default ports, and reject redirects.
- Validate session credentials, expiry, cookie names, request options, pagination, IDs, and token/list responses.
- Preserve HTTP status and request IDs for malformed JSON; classify HTTP 401/403 as authentication errors.
- Make authentication status account for the same 30-second expiry margin used by requests.
- Fix currently-watching filtering to respect completion flags and compare matching time units.
- Update TypeScript, replace rimraf with Node's built-in filesystem API, and synchronize npm/pnpm lockfiles.
- Build packages during packing, include source files for source/declaration maps, and add regression tests and CI.
