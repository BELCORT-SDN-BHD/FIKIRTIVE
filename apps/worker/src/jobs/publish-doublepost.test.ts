/**
 * publish-doublepost.test.ts — D2 regression: the recovery-path DOUBLE-POST window.
 *
 * The chain (工单 D, code-confirmed): an ambiguous IG publish crosses Meta's side-effect point but
 * its receipt is lost (timeout/5xx/crash). reconcile finds the container PUBLISHED yet — per the M2
 * decision — refuses to stamp the container id as metaPostId, so the post lands NEEDS_ATTENTION with
 * metaPostId=null. The owner retries (NEEDS_ATTENTION→SCHEDULED is a LEGAL transition), scanDue
 * re-selects the post (metaPostId is still null), and the worker builds a SECOND container → a real
 * double-post. None of the three idempotency locks stop it: metaPostId was never written (lock 1),
 * the prior attempt is no longer APPLYING so the partial-unique frees (lock 2), and the creationId
 * sits on that freed attempt so a fresh attempt rebuilds from scratch (lock 3).
 *
 * The fix: the two ambiguity sinks record the attempt as UNCONFIRMED (not FAILED); a post with ANY
 * UNCONFIRMED attempt is refused deterministically (worker guard + approve gate) → NEEDS_ATTENTION,
 * ZERO Meta calls. This test walks the whole chain end to end:
 *   RED   — the second container IS built (the executor runs again). Assertions below fail.
 *   GREEN — the retry is refused with zero Meta calls; the same assertions pass.
 *
 * prisma is MOCKED; the Meta/media executor + reconcile are injected → no network, deterministic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { canTransition } from "@fikirtive/core";

const m = vi.hoisted(() => {
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const publishAttemptCreate = vi.fn();
  const publishAttemptUpdate = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  const publishAttemptFindUnique = vi.fn();
  const publishAttemptFindFirst = vi.fn();
  const metaConnectionFindUnique = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany },
    publishAttempt: {
      create: publishAttemptCreate,
      update: publishAttemptUpdate,
      updateMany: publishAttemptUpdateMany,
      findUnique: publishAttemptFindUnique,
      findFirst: publishAttemptFindFirst,
    },
    metaConnection: { findUnique: metaConnectionFindUnique },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
  };
  return {
    prisma, scheduledPostFindUnique, scheduledPostUpdateMany,
    publishAttemptCreate, publishAttemptUpdate, publishAttemptUpdateMany, publishAttemptFindUnique, publishAttemptFindFirst,
    metaConnectionFindUnique,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));

import { handlePublish } from "./publish.js";

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
  m.publishAttemptFindUnique.mockResolvedValue({ id: "pa1", scheduledPostId: "sp1", creationId: "container_1" });
  m.publishAttemptFindFirst.mockResolvedValue(null); // default: no UNCONFIRMED attempt exists
});

describe("D2 — recovery-path double-post window (RED → GREEN)", () => {
  it("an ambiguous-then-retried publish must NOT build a second container", async () => {
    // ── Run 1: the ambiguous publish that silently went live ─────────────────────────────────
    // The executor reports `ambiguous` (the receipt was lost AFTER media_publish crossed Meta's
    // side-effect point). reconcile mimics the M2 verdict: the container IS live, but we refuse to
    // stamp its id as the post's metaPostId → needs_attention, metaPostId stays null.
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED);
    const run1Exec = vi.fn().mockResolvedValue({ ambiguous: true, error: "media_publish timed out" });
    const reconcile = vi.fn().mockResolvedValue("needs_attention");
    await handlePublish({ scheduledPostId: "sp1" }, 0, run1Exec, reconcile);

    // The post is surfaced NEEDS_ATTENTION (metaPostId still null).
    const na1 = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na1).toBeTruthy();
    // Capture the ambiguity sink's write for a follow-up check (asserted at the end): it must record
    // the attempt as UNCONFIRMED, not FAILED — FAILED would free the partial-unique lock.
    const run1Sink = m.publishAttemptUpdateMany.mock.calls.find(
      (c) => c[0].where?.state === "APPLYING" && c[0].data?.state,
    );

    // ── The owner retries: NEEDS_ATTENTION → SCHEDULED is a LEGAL state transition (no guard) ──
    expect(canTransition("NEEDS_ATTENTION", "SCHEDULED")).toBe(true);

    // ── Run 2: scanDue re-selects the post (metaPostId still null) and the worker runs again ───
    // The DB now holds the UNCONFIRMED attempt written by run 1 (simulated by the findFirst mock).
    const updatesBeforeRun2 = m.scheduledPostUpdateMany.mock.calls.length;
    const createsBeforeRun2 = m.publishAttemptCreate.mock.calls.length;
    m.scheduledPostFindUnique.mockResolvedValue(SCHEDULED); // back to SCHEDULED after the retry
    m.publishAttemptFindFirst.mockResolvedValue({ id: "pa1" }); // the UNCONFIRMED attempt from run 1

    // run2's executor stands for building a SECOND IG container + media_publish = the double-post.
    const run2Exec = vi.fn().mockResolvedValue({ externalId: "ext_DUP" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await handlePublish({ scheduledPostId: "sp1" }, 0, run2Exec);
    vi.unstubAllGlobals();

    // THE HEADLINE INVARIANT — RED fails here (today the second container IS built), GREEN passes:
    expect(run2Exec).not.toHaveBeenCalled();            // zero second container / zero publish call
    expect(fetchSpy).not.toHaveBeenCalled();            // negative: UNCONFIRMED present ⇒ zero Meta
    // no NEW APPLYING claim was taken on run 2 (the guard refuses before lock 2)
    expect(m.publishAttemptCreate.mock.calls.length).toBe(createsBeforeRun2);
    // the retry is refused deterministically → NEEDS_ATTENTION with a human-readable reason
    const na2 = m.scheduledPostUpdateMany.mock.calls
      .slice(updatesBeforeRun2)
      .find((c) => c[0].data?.status === "NEEDS_ATTENTION");
    expect(na2).toBeTruthy();
    expect(String(na2?.[0].data.lastError ?? "")).toMatch(/confirm|already|live/i);

    // Follow-up (the other half of the fix): run 1's ambiguity sink recorded UNCONFIRMED, not FAILED.
    expect(run1Sink?.[0].data.state).toBe("UNCONFIRMED");
  });
});
