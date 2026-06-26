import { describe, it, expect } from "vitest";
import { adJobStatusFromGenStatus } from "../ad-job-status";

describe("adJobStatusFromGenStatus", () => {
  it("returns 'processing' for QUEUED", () => {
    expect(adJobStatusFromGenStatus("QUEUED")).toBe("processing");
  });

  it("returns 'processing' for GENERATING", () => {
    expect(adJobStatusFromGenStatus("GENERATING")).toBe("processing");
  });

  it("returns 'failed' for FAILED", () => {
    expect(adJobStatusFromGenStatus("FAILED")).toBe("failed");
  });

  it("returns null for DONE", () => {
    expect(adJobStatusFromGenStatus("DONE")).toBeNull();
  });

  it("returns null for unknown status", () => {
    expect(adJobStatusFromGenStatus("WHATEVER")).toBeNull();
  });
});
