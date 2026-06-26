import { describe, it, expect } from "vitest";
import { threadBadgeFromJobStatus } from "../thread-status";

describe("threadBadgeFromJobStatus", () => {
  it("returns 'working' for QUEUED", () => {
    expect(threadBadgeFromJobStatus("QUEUED")).toBe("working");
  });

  it("returns 'working' for GENERATING", () => {
    expect(threadBadgeFromJobStatus("GENERATING")).toBe("working");
  });

  it("returns 'failed' for FAILED", () => {
    expect(threadBadgeFromJobStatus("FAILED")).toBe("failed");
  });

  it("returns 'done' for DONE", () => {
    expect(threadBadgeFromJobStatus("DONE")).toBe("done");
  });

  it("returns null for null", () => {
    expect(threadBadgeFromJobStatus(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(threadBadgeFromJobStatus(undefined)).toBeNull();
  });

  it("returns null for unknown status", () => {
    expect(threadBadgeFromJobStatus("PENDING")).toBeNull();
    expect(threadBadgeFromJobStatus("")).toBeNull();
    expect(threadBadgeFromJobStatus("CANCELLED")).toBeNull();
  });
});
