/**
 * #795 — the three PUBLIC Better Auth doors whose HOURLY cap lives in our own counter.
 *
 * They used to be `rateLimit.customRules` entries with a one-hour window. Better Auth's database
 * storage prunes its own rows on a 60-second cutoff that ignores the custom rule, so an hourly
 * budget of five silently became five per MINUTE the moment the counters moved to the database.
 * The full reasoning, and why raising Better Auth's global window is not the fix, is at
 * `PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR` in `rate-limit-gates.ts`.
 *
 * Better Auth's own short built-in rules still apply to all three underneath ours — burst is its
 * job, the hour is ours.
 *
 * WHY THIS LIST LIVES IN ITS OWN MODULE (r7). It was exported from the route file, and a Next
 * Route Handler may only export HTTP methods and the documented route config — anything else
 * fails the generated route-type check during `next build` (TS2344), which no test run and no
 * `tsc --noEmit` can see. Tests and the route now import the one list from here, so there is
 * still a single source of truth and no export the build refuses.
 */
export const HOURLY_PUBLIC_DOORS = [
  "/sign-up/email",
  "/request-password-reset",
  "/send-verification-email",
] as const;

export type HourlyPublicDoor = (typeof HOURLY_PUBLIC_DOORS)[number];
