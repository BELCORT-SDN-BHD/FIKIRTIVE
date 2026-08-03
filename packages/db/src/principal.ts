/**
 * #463 — request-level principal pipeline (the CARRIER only; zero enforcement).
 *
 * This module establishes and carries "who is acting" through async call chains via
 * AsyncLocalStorage. It reads nothing, writes nothing, and blocks nothing: the tenant
 * guard (./tenant-guard.ts) is deliberately untouched by #463 — wiring the guard to
 * this store is #464.
 *
 * Placement rationale (see the #463 design contract, §1):
 *  - It lives in `@fikirtive/db` because `packages/db` is the ONE package Next.js keeps
 *    external (`serverExternalPackages` in apps/web/next.config.ts). A store bundled in
 *    one graph and read from another would be two distinct AsyncLocalStorage objects and
 *    `getStore()` would silently return undefined forever.
 *  - It is reachable ONLY through the `@fikirtive/db/principal` subpath, never the package
 *    barrel: 79 test files do factory-style `vi.mock("@fikirtive/db", …)`, which replaces
 *    the whole module — they would silently lose these exports.
 *  - `packages/db` has zero workspace dependencies; this file keeps it that way (pure TS +
 *    node:async_hooks, no Prisma import).
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The CLOSED vocabulary of system-frame names (design contract §4) — do not invent a third
 * naming scheme beside the schema's existing `actorKind` values. Closed on purpose: #464 keys
 * decisions on `reason`, and a free-form `string` would let `"gen-reaper "` compile and pass
 * every gate.
 *
 * `"tenant-direct"` is the odd one out: it is not a caller-chosen name but the fallback
 * `runAsTenant` assigns when there is no enclosing system frame to inherit a name from.
 */
export type SystemReason =
  | "auth:converge-identity"
  | "auth:bootstrap-personal-org"
  | "stripe-webhook"
  | "meta-data-deletion"
  | "worker-heartbeat"
  | "worker-job-dispatch"
  | "worker-reaper-tick"
  | "gen-reaper"
  | "refgen-reaper"
  | "llm-reservation-reaper"
  | "research-reaper"
  | "publish-reaper"
  | "ingest-redispatch"
  | "publish-scheduler"
  | "test-seed"
  | "tenant-direct";

/**
 * Who is acting.
 *
 * `actor` and `subject` are deliberately separate: under admin impersonation the SUBJECT is
 * the merchant (session user, merchant org) while the ACTOR is the founder staff member,
 * recorded only as `impersonatedByBaUserId`.
 *
 * The two role axes are NEVER merged (packages/core/src/org-roles.ts:1-2 forbids it):
 * `orgRole` is the compatibility primary role on the per-org membership axis. The platform-staff axis
 * (`Role`: super-admin|ops|finance|moderator|viewer) is NOT carried here — it belongs to
 * requireRole and the admin console, not to tenant scoping.
 *
 * Note the two id spaces: `subjectUserId` is a `User.id`, `impersonatedByBaUserId` is a
 * `BetterAuthUser.id`. They are different id spaces that join only by lowercased email
 * (apps/web/lib/tenant-actions.ts:20-21).
 */
export type Principal =
  | {
      kind: "user";
      /**
       * `User.id`.
       *
       * NULL IS NOW REACHABLE (②-B / #464). Under #463 the only producers were the four CRM
       * gateways, and they throw `ACTION_DENIED` before an unresolved membership can become a
       * principal, so null was unreachable then. `apps/web/lib/auth-guard.ts`
       * `resolveUserPrincipal` — the ambient frame's resolver for the bare server actions and
       * route handlers — must NOT deny (that would be a behaviour change), so it DEGRADES on a
       * membership miss and leaves this null. The founder-admin path (`ownerId: "founder"`, no
       * membership row in the founder org) is the live case. Read null as "this frame did not
       * resolve a membership", never as "no membership exists".
       */
      subjectUserId: string | null;
      subjectEmail: string;
      /** The org being acted upon (the subject org). */
      ownerId: string;
      /** Compatibility `Membership.role` in `ownerId`. Authorization uses MembershipRole. */
      orgRole: "owner" | "admin" | "member" | "creator" | "approver" | null;
      /**
       * `Membership.id` of the acting member in `ownerId` — the same id the CRM gateways
       * already hand their services, carried here so a reader needs no second query.
       * Null is reachable — see `subjectUserId`.
       */
      membershipId: string | null;
      /** Whether this session is an admin impersonation (compat's `isImpersonating()`). */
      impersonating: boolean;
      /**
       * `BetterAuthUser.id` of the impersonating staff member.
       *
       * #463 ALWAYS fills this with `null`. Reading the real id needs a `compat.ts` extension
       * that this ticket deliberately does not make (compat stays zero-diff), so the value is
       * deferred to ②-D. Until then `impersonating` is the honest signal and `null` here means
       * "not carried yet", NOT "nobody" — do not treat it as evidence of a direct session.
       */
      impersonatedByBaUserId: string | null;
    }
  | {
      kind: "system";
      /** Named, closed vocabulary — see {@link SystemReason}. */
      reason: SystemReason;
      /**
       * Two-phase system work: null during a cross-tenant scan segment, and the row's tenant
       * during the per-row write segment (see `runAsTenant`).
       */
      ownerId: string | null;
    };

/** The `kind: "user"` half of {@link Principal}. */
export type UserPrincipal = Extract<Principal, { kind: "user" }>;

/**
 * The store is pinned on `globalThis` under a well-known symbol so that a double module
 * resolution (bundled copy vs. dist copy, or two pnpm instances) cannot produce two
 * AsyncLocalStorage objects — which would make `getPrincipal()` return undefined forever,
 * silently. `principal.test.ts` pins this instance identity.
 *
 * DELIBERATELY NOT EXPORTED. The symbol is in the GLOBAL symbol registry, so anyone who wants
 * the raw store can still write `Symbol.for("fikirtive.principal.als")` themselves — not
 * exporting it does not make that impossible, it removes the supported handle that made it look
 * sanctioned. The honest scope of this module's safety claim:
 *  - the SUPPORTED RUNNERS (`runAsSystem` / `runAsTenant` / `runAsUser`) cannot bleed a principal
 *    across requests: each one is `store.run(frame, fn)`, whose frame pops with the callback; and
 *  - production code contains no `enterWith` (nor `disable`) anywhere.
 * What is NOT claimed: reaching the raw AsyncLocalStorage through `globalThis` and calling
 * `enterWith()`/`disable()` on it remains PHYSICALLY POSSIBLE. It is forbidden by rule, not by
 * construction; a CI fence could make that mechanical later. `principal.test.ts` does exactly
 * this reach-through on purpose, to pin instance identity — that is the one sanctioned use.
 */
const PRINCIPAL_STORE_SYMBOL: symbol = Symbol.for("fikirtive.principal.als");

const globalStore = globalThis as unknown as Record<
  symbol,
  AsyncLocalStorage<Principal> | undefined
>;
const store: AsyncLocalStorage<Principal> =
  globalStore[PRINCIPAL_STORE_SYMBOL] ??
  (globalStore[PRINCIPAL_STORE_SYMBOL] = new AsyncLocalStorage<Principal>());

/** The ambient principal, or undefined when the call chain has none. Never throws. */
export function getPrincipal(): Principal | undefined {
  return store.getStore();
}

/**
 * Run `fn` under a named system identity with no tenant scope (`ownerId: null`).
 *
 * This is the identity for work that has no request and no user BY CONSTRUCTION: login
 * bootstrap (the cookie does not exist yet), signed webhooks, cron reapers, cross-tenant
 * scans. It is a name, not a permission — nothing in #463 grants or checks anything.
 *
 * The frame is frozen: `getPrincipal()` hands out the live object, and a reader that mutated it
 * would retroactively rewrite what every enclosing frame sees.
 */
export function runAsSystem<T>(reason: SystemReason, fn: () => T): T {
  return store.run(Object.freeze({ kind: "system" as const, reason, ownerId: null }), fn);
}

/**
 * Run `fn` under a resolved user identity.
 *
 * This WRAPS THE CONTINUATION — `store.run(principal, fn)` — and nothing else. There is no
 * `enterWith` in this module and there must never be one (a statement about this module's own
 * code — see the store docblock above for what is, and is not, claimed about the raw store).
 * `enterWith` binds onto the CURRENT
 * async resource, and by the time a principal can exist the request has already awaited
 * (session + Prisma), so that resource is shared with the caller: the FIRST identity sticks to
 * the process and every later request reads it instead of its own. Probe `als-probe3.mjs`
 * reproduces exactly that on Node 22 — three sequential requests A, B, C all read A, and A even
 * escapes to the top-level context. The LOAD-BEARING oracle for that property is the gateway
 * sequential case in `apps/web/lib/__tests__/principal-context.test.ts` (measured: it FAILS under
 * `enterWith`); the `packages/db` sequential case pins `store.run` frame semantics only — see the
 * note above it.
 *
 * The practical consequence: only a call site that can WRAP the work it is about to do may
 * establish a user principal. That is why the seam is never `requireOwner()`, which returns a
 * value and wraps nothing: #463 used the four CRM gateways' runRead/runMutation (design contract
 * §2-v2), and #464-B1 has each already-guarded export wrap its OWN continuation in `runAsUser`,
 * with `auth-guard.ts` `resolveUserPrincipal` supplying the frame as a plain value.
 *
 * A frozen DEFENSIVE COPY is stored, never the caller's own object: the caller keeps a mutable
 * reference to what it built, and a later mutation through it must not rewrite the live frame.
 */
export function runAsUser<T>(principal: UserPrincipal, fn: () => T): T {
  return store.run(Object.freeze({ ...principal }), fn);
}

/**
 * Run `fn` scoped to one tenant.
 *
 * Nested inside a system frame (the reaper shape: cross-tenant scan → per-row write) it
 * KEEPS the enclosing `reason` and adds the row's tenant. With no ambient frame it is still
 * usable and names itself `"tenant-direct"`.
 *
 * Nested inside a `kind: "user"` frame for the SAME tenant, the user frame PASSES THROUGH
 * unchanged: re-stating the tenant a request already belongs to must not cost the actor.
 *
 * Nested inside a user frame for a DIFFERENT tenant it degrades to a `"tenant-direct"` system
 * frame, which LOSES the attribution — the frame then names the tenant but no longer names who
 * acted. That is the deliberate trade (carrying a user identity under someone else's tenant
 * would be worse than carrying none), and it never throws: #463 enforces nothing, it only
 * carries. Wiring this into a decision is #464's job.
 *
 * CALLERS: pass an `async` callback and `await` INSIDE it. A bare `prisma.x.op(…)` returns a lazy
 * PrismaPromise — this function would return it and pop the frame before an outer `await`
 * dispatched the query, so the query would run in the ENCLOSING frame. (`$transaction(cb)` and
 * calls to `async function`s are eager and safe either way.)
 *
 * Frames are frozen. The same-tenant pass-through re-runs with the ALREADY-FROZEN user frame, so
 * a nested reader cannot rewrite the caller's identity through the shared reference.
 */
export function runAsTenant<T>(ownerId: string, fn: () => T): T {
  const current = store.getStore();
  if (current?.kind === "user" && current.ownerId === ownerId) return store.run(current, fn);
  const reason: SystemReason = current?.kind === "system" ? current.reason : "tenant-direct";
  return store.run(Object.freeze({ kind: "system" as const, reason, ownerId }), fn);
}
