/**
 * #463 — the request-level principal pipeline, exercised end to end on both lanes.
 *
 * Dialect A harness (same as require-owner.test.ts / isolation.test.ts): only the session and
 * the allowlist are mocked, `requireOwner` and Prisma are REAL and hit the local *_test
 * Postgres. No principal is fabricated.
 *
 * What this pins:
 *  1. The bootstrap transaction — the one path that writes to the database with no session by
 *     construction — runs under the named system identity "auth:bootstrap-personal-org"
 *     instead of a nameless third state.
 *  2. The beta grant it writes is now ATTRIBUTED (CreditLedger.createdBy), where it used to be
 *     an empty string.
 *  3. `runAsSystem("test-seed", …)` is usable for test seeding/teardown, so a later enforcement
 *     ticket (#464) does not have to retrofit 17 real-DB files at once.
 *  4. THE USER LANE (design contract §2-v2): a real CRM gateway's runRead/runMutation puts the
 *     full resolved merchant identity — ownerId, orgRole, membershipId — into the ambient store
 *     for the duration of the service call, and two sequential requests get SEPARATE frames.
 *
 * How the user lane is observed: the inbox service module is partially mocked so that two of
 * its methods record `getPrincipal()` and then delegate to the real implementation. The probe is
 * reached through the gateway's ordinary path (`listConversations` / `saveConversationDraft`);
 * production code carries no test hook of any kind.
 *
 * The seam is the four gateways, not `requireOwner()`: an identity can only exist after the
 * session and membership lookups have been awaited, and by then `enterWith` binds onto an async
 * resource shared with the caller — the first merchant's identity would stick to the process and
 * every later request would read it (probe `als-probe3.mjs`; pinned in packages/db's
 * principal.test.ts). Only a call site that WRAPS the work it is about to do can establish a
 * per-request frame, and `requireOwner` returns a value rather than wrapping anything.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Principal } from "@fikirtive/db/principal";

/** Ambient principals captured from INSIDE the service call, in gateway-call order. */
const gatewayProbe = vi.hoisted(() => ({ seen: [] as Array<Principal | undefined> }));

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  // the gateways read this when they build the principal; the bootstrap cases never touch it
  isImpersonating: vi.fn(async () => false),
}));

/**
 * Partial mock: the real service, with two methods that record the ambient principal and then
 * run the real implementation. Everything else (including CustomerInboxError, which the gateway
 * catches by identity) passes through untouched.
 */
vi.mock("@/lib/customer-inbox-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/customer-inbox-service")>();
  const { getPrincipal } = await import("@fikirtive/db/principal");
  return {
    ...actual,
    customerInboxService: {
      ...actual.customerInboxService,
      listConversations: (principal, input) => {
        gatewayProbe.seen.push(getPrincipal());
        return actual.customerInboxService.listConversations(principal, input);
      },
      saveConversationDraft: (principal, input) => {
        gatewayProbe.seen.push(getPrincipal());
        return actual.customerInboxService.saveConversationDraft(principal, input);
      },
    } satisfies typeof actual.customerInboxService,
  };
});
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});

const FOUNDER_EMAIL = "principal-founder@fikirtive.test";
const MERCHANT_EMAIL = "principal-merchant@fikirtive.test";
/** A second merchant, so the two-sequential-requests case compares two DIFFERENT identities. */
const MERCHANT_B_EMAIL = "principal-merchant-b@fikirtive.test";
const ALL_EMAILS = [FOUNDER_EMAIL, MERCHANT_EMAIL, MERCHANT_B_EMAIL];

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = ALL_EMAILS.join(",");
  process.env.FOUNDER_ADMIN_EMAILS = FOUNDER_EMAIL;
});

afterEach(() => { mockAuth.mockReset(); gatewayProbe.seen.length = 0; });

// import AFTER the mocks + env are in place
const { requireOwner, bootstrapPersonalOrg } = await import("@/lib/auth-guard");
const inboxGateway = await import("@/lib/customer-inbox-gateway");
const { prisma } = await import("@fikirtive/db");
const { getPrincipal, runAsSystem } = await import("@fikirtive/db/principal");

/** Every user id this file created, so afterAll can delete exactly its own rows. */
const seededUserIds = new Set<string>();

/** Seeding runs under a named system identity — the demonstration of §4's vocabulary. */
async function seedUser(email: string): Promise<string> {
  return runAsSystem("test-seed", async () => {
    const id = `usr_${randomUUID()}`;
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { id, email } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    seededUserIds.add(user.id);
    return user.id;
  });
}

describe("test-seed system context", () => {
  it("names the seeding identity and leaves nothing behind", async () => {
    expect(getPrincipal()).toBeUndefined();
    const seen = await runAsSystem("test-seed", async () => {
      await prisma.user.count();
      return getPrincipal();
    });
    expect(seen).toEqual({ kind: "system", reason: "test-seed", ownerId: null });
    expect(getPrincipal()).toBeUndefined();
  });
});

describe("bootstrapPersonalOrg runs under a named system identity", () => {
  it("opens its own frame and restores the caller's — with or without an enclosing identity", async () => {
    // (a) no ambient identity (the Better Auth hook case): nothing is left behind.
    const userId = await seedUser(MERCHANT_EMAIL);
    expect(getPrincipal()).toBeUndefined();
    expect(await bootstrapPersonalOrg(userId, MERCHANT_EMAIL)).toBe(`org_${userId}`);
    expect(getPrincipal()).toBeUndefined();

    // (b) nested inside another named identity: the caller's frame is intact afterwards, so the
    // bootstrap's own reason cannot leak outward (its inward effect is pinned by the ledger
    // attribution below — that string is written from inside the transaction).
    const after = await runAsSystem("test-seed", async () => {
      await bootstrapPersonalOrg(userId, MERCHANT_EMAIL);
      return getPrincipal();
    });
    expect(after).toEqual({ kind: "system", reason: "test-seed", ownerId: null });
    expect(getPrincipal()).toBeUndefined();
  });

  it("attributes the beta grant in the ledger (createdBy was an empty string before #463)", async () => {
    const userId = await seedUser(MERCHANT_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: MERCHANT_EMAIL } });

    const gate = await requireOwner();
    if ("error" in gate) throw new Error(gate.error);

    const grant = await prisma.creditLedger.findFirst({
      where: { orgId: gate.ownerId, idempotencyKey: `signup:${gate.ownerId}` },
      select: { createdBy: true, kind: true, source: true },
    });
    expect(grant).not.toBeNull();
    expect(grant?.createdBy).toBe("auth:bootstrap-personal-org");
    // the money semantics themselves are unchanged
    expect(grant?.kind).toBe("GRANT");
    expect(grant?.source).toBe("BETA");
  });

  it("stays idempotent — a second resolution neither re-grants nor re-attributes", async () => {
    const userId = await seedUser(MERCHANT_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: MERCHANT_EMAIL } });

    const first = await requireOwner();
    if ("error" in first) throw new Error(first.error);
    const second = await requireOwner();
    if ("error" in second) throw new Error(second.error);
    expect(second.ownerId).toBe(first.ownerId);
    expect(first.ownerId).toBe(`org_${userId}`);

    const grants = await prisma.creditLedger.count({
      where: { orgId: first.ownerId, idempotencyKey: `signup:${first.ownerId}` },
    });
    expect(grants).toBe(1);
  });

  it("the founder path never bootstraps, so it writes no attributed grant", async () => {
    await seedUser(FOUNDER_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: FOUNDER_EMAIL } });
    const gate = await requireOwner();
    expect(gate).toEqual({ email: FOUNDER_EMAIL, ownerId: "founder" });
  });
});

describe("the gateway lane — the ambient USER principal (design contract §2-v2)", () => {
  /** The membership the gateway resolved for `userId`, read back independently. */
  async function membershipOf(userId: string) {
    return prisma.membership.findFirstOrThrow({
      where: { userId, orgId: `org_${userId}` },
      select: { id: true, role: true },
    });
  }

  it("a READ carries the whole resolved identity into the service call", async () => {
    const userId = await seedUser(MERCHANT_EMAIL);
    mockAuth.mockResolvedValue({ user: { email: MERCHANT_EMAIL } });

    expect(getPrincipal()).toBeUndefined();
    const result = await inboxGateway.listConversations();
    expect(result).toMatchObject({ ok: true }); // behaviour unchanged: still the same envelope

    const membership = await membershipOf(userId);
    expect(gatewayProbe.seen).toHaveLength(1);
    expect(gatewayProbe.seen[0]).toEqual({
      kind: "user",
      subjectUserId: userId,
      subjectEmail: MERCHANT_EMAIL,
      ownerId: `org_${userId}`,
      orgRole: membership.role,
      membershipId: membership.id,
      impersonating: false,
      impersonatedByBaUserId: null, // #463 never carries the impersonator id (②-D)
    });
    // the frame is scoped to the service call; the gateway's caller is left as it was
    expect(getPrincipal()).toBeUndefined();
  });

  it("a MUTATION carries it too, and two SEQUENTIAL requests get isolated frames", async () => {
    const aUserId = await seedUser(MERCHANT_EMAIL);
    const bUserId = await seedUser(MERCHANT_B_EMAIL);
    const draft = () => ({
      conversationId: `principal-probe-${randomUUID()}`,
      conversationBaseRevision: 1,
      draftBaseRevision: null,
      text: "principal probe",
    });

    // request 1 — merchant A. The conversation does not exist, so the gateway returns a refusal;
    // the probe already recorded the frame the service was entered with, which is the subject here.
    expect(getPrincipal()).toBeUndefined();
    mockAuth.mockResolvedValue({ user: { email: MERCHANT_EMAIL } });
    expect(await inboxGateway.saveConversationDraft(draft())).toMatchObject({ ok: false });

    // request 2 — merchant B, on the same process, after request 1 fully settled. The check
    // between the two requests is the load-bearing one: merchant A's identity must not still be
    // ambient when merchant B's request begins. THIS case is the project's oracle for that
    // property — measured: it fails under `enterWith`. (The packages/db sequential case does NOT
    // discriminate run from enterWith; its per-request AsyncResource wrapper contains the leak.)
    expect(getPrincipal()).toBeUndefined();
    mockAuth.mockResolvedValue({ user: { email: MERCHANT_B_EMAIL } });
    expect(await inboxGateway.saveConversationDraft(draft())).toMatchObject({ ok: false });

    const [a, b] = [await membershipOf(aUserId), await membershipOf(bUserId)];
    expect(gatewayProbe.seen).toHaveLength(2);
    expect(gatewayProbe.seen[0]).toMatchObject({
      kind: "user",
      subjectUserId: aUserId,
      subjectEmail: MERCHANT_EMAIL,
      ownerId: `org_${aUserId}`,
      membershipId: a.id,
      orgRole: a.role,
    });
    // THE regression: under the discarded enterWith design request 2 read request 1's identity.
    expect(gatewayProbe.seen[1]).toMatchObject({
      kind: "user",
      subjectUserId: bUserId,
      subjectEmail: MERCHANT_B_EMAIL,
      ownerId: `org_${bUserId}`,
      membershipId: b.id,
      orgRole: b.role,
    });
    expect(gatewayProbe.seen[1]?.ownerId).not.toBe(gatewayProbe.seen[0]?.ownerId);
    expect(getPrincipal()).toBeUndefined();
  });

  it("an unauthenticated call establishes no frame and still refuses identically", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await inboxGateway.listConversations()).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    expect(gatewayProbe.seen).toHaveLength(0); // the service was never reached, so no frame
    expect(getPrincipal()).toBeUndefined();
  });
});

afterAll(async () => {
  // Delete exactly the rows this file created, child → parent, best-effort (a cleanup failure
  // must never turn a green suite red). Without this the identities pile up in the shared
  // fikirtive_test database on every run.
  const orgIds = [...seededUserIds].map((id) => `org_${id}`);
  const purge = async (step: (orgId: string) => Promise<unknown>) => {
    for (const orgId of orgIds) {
      try { await step(orgId); } catch { /* best-effort cleanup — never fail the suite here */ }
    }
  };
  await purge((orgId) => prisma.creditLedger.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.creditAccount.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.membership.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.organization.deleteMany({ where: { id: orgId } }));
  // User cascades to Account/Session/Membership (schema.prisma:564, 573, 688)
  try {
    await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
  } catch { /* best-effort cleanup */ }
});
