/**
 * #795 — the PUBLIC Better Auth doors whose HOURLY cap lives in our own counter.
 *
 * SIGNIN-A4 —— 这份清单原本有三道门：`/sign-up/email`（密码注册）、`/request-password-reset`
 * （忘记密码）与 `/send-verification-email`（验证信重发）。密码整体退役之后
 * （docs/specs/sign-in.md 已冻结 · v1 §1.4「密码凭据退役」明写「`HOURLY_PUBLIC_DOORS` 里的
 * 密码门一并撤下」），前两道在 router 层就 404 —— 留着它们不是多一道闸，而是**少一个 404**：
 * 闸跑在转发之前，所以第 6 次请求会拿到 429 而不是 A4 要求的「一律 404」，一个已经退役的
 * 端点反倒因此可被探测出「这里以前有东西」。所以它们随门一起撤，剩下真正还开着的这一道。
 *
 * 剩下的这道门（验证信重发）为什么还在：它不属于密码那条链，`emailVerification` 仍然配着。
 *
 * They used to be `rateLimit.customRules` entries with a one-hour window. Better Auth's database
 * storage prunes its own rows on a 60-second cutoff that ignores the custom rule, so an hourly
 * budget of five silently became five per MINUTE the moment the counters moved to the database.
 * The full reasoning, and why raising Better Auth's global window is not the fix, is at
 * `PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR` in `rate-limit-gates.ts`.
 *
 * Better Auth's own short built-in rules still apply underneath ours — burst is its job, the
 * hour is ours.
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
export const HOURLY_PUBLIC_DOORS = ["/send-verification-email"] as const;

export type HourlyPublicDoor = (typeof HOURLY_PUBLIC_DOORS)[number];
