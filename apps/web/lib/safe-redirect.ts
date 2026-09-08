/**
 * Sanitize a post-login `?from=` redirect target to a same-origin path.
 *
 * A path is only accepted if it starts with a single `/` NOT followed by another
 * `/` or a `\`. This rejects protocol-relative URLs (`//evil.com`) and backslash
 * smuggling (`/\evil.com`, which browsers normalize to protocol-relative), both of
 * which would otherwise pass a naive `startsWith("/")` check and open-redirect off
 * the origin. The path must also contain no ASCII control characters or whitespace
 * (tab, LF, CR, NUL, other C0 controls, space) anywhere in the string, because
 * WHATWG URL parsing strips tab/LF/CR before resolving a URL — without this, a
 * value like `/\t/evil.com` would pass a first-character-only check and still
 * become `https://evil.com/` once the browser parses it. Anything else (schemes,
 * empty, bare host) falls back to "/".
 */
export function sanitizeCallbackURL(from: string | undefined | null): string {
  return from && /^\/(?![/\\])[^\x00-\x20\x7F]*$/.test(from) ? from : "/";
}
