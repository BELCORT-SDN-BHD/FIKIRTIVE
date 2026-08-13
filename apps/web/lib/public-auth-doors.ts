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
 * WHY THIS LIST LIVES IN ITS OWN MODULE (r7), and what was MEASURED rather than assumed.
 *
 * Up to r6 the list was an extra `export` in the route file so the test could import the one
 * copy. Review called that a build-breaker: a Next Route Handler may only export HTTP methods,
 * so `next build` would refuse the extra export with TS2344. That was checked here and it is
 * NOT true of this app — the r6 file was restored verbatim and `pnpm --filter @fikirtive/web
 * build` passed (exit 0, TypeScript pass included). The reason is which bundler we run: the
 * exact-fields guard (`checkFields<Diff<…>>`) lives in the WEBPACK `NextTypesPlugin`, and this
 * app builds with Turbopack, whose generated `.next/types/validator.ts` checks each route with a
 * plain `extends RouteHandlerConfig<…>` constraint. A plain constraint is satisfied by extra
 * properties, so the export was accepted.
 *
 * The list moved here anyway, and not to appease that finding:
 *   · a route file is a request entry point, not a place other modules read data out of — the
 *     test importing from it was the actual smell;
 *   · the tolerance above is a property of Turbopack's generated validator, not of Next's
 *     contract. Switching bundlers, or Next tightening that validator, would turn a documented
 *     rule we are currently on the right side of by luck into a build failure.
 * The route and the tests both import from here, so there is still exactly one list.
 */
export const HOURLY_PUBLIC_DOORS = [
  "/sign-up/email",
  "/request-password-reset",
  "/send-verification-email",
] as const;

export type HourlyPublicDoor = (typeof HOURLY_PUBLIC_DOORS)[number];
