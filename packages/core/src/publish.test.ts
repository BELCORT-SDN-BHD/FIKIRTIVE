import { describe, it, expect } from "vitest";
import {
  PUBLISH_QUEUE,
  PUBLISH_DLQ,
  PUBLISH_RETRY_LIMIT,
  PUBLISH_QUEUE_POLICY,
  META_REQUEST_TIMEOUT_MS,
  PUBLISH_EXECUTION_DEADLINE_MS,
  publishJobData,
} from "./publish.js";

describe("PUBLISH queue contract (Seam 6)", () => {
  it("DLQ derives from the queue name", () => {
    expect(PUBLISH_QUEUE).toBe("publish");
    expect(PUBLISH_DLQ).toBe("publish.dlq");
  });

  it("policy sets an EXPLICIT retryDelay so retryBackoff isn't a silent no-op (§四A铁律)", () => {
    // pg-boss defaults retry_delay=0, which makes retryBackoff meaningless (instant retry storm).
    expect(PUBLISH_QUEUE_POLICY.retryDelay).toBeGreaterThan(0);
    expect(PUBLISH_QUEUE_POLICY.retryBackoff).toBe(true);
  });

  it("policy carries retryLimit + expire + deadLetter (full Seam 6 shape)", () => {
    expect(PUBLISH_QUEUE_POLICY.retryLimit).toBe(PUBLISH_RETRY_LIMIT);
    expect(PUBLISH_QUEUE_POLICY.expireInSeconds).toBeGreaterThan(0);
    expect(PUBLISH_QUEUE_POLICY.deadLetter).toBe(PUBLISH_DLQ);
  });

  // H7 — the load-bearing deadline ordering that guarantees a hung publish is aborted BEFORE
  // pg-boss can expire + redeliver, and long before the reaper reclaims write ownership.
  it("H7: per-request timeout < whole-execution deadline < queue expire (deadlines bound side effects)", () => {
    const expireMs = PUBLISH_QUEUE_POLICY.expireInSeconds * 1000;
    expect(META_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(META_REQUEST_TIMEOUT_MS).toBeLessThan(PUBLISH_EXECUTION_DEADLINE_MS);
    // The whole execution is aborted strictly before the job can expire + redeliver → no late write.
    expect(PUBLISH_EXECUTION_DEADLINE_MS).toBeLessThan(expireMs);
  });

  it("payload is the ScheduledPost id only, strict + bounded", () => {
    expect(publishJobData.parse({ scheduledPostId: "sp_1" })).toEqual({ scheduledPostId: "sp_1" });
    // strict: no owner or other field may ride along (worker owner-scopes off the row itself).
    expect(publishJobData.safeParse({ scheduledPostId: "sp_1", ownerId: "o1" }).success).toBe(false);
    expect(publishJobData.safeParse({ scheduledPostId: "" }).success).toBe(false);
  });
});
