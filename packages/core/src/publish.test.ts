import { describe, it, expect } from "vitest";
import {
  PUBLISH_QUEUE,
  PUBLISH_DLQ,
  PUBLISH_RETRY_LIMIT,
  PUBLISH_QUEUE_POLICY,
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

  it("payload is the ScheduledPost id only, strict + bounded", () => {
    expect(publishJobData.parse({ scheduledPostId: "sp_1" })).toEqual({ scheduledPostId: "sp_1" });
    // strict: no owner or other field may ride along (worker owner-scopes off the row itself).
    expect(publishJobData.safeParse({ scheduledPostId: "sp_1", ownerId: "o1" }).success).toBe(false);
    expect(publishJobData.safeParse({ scheduledPostId: "" }).success).toBe(false);
  });
});
