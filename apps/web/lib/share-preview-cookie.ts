/**
 * SHARE-A6 (docs/specs/share-preview.md 已冻结 · v1) — the ONE name and scope for the HttpOnly
 * cookie that now carries a share-preview token, instead of the token riding in a URL.
 *
 * Two readers share this: `app/s/[token]/route.ts` WRITES it (the clean entry point every link —
 * new or a legacy `?t=` one redirected through it — passes through), and
 * `app/schedule/share-preview/page.tsx` READS it. A name or a scope split across the two would be
 * the quiet kind of bug: one side changes it, the other silently stops finding the cookie.
 *
 * Zero imports, zero I/O — a constants module, not a data module (same class as
 * `lib/media-public-link.ts`, which the public page's own import fence already treats that way).
 */

/** The cookie's name. */
export const SHARE_PREVIEW_COOKIE_NAME = "sp_t";

/**
 * The ONE path this cookie is sent to. Scoping it here (rather than site-wide) means the token
 * never rides along on requests to anything else this browser happens to visit next.
 */
export const SHARE_PREVIEW_COOKIE_PATH = "/schedule/share-preview";
