// Server-only entrypoint for @fikirtive/core.
//
// These modules statically import node builtins (url-safety → node:dns/promises)
// and perform server-side network I/O — they must NEVER enter a client bundle.
// They are kept OUT of the main "@fikirtive/core" barrel so that client
// components importing "@fikirtive/core" (e.g. ProductShowcase.tsx for the pure
// category/product helpers) don't drag node:dns into the browser chunk (which
// Turbopack cannot represent → /otto dev 500 / build error).
//
// Import these via "@fikirtive/core/server", never "@fikirtive/core".
//
// NOTE: no `import "server-only"` here — this package is also consumed by the
// worker (plain Node, non-RSC), where server-only's default export throws at
// import. The `server-only` hard guard lives in the Next.js app shims
// (apps/web/lib/url-safety.ts, apps/web/lib/fetch-extract.ts).
//
// The pure, browser-safe product-page parser (extractProductDraft / ProductDraft)
// stays in the main barrel — it has no node/network dependencies.
export { assertPublicHttpUrl, assertPublicHttpUrlResolved } from "./url-safety.js";
export { fetchAndExtract, fetchRawHtml, MAX_BODY } from "./fetch-extract.js";
