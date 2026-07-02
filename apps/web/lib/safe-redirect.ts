/**
 * Sanitize a post-login `?from=` redirect target to a same-origin path.
 *
 * A path is only accepted if it starts with a single `/` NOT followed by another
 * `/` or a `\`. This rejects protocol-relative URLs (`//evil.com`) and backslash
 * smuggling (`/\evil.com`, which browsers normalize to protocol-relative), both of
 * which would otherwise pass a naive `startsWith("/")` check and open-redirect off
 * the origin. Anything else (schemes, empty, bare host) falls back to "/".
 */
export function sanitizeCallbackURL(from: string | undefined | null): string {
  return from && /^\/(?![/\\])/.test(from) ? from : "/";
}
