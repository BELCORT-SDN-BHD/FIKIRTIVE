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
 * Who is acting.
 *
 * `actor` and `subject` are deliberately separate: under admin impersonation the SUBJECT is
 * the merchant (session user, merchant org) while the ACTOR is the founder staff member,
 * recorded only as `impersonatedByBaUserId`.
 *
 * The two role axes are NEVER merged (packages/core/src/org-roles.ts:1-2 forbids it):
 * `orgRole` is the per-org membership axis (owner|admin|member). The platform-staff axis
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
      /** `User.id`. Null on the founder-admin early-return path, which never resolves one. */
      subjectUserId: string | null;
      subjectEmail: string;
      /** The org being acted upon (the subject org). */
      ownerId: string;
      /** `Membership.role` in `ownerId`. Null on the founder-admin path. */
      orgRole: "owner" | "admin" | "member" | null;
      /**
       * `Membership.id` of the acting member in `ownerId` — the same id the CRM gateways
       * already hand their services, carried here so a reader needs no second query. Null
       * wherever no membership was resolved (e.g. the founder-admin path).
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
      /**
       * Named, closed vocabulary (design contract §4) — do not invent a third naming scheme
       * beside the schema's existing `actorKind` values:
       *   auth:converge-identity, auth:bootstrap-personal-org, stripe-webhook,
       *   meta-data-deletion, worker-heartbeat, worker-reaper-tick, gen-reaper,
       *   refgen-reaper, llm-reservation-reaper, research-reaper, publish-reaper,
       *   ingest-redispatch, publish-scheduler, test-seed, tenant-direct
       */
      reason: string;
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
 */
export const PRINCIPAL_STORE_SYMBOL: symbol = Symbol.for("fikirtive.principal.als");

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
 */
export function runAsSystem<T>(reason: string, fn: () => T): T {
  return store.run({ kind: "system", reason, ownerId: null }, fn);
}

/**
 * Run `fn` under a resolved user identity.
 *
 * This WRAPS THE CONTINUATION — `store.run(principal, fn)` — and nothing else. There is no
 * `enterWith` in this module and there must never be one. `enterWith` binds onto the CURRENT
 * async resource, and by the time a principal can exist the request has already awaited
 * (session + Prisma), so that resource is shared with the caller: the FIRST identity sticks to
 * the process and every later request reads it instead of its own. Probe `als-probe3.mjs`
 * reproduces exactly that on Node 22 — three sequential requests A, B, C all read A, and A even
 * escapes to the top-level context. `principal.test.ts` pins the `run()` shape against it.
 *
 * The practical consequence: only a call site that can WRAP the work it is about to do may
 * establish a user principal. That is why the seam is the four CRM gateways' runRead/runMutation
 * (design contract §2-v2) and not `requireOwner()`, which returns a value and wraps nothing.
 */
export function runAsUser<T>(principal: UserPrincipal, fn: () => T): T {
  return store.run(principal, fn);
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
 */
export function runAsTenant<T>(ownerId: string, fn: () => T): T {
  const current = store.getStore();
  if (current?.kind === "user" && current.ownerId === ownerId) return store.run(current, fn);
  const reason = current?.kind === "system" ? current.reason : "tenant-direct";
  return store.run({ kind: "system", reason, ownerId }, fn);
}
