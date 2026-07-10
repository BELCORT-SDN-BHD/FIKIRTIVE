/**
 * publish.test.ts — the publish worker's six-state + triple-idempotency response + fail-closed
 * scheduler + no-blind-repost reconcile. prisma is MOCKED (the partial-unique index ITSELF is
 * covered by packages/db/src/publish-attempt-uniqueness.test.ts against a real DB); here we assert
 * how the HANDLER reacts. The Meta/media executor is injected, so no network runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const scheduledPostFindMany = vi.fn();
  const publishAttemptCreate = vi.fn();
  const publishAttemptUpdate = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  const publishAttemptFindMany = vi.fn();
  const metaConnectionFindMany = vi.fn();
  const metaConnectionFindUnique = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany, findMany: scheduledPostFindMany },
    publishAttempt: { create: publishAttemptCreate, update: publishAttemptUpdate, updateMany: publishAttemptUpdateMany, findMany: publishAttemptFindMany },
    metaConnection: { findMany: metaConnectionFindMany, findUnique: metaConnectionFindUnique },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
  };
  return {
    prisma, scheduledPostFindUnique, scheduledPostUpdateMany, scheduledPostFindMany,
    publishAttemptCreate, publishAttemptUpdate, publishAttemptUpdateMany, publishAttemptFindMany,
    metaConnectionFindMany, metaConnectionFindUnique,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));

import { handlePublish, scanDuePublishPosts, reapStalePublishAttempts } from "./publish.js";

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
});
