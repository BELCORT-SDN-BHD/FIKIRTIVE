/**
 * #464 B1 — ACCEPTANCE for the ambient user frame at the eight seamed sites.
 *
 * The seed diff wires `requireOwner()` → `resolveUserPrincipal(gate)` → `runAsUser(principal, …)`
 * into eight already-guarded exports. Without an executable oracle that wiring is only a shape:
 * a later refactor could drop `runAsUser`, resolve the principal AFTER the first sensitive
 * operation, or let a system frame stand in for the user — and every existing test would stay
 * green, because none of them look at `getPrincipal()`.
 *
 * WHAT THIS FILE PINS
 *  (a) At each site's FIRST sensitive operation, `getPrincipal()` returns the USER frame — the
 *      one this request resolved — and never `undefined` and never `kind: "system"`. The
 *      distinction matters: a nameless-or-system frame at a tenant-scoped query is exactly the
 *      state #464-B4 will later refuse, and a `runAsTenant`-shaped stand-in would carry the org
 *      but LOSE the actor (packages/db/src/principal.ts `runAsTenant` docblock).
 *  (b) Frame isolation across two SEQUENTIAL calls: request B never reads request A's identity.
 *      This is the property `enterWith` measurably breaks (probe `als-probe3.mjs`, cited in the
 *      `runAsUser` docblock: three sequential requests all read the first one's identity). It is
 *      pinned here on the ambient-frame lane; `principal-context.test.ts` pins the gateway lane.
 *
 * The Otto SSE site is NOT here — its frame survives for a reason that belongs to the `ai` SDK's
 * own construction order, so it gets a dedicated real-SDK test:
 * `otto-stream-frame-liveness.test.ts`. The Otto stream route's own frame assertion lives in
 * `otto-stream-route.test.ts`, and `setCoworkThreadPinned`'s in `otto-actions.test.ts`, each
 * beside the harness that already knows how to drive that export.
 *
 * DIALECT B harness (fully mocked, no database): every site is reached through its ordinary
 * exported entry point, and the ambient principal is read from inside the mock that stands in
 * for that site's first sensitive dependency. Production code carries no test hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal, UserPrincipal } from "@fikirtive/db/principal";
import { getPrincipal } from "@fikirtive/db/principal";

/** Ambient principals captured from INSIDE each site's first sensitive operation. */
const probe = vi.hoisted(() => ({ seen: [] as Array<Principal | undefined> }));

/** Record the ambient frame, then answer with `value`. */
function record<T>(value: T): T {
  probe.seen.push(getPrincipal());
  return value;
}

const h = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  // site 1 — GET /api/meta/callback
  completeMetaConnect: vi.fn(),
  // site 3 — deleteProject
  projectFindFirst: vi.fn(),
  // site 4 — getAnalytics
  fetchOwnerInsights: vi.fn(),
  fetchOwnerInsightsSeries: vi.fn(),
  // site 5 — getCoworkThreadClient
  getCoworkThreadPage: vi.fn(),
  resolveCoworkResultUrls: vi.fn(),
  // site 7 — getAdPerformance
  fetchOwnerAdPerformance: vi.fn(),
}));

/**
 * A FULLY RESOLVED principal — every membership-derived field non-null. The production stub
 * (`__stubs__/resolve-user-principal.ts`) deliberately models the MEMBERSHIP-MISS shape, which
 * would let a test pass while carrying almost nothing; here the frame has to be recognisable, so
 * a stand-in built from the gate alone cannot satisfy the assertions.
 */
function principalFor(gate: { email: string; ownerId: string }): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_for_${gate.ownerId}`,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: "owner",
    membershipId: `mem_for_${gate.ownerId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

vi.mock("@/lib/auth-guard", () => ({
  requireOwner: h.requireOwner,
  resolveUserPrincipal: async (gate: { email: string; ownerId: string }) => principalFor(gate),
}));

vi.mock("next/server", () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    redirect: (url: URL | string, init?: { status?: number }) =>
      new Response(null, { status: init?.status ?? 307, headers: { location: String(url) } }),
    json: (body: unknown, init?: { status?: number }) =>
      Response.json(body, { status: init?.status ?? 200 }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/meta-actions", () => ({ completeMetaConnect: h.completeMetaConnect }));
vi.mock("@/lib/meta-insights", () => ({
  fetchOwnerInsights: h.fetchOwnerInsights,
  fetchOwnerInsightsSeries: h.fetchOwnerInsightsSeries,
}));
vi.mock("@/lib/meta-performance", () => ({ fetchOwnerAdPerformance: h.fetchOwnerAdPerformance }));
vi.mock("@/lib/data", () => ({
  getCoworkThreadPage: h.getCoworkThreadPage,
  resolveCoworkResultUrls: h.resolveCoworkResultUrls,
}));

// `actions.ts` (site 3) drags in the storage/queue/edit side of the app; deleteProject reaches
// `prisma.project.findFirst` before touching any of it, so they are stubbed to nothing.
vi.mock("@/lib/storage", () => ({}));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn() }));
vi.mock("@/lib/edit", () => ({}));
vi.mock("@/lib/entity-snapshot", () => ({}));
/**
 * #524 r6 — the two READ-ONLY ledger questions ottoApprove asks (judge r5 P1-A'①/②).
 *
 *  - finalizedReservations: which per-attempt refIds the ledger has already finished with, so a
 *    retry reserves under one it will still accept. Default: none — a fresh card.
 *  - otherHoldsSince: whether anything besides this turn's own hold was taken for this org since
 *    it was taken. Default "none" — these fixtures hold nothing else, so a failed approval really
 *    did charge nothing, and the card may say so.
 */
const { mockFinalizedReservations, mockOtherHoldsSince } = vi.hoisted(() => ({
  mockFinalizedReservations: vi.fn(async (_orgId: string, _refIds: readonly string[]) => new Set<string>()),
  mockOtherHoldsSince: vi.fn(async (_orgId: string, _refId: string): Promise<"none" | "some" | "unknown"> => "none"),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: { project: { findFirst: h.projectFindFirst } },
  refundReservation: vi.fn(),
  // #524 r6: ottoApprove asks the LEDGER which attempt is still free, and whether a failed
  // approval may claim "nothing was charged". Read-only; defaults say "fresh" and "unknown".
  finalizedReservations: mockFinalizedReservations,
  otherHoldsSince: mockOtherHoldsSince,
}));

const { GET: metaCallbackGET } = await import("@/app/api/meta/callback/route");
const { deleteProject } = await import("@/lib/actions");
const { getAnalytics } = await import("@/lib/analytics-actions");
const { getCoworkThreadClient } = await import("@/lib/cowork-fetch");
const { getAdPerformance } = await import("@/lib/meta-performance-actions");

const GATE = { email: "merchant@fikirtive.test", ownerId: "org_frame_a" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  probe.seen.length = 0;
  h.requireOwner.mockResolvedValue({ ...GATE });
  // Every first-sensitive-operation stub records the ambient frame, then short-circuits its
  // site with the cheapest legal answer.
  h.completeMetaConnect.mockImplementation(async () => record({ error: "probe" }));
  h.projectFindFirst.mockImplementation(async () => record(null));
  h.fetchOwnerInsights.mockImplementation(async () => record({ notConnected: true }));
  h.fetchOwnerInsightsSeries.mockImplementation(async () => record({ notConnected: true }));
  h.getCoworkThreadPage.mockImplementation(async () => record(null));
  h.fetchOwnerAdPerformance.mockImplementation(async () => record({ ads: [] }));
});

/** The single acceptance predicate: a USER frame naming this request's own org and subject. */
function expectUserFrame(seen: Principal | undefined, ownerId: string, email: string) {
  expect(seen, "no ambient principal at the sensitive operation").toBeDefined();
  // Spelled as an explicit kind check rather than a shape match: a `runAsTenant` stand-in also
  // carries `ownerId`, and it is exactly the frame that has LOST the actor.
  expect(seen!.kind).toBe("user");
  expect(seen).toMatchObject({
    kind: "user",
    ownerId,
    subjectEmail: email,
    subjectUserId: `usr_for_${ownerId}`,
    orgRole: "owner",
    membershipId: `mem_for_${ownerId}`,
  });
}

describe("#464 B1 — the ambient user frame is live at each seamed site", () => {
  it("GET /api/meta/callback frames completeMetaConnect", async () => {
    process.env.BETTER_AUTH_SECRET = "principal-frame-b1-secret";
    process.env.BETTER_AUTH_URL = "https://app.test";
    const { signState } = await import("@/lib/meta-oauth");
    const state = signState(GATE.ownerId);

    await metaCallbackGET({
      url: `https://app.test/api/meta/callback?code=c&state=${encodeURIComponent(state)}`,
    } as never);

    expect(h.completeMetaConnect).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE.ownerId, GATE.email);
  });

  it("deleteProject frames its owner-scoped project lookup", async () => {
    const result = await deleteProject("proj_1");

    expect(result).toEqual({ error: "Project not found." });
    expect(h.projectFindFirst).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE.ownerId, GATE.email);
  });

  it("getAnalytics frames both Meta insight reads", async () => {
    const result = await getAnalytics({ range: "30d" });

    expect(result).toEqual({ state: "notConnected" });
    expect(probe.seen).toHaveLength(2);
    for (const seen of probe.seen) expectUserFrame(seen, GATE.ownerId, GATE.email);
  });

  it("getCoworkThreadClient frames its thread read", async () => {
    const result = await getCoworkThreadClient("thread_1");

    expect(result).toBeNull();
    expect(h.getCoworkThreadPage).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE.ownerId, GATE.email);
  });

  it("getAdPerformance frames the ad-performance fetch", async () => {
    await getAdPerformance("last_30d");

    expect(h.fetchOwnerAdPerformance).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE.ownerId, GATE.email);
  });

  it("leaves NO ambient frame behind after the call returns", async () => {
    await getCoworkThreadClient("thread_1");

    // `store.run` pops with the callback. If a future edit reached for `enterWith` instead, the
    // identity would stick to this async resource and this assertion is the first thing to fail.
    expect(getPrincipal()).toBeUndefined();
  });

  it("never opens a frame when the gate denies (the guard still short-circuits outside)", async () => {
    h.requireOwner.mockResolvedValue({ error: "Sign in required." });

    const result = await getAdPerformance("last_30d");

    expect(result).toEqual({ error: "Sign in required." });
    expect(h.fetchOwnerAdPerformance).not.toHaveBeenCalled();
    expect(probe.seen).toHaveLength(0);
  });
});

describe("#464 B1 — sequential requests get SEPARATE frames", () => {
  it("does not leak request A's identity into request B", async () => {
    const A = { email: "a@fikirtive.test", ownerId: "org_seq_a" };
    const B = { email: "b@fikirtive.test", ownerId: "org_seq_b" };

    h.requireOwner.mockResolvedValue({ ...A });
    await getCoworkThreadClient("thread_a");

    h.requireOwner.mockResolvedValue({ ...B });
    await getCoworkThreadClient("thread_b");

    expect(probe.seen).toHaveLength(2);
    expectUserFrame(probe.seen[0], A.ownerId, A.email);
    expectUserFrame(probe.seen[1], B.ownerId, B.email);
    // Stated separately from the two frame checks above: under `enterWith` BOTH reads return A,
    // so the pair-inequality is the assertion that actually names the leak.
    expect(probe.seen[0]).not.toEqual(probe.seen[1]);
  });

  it("keeps two OVERLAPPING in-flight requests on their own frames", async () => {
    const A = { email: "a@fikirtive.test", ownerId: "org_par_a" };
    const B = { email: "b@fikirtive.test", ownerId: "org_par_b" };
    // Hold A's sensitive operation open until B's has already run, so the two frames are
    // provably alive at the same time rather than merely one-after-another.
    let releaseA: () => void = () => {};
    const aReached = new Promise<void>((resolve) => {
      h.getCoworkThreadPage.mockImplementationOnce(async () => {
        const seen = record(null);
        resolve();
        await new Promise<void>((r) => (releaseA = r));
        return seen;
      });
    });

    h.requireOwner.mockResolvedValue({ ...A });
    const callA = getCoworkThreadClient("thread_a");
    await aReached;

    h.requireOwner.mockResolvedValue({ ...B });
    await getCoworkThreadClient("thread_b");
    releaseA();
    await callA;

    expect(probe.seen).toHaveLength(2);
    expectUserFrame(probe.seen[0], A.ownerId, A.email);
    expectUserFrame(probe.seen[1], B.ownerId, B.email);
  });
});
