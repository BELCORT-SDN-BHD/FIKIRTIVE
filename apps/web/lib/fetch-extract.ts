import "server-only";

// F16 / research-prep: fetchAndExtract + MAX_BODY now live in @fikirtive/core so the background
// research worker (which cannot import apps/web/lib) can share the SSRF-hardened fetch. This thin
// shim keeps the original apps/web import path stable and preserves the web-only `server-only`
// guard — it must NOT be a `"use server"` module (that would make fetchAndExtract, which has no
// auth guard, a POSTable cross-tenant Server Action).
export { fetchAndExtract, fetchRawHtml, MAX_BODY } from "@fikirtive/core";
