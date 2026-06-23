/**
 * describe-refs.helpers — pure, DB-free helper.
 * No imports from @artlio/db or @openai/agents — fully unit-testable without mocking.
 */

/**
 * Strip control characters (Cc Unicode category), collapse whitespace, trim, and cap at 600 chars.
 * Mirrors coworkTurn:449 — prevents a cached description from injecting instructions into a
 * future system prompt.
 */
export function sanitizeRefDescription(s: string): string {
  return s
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
