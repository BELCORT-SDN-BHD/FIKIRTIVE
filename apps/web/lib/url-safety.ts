import "server-only";

// F16 / research-prep: the SSRF-guard logic now lives in @fikirtive/core so the background
// research worker (which cannot import apps/web/lib) can share it. This thin shim keeps the
// original apps/web import path stable and preserves the web-only `server-only` guard.
export { assertPublicHttpUrl, assertPublicHttpUrlResolved } from "@fikirtive/core/server";
