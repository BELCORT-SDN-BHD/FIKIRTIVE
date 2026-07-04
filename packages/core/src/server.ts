// Server-only entrypoint for @fikirtive/core.
//
// These modules statically import node builtins (url-safety → node:dns/promises)
// and perform server-side network I/O — they must NEVER enter a client bundle.
// They are kept OUT of the main "@fikirtive/core" barrel so that client
// components importing "@fikirtive/core" don't drag node:dns into the browser
// chunk (which Turbopack cannot represent → build error / 500).
//
// Import these via "@fikirtive/core/server", never "@fikirtive/core".
//
// NOTE: no `import "server-only"` here — this package is also consumed by the
// worker (plain Node, non-RSC), where server-only's default export throws at
// import. The `server-only` hard guard lives in the Next.js app shims
// (apps/web/lib/url-safety.ts, apps/web/lib/fetch-extract.ts).
export { assertPublicHttpUrl, assertPublicHttpUrlResolved } from "./url-safety.js";
export { fetchAndExtract, MAX_BODY } from "./fetch-extract.js";
