/**
 * publish.test.ts — the publish worker's six-state + triple-idempotency response + fail-closed
 * scheduler + no-blind-repost reconcile. prisma is MOCKED (the partial-unique index ITSELF is
 * covered by packages/db/src/publish-attempt-uniqueness.test.ts against a real DB); here we assert
 * how the HANDLER reacts. The Meta/media executor is injected, so no network runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => {
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const scheduledPostFindMany = vi.fn();
  const publishAttemptCreate = vi.fn();
  const publishAttemptUpdate = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  const publishAttemptFindMany = vi.fn();
  const publishAttemptFindUnique = vi.fn();
  const metaConnectionFindMany = vi.fn();
  const metaConnectionFindUnique = vi.fn();
  const scheduledPostMediaFindMany = vi.fn();
  const generationFindMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany, findMany: scheduledPostFindMany },
    publishAttempt: { create: publishAttemptCreate, update: publishAttemptUpdate, updateMany: publishAttemptUpdateMany, findMany: publishAttemptFindMany, findUnique: publishAttemptFindUnique },
    metaConnection: { findMany: metaConnectionFindMany, findUnique: metaConnectionFindUnique },
    scheduledPostMedia: { findMany: scheduledPostMediaFindMany },
    generation: { findMany: generationFindMany },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
  };
  return {
    prisma, scheduledPostFindUnique, scheduledPostUpdateMany, scheduledPostFindMany,
    publishAttemptCreate, publishAttemptUpdate, publishAttemptUpdateMany, publishAttemptFindMany, publishAttemptFindUnique,
    metaConnectionFindMany, metaConnectionFindUnique, scheduledPostMediaFindMany, generationFindMany,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
// Token crypto is stubbed so the M1/M2 paths that call authorize() don't need a real ciphertext
// (decryptToken never throws here). No test exercises real crypto — they inject the executor or
// stop at the authorization gate.
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));

import { handlePublish, scanDuePublishPosts, reapStalePublishAttempts, reconcileAttempt } from "./publish.js";

const SCHEDULED = {
  id: "sp1", ownerId: "o1", channel: "instagram", metaTargetId: "pg1", caption: "hi", firstComment: null,
  status: "SCHEDULED", metaPostId: null, deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });
  m.publishAttemptCreate.mockResolvedValue({ id: "pa1" });
  m.publishAttemptUpdate.mockResolvedValue({});
  m.publishAttemptUpdateMany.mockResolvedValue({ count: 1 });
  m.publishAttemptFindUnique.mockResolvedValue({ id: "pa1", scheduledPostId: "sp1", creationId: null });
});

describe("handlePublish — triple idempotency", () => {
  it("lock 1: a post that already has metaPostId short-circuits (never re-publishes)", async () => {
    m.scheduledPostFindUnique.mockResolvedValue({ ...SCHEDULED, metaPostId: "already", status: "PUBLISHING" });
    const exec = vi.fn();
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
  });

  it("lock 2: a P2002 on the APPLYING claim skips (another worker owns it) — no publish", async () => {
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    m.publishAttemptCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const exec = vi.fn();
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    expect(exec).not.toHaveBeenCalled();
  });

  it("does nothing for a non-publishable status (e.g. DRAFT)", async () => {
    m.scheduledPostFindUnique.mockResolvedValue({ ...SCHEDULED, status: "DRAFT" });
    const exec = vi.fn();
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
  });
});

describe("handlePublish — H4: the status CAS is the SOLE gate on reaching Meta", () => {
  it("post cancelled/edited AFTER the claim (fresh row moved) → CAS affects 0 rows → NO Meta call", async () => {
    // The snapshot still looks SCHEDULED (it is STALE); the atomic CAS against the fresh row misses.
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    m.scheduledPostUpdateMany.mockResolvedValue({ count: 0 }); // SCHEDULED→PUBLISHING claim finds nothing
    const exec = vi.fn();
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    // the executor (the only path to Meta) is NEVER invoked → no ghost post
    expect(exec).not.toHaveBeenCalled();
    // and the APPLYING claim is released so it can't leak the partial-unique lock
    expect(m.publishAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "FAILED" }) }),
    );
  });

  it("the claim CAS is keyed on a fresh, still-publishable row (metaPostId null, not deleted)", async () => {
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    const exec = vi.fn().mockResolvedValue({ externalId: "ext_1" });
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    // the FIRST scheduledPost.updateMany is the claim; it re-checks the live row atomically
    const claim = m.scheduledPostUpdateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ id: "sp1", metaPostId: null, deletedAt: null });
    expect(claim.where.status).toEqual({ in: ["SCHEDULED", "PUBLISHING"] });
    expect(claim.data).toMatchObject({ status: "PUBLISHING" });
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("handlePublish — H5: an ambiguous publish is reconciled, never blind-retried", () => {
  beforeEach(() => m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED));

  it("ambiguous result → reconcile; unconfirmed → NEEDS_ATTENTION, NO throw (pg-boss won't redeliver = no re-send)", async () => {
    const exec = vi.fn().mockResolvedValue({ ambiguous: true, error: "media_publish timed out" });
    const reconcile = vi.fn().mockResolvedValue("needs_attention");
    // resolves (does NOT throw) — a throw would make pg-boss redeliver and re-send the publish
    await expect(handlePublish({ scheduledPostId: "sp1" }, 0, exec, reconcile)).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(1); // the executor ran exactly once, never re-invoked
    expect(reconcile).toHaveBeenCalledTimes(1); // truth was queried before any decision
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeTruthy();
    // never marked PUBLISHED (we couldn't confirm) and never re-executed
    const published = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED");
    expect(published).toBeFalsy();
  });

  it("ambiguous but reconcile CONFIRMS live → PUBLISHED verdict, no NEEDS_ATTENTION, no re-send", async () => {
    const exec = vi.fn().mockResolvedValue({ ambiguous: true, error: "5xx after publish" });
    const reconcile = vi.fn().mockResolvedValue("published");
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec, reconcile);
    expect(exec).toHaveBeenCalledTimes(1);
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeFalsy();
  });
});

describe("handlePublish — M1: deterministic authorization refusals are NEEDS_ATTENTION with ZERO Meta calls", () => {
  it("canPublish=false → NEEDS_ATTENTION (not FAILED) and global fetch is never called", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    // the primary fail-closed gate — authorize() refuses BEFORE any port/network exists
    m.metaConnectionFindUnique.mockResolvedValue({
      accessTokenEnc: "enc", canPublish: false, organicPublishPaused: false, status: "active", tokenExpiresAt: null,
    });
    // DEFAULT executor (realExecute) — we are testing the real authorization path, not a stub
    await handlePublish({ scheduledPostId: "sp1" }, 0);
    expect(fetchSpy).not.toHaveBeenCalled(); // proof: zero Meta calls
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeTruthy();
    const failed = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "FAILED");
    expect(failed).toBeFalsy(); // six-state ② NEEDS_ATTENTION, never ③ FAILED
    vi.unstubAllGlobals();
  });

  it("no target account → NEEDS_ATTENTION with ZERO Meta calls (never even reads the connection)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    m.scheduledPostFindUnique.mockResolvedValue({ ...SCHEDULED, metaTargetId: null });
    await handlePublish({ scheduledPostId: "sp1" }, 0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("handlePublish — P1a/P1b: IG media-contract refusal short-circuits BEFORE any Meta call", () => {
  const MEDIA_ENV = { ...process.env };
  beforeEach(() => {
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    // authorize() would succeed if reached — proves the refusal, not the auth gate, is what stops us.
    m.metaConnectionFindUnique.mockResolvedValue({
      accessTokenEnc: "enc", canPublish: true, organicPublishPaused: false, status: "active", tokenExpiresAt: null,
    });
    m.scheduledPostMediaFindMany.mockResolvedValue([{ generationId: "gen1" }]);
    m.generationFindMany.mockResolvedValue([
      { id: "gen1", asset: { ownerId: "o1", contentHash: "a".repeat(64), ext: "mp4", mime: "video/mp4" } },
    ]);
    process.env.PUBLIC_BASE_URL = "https://app.example.com";
    process.env.MEDIA_PROXY_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env = { ...MEDIA_ENV };
  });

  it("executor order (P1a): resolvePage/me-accounts is never reached — buildMediaUrls runs first and refuses", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // DEFAULT executor (realExecute) — exercises the real ordering, not an injected stub.
    await handlePublish({ scheduledPostId: "sp1" }, 0);
    expect(fetchSpy).not.toHaveBeenCalled(); // resolvePage's only path to Meta is graphGet→fetch
    vi.unstubAllGlobals();
  });

  it("NEEDS_ATTENTION routing (P1b consumer): lands NEEDS_ATTENTION with the guard text, never FAILED", async () => {
    await handlePublish({ scheduledPostId: "sp1" }, 0);
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeTruthy();
    expect(na?.[0].data.lastError).toMatch(/isn't a publishable image for Instagram/);
    const failed = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "FAILED");
    expect(failed).toBeFalsy(); // six-state ② NEEDS_ATTENTION, never ③ FAILED
    expect(m.publishAttemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "FAILED" }) }),
    );
  });
});

describe("handlePublish — six states", () => {
  beforeEach(() => m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED));

  it("① success → PUBLISHED + metaPostId + APPLIED attempt", async () => {
    const exec = vi.fn().mockResolvedValue({ externalId: "ext_1" });
    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);
    const postUpdate = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED");
    expect(postUpdate?.[0].data).toMatchObject({ status: "PUBLISHED", metaPostId: "ext_1" });
    expect(m.publishAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "APPLIED", metaPostId: "ext_1" }) }));
  });

  it("③ hard reject (retryable=false) → FAILED, no throw", async () => {
    const exec = vi.fn().mockResolvedValue({ error: "caption too long", retryable: false });
    await expect(handlePublish({ scheduledPostId: "sp1" }, 0, exec)).resolves.toBeUndefined();
    const postUpdate = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "FAILED");
    expect(postUpdate).toBeTruthy();
    expect(m.publishAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "FAILED" }) }));
  });

  it("④ transient over the retry budget → NEEDS_ATTENTION (never a silent FAILED)", async () => {
    const exec = vi.fn().mockResolvedValue({ error: "meta 5xx", retryable: true });
    await handlePublish({ scheduledPostId: "sp1" }, 99, exec); // retryCount >> limit
    const postUpdate = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(postUpdate).toBeTruthy();
  });

  it("④ transient WITH retries left → throws (pg-boss redelivers) + frees the APPLYING lock, post stays PUBLISHING", async () => {
    const exec = vi.fn().mockResolvedValue({ error: "meta 5xx", retryable: true });
    await expect(handlePublish({ scheduledPostId: "sp1" }, 0, exec)).rejects.toThrow();
    // the attempt is marked FAILED (partial-unique frees for the next claim)
    expect(m.publishAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "FAILED" }) }));
    // the post is NOT moved to FAILED/NEEDS_ATTENTION during retries (no such updateMany)
    const terminal = m.scheduledPostUpdateMany.mock.calls.find((c) => ["FAILED", "NEEDS_ATTENTION", "PUBLISHED"].includes(c[0].data?.status));
    expect(terminal).toBeFalsy();
  });
});

describe("scanDuePublishPosts — fail-closed steady state", () => {
  it("returns [] and does NOT scan posts when no connection can publish (App Review not passed)", async () => {
    m.metaConnectionFindMany.mockResolvedValue([]);
    const due = await scanDuePublishPosts();
    expect(due).toEqual([]);
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });

  it("returns due post ids for owners whose connection can publish", async () => {
    m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o1" }]);
    m.scheduledPostFindMany.mockResolvedValue([{ id: "sp1" }, { id: "sp2" }]);
    expect(await scanDuePublishPosts()).toEqual(["sp1", "sp2"]);
    const where = m.scheduledPostFindMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ status: "SCHEDULED", metaPostId: null });
    expect(where.approvedAt).toEqual({ not: null });
  });
});

describe("reapStalePublishAttempts — reconcile never blind re-posts", () => {
  it("a dangling FB attempt (no creationId) → NEEDS_ATTENTION, never a blind /feed re-post", async () => {
    m.publishAttemptFindMany.mockResolvedValue([{ id: "pa1", scheduledPostId: "sp1", creationId: null }]);
    m.scheduledPostFindUnique.mockResolvedValue({ ownerId: "o1", channel: "facebook", metaTargetId: "pg1", metaPostId: null, status: "PUBLISHING" });
    const n = await reapStalePublishAttempts();
    expect(n).toBe(1);
    // the post is surfaced for a human, NOT republished
    expect(m.scheduledPostUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_ATTENTION" }) }));
    expect(m.publishAttemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "FAILED" }) }));
    // no page-token resolution happened (metaConnection never read) → definitely no Graph re-post
    expect(m.metaConnectionFindUnique).not.toHaveBeenCalled();
  });

  it("leaves an already-resolved (metaPostId set) attempt as published — no re-post", async () => {
    m.publishAttemptFindMany.mockResolvedValue([{ id: "pa1", scheduledPostId: "sp1", creationId: "c1" }]);
    m.scheduledPostFindUnique.mockResolvedValue({ ownerId: "o1", channel: "instagram", metaTargetId: "pg1", metaPostId: "already", status: "PUBLISHED" });
    const n = await reapStalePublishAttempts();
    expect(n).toBe(1);
    // metaPostId already set → reconcile returns "published" immediately, no NEEDS_ATTENTION write
    const na = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na).toBeFalsy();
    expect(m.metaConnectionFindUnique).not.toHaveBeenCalled();
  });

  it("M3: the NEEDS_ATTENTION writes go through a single atomic $transaction (attempt + post together)", async () => {
    m.publishAttemptFindMany.mockResolvedValue([{ id: "pa1", scheduledPostId: "sp1", creationId: null }]);
    m.scheduledPostFindUnique.mockResolvedValue({ ownerId: "o1", channel: "facebook", metaTargetId: "pg1", metaPostId: null, status: "PUBLISHING" });
    await reapStalePublishAttempts();
    // both writes are batched into one transaction — a mid-way crash can't strand one without the other
    const txArg = m.prisma.$transaction.mock.calls.at(-1)?.[0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(txArg).toHaveLength(2);
  });
});

describe("reconcileAttempt — M2/M3", () => {
  it("M2: a confirmed-PUBLISHED IG container is NEVER stamped as metaPostId — fail closed to needs_attention", async () => {
    // resolvePage() hits me/accounts via the real graph client → stub fetch to return the page.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "pg1", access_token: "pt", instagram_business_account: { id: "ig1" } }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    m.metaConnectionFindUnique.mockResolvedValue({
      accessTokenEnc: "enc", canPublish: true, organicPublishPaused: false, status: "active", tokenExpiresAt: null,
    });
    // the container GET (injected) reports the post DID go live
    const containerGet = vi.fn().mockResolvedValue({ status_code: "PUBLISHED" });
    const verdict = await reconcileAttempt(
      { id: "pa1", scheduledPostId: "sp1", creationId: "container_1" },
      { ownerId: "o1", channel: "instagram", metaTargetId: "pg1", metaPostId: null },
      containerGet,
    );
    expect(containerGet).toHaveBeenCalled(); // it DID query Meta's truth
    expect(verdict).toBe("needs_attention"); // …but never auto-resolves without the REAL media id
    // the container id is NEVER written anywhere as the post's metaPostId
    const stampedPost = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.metaPostId === "container_1");
    expect(stampedPost).toBeFalsy();
    const stampedAttempt = m.publishAttemptUpdate.mock.calls.find((c) => c[0].data?.metaPostId === "container_1");
    expect(stampedAttempt).toBeFalsy();
    vi.unstubAllGlobals();
  });

  it("M3: the metaPostId short-circuit CONVERGES the dangling attempt (no APPLYING leak), records the REAL id", async () => {
    const verdict = await reconcileAttempt(
      { id: "pa1", scheduledPostId: "sp1", creationId: "container_1" },
      { ownerId: "o1", channel: "instagram", metaTargetId: "pg1", metaPostId: "real_media_9" },
    );
    expect(verdict).toBe("published");
    // the APPLYING attempt is converged → APPLIED with the real metaPostId (CAS on state=APPLYING)
    expect(m.publishAttemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "pa1", state: "APPLYING" }),
        data: expect.objectContaining({ state: "APPLIED", metaPostId: "real_media_9" }),
      }),
    );
    // and the real id is used — never the container id
    const stampedContainer = m.publishAttemptUpdateMany.mock.calls.find((c) => c[0].data?.metaPostId === "container_1");
    expect(stampedContainer).toBeFalsy();
  });
});
