import { describe, it, expect } from "vitest";
import { buildDeploySignal } from "@/lib/deploy-fingerprint";

const WEB = { commitSha: "aaaaaaaabbbbbbbb", configFingerprint: "1234abcd" };

describe("buildDeploySignal (#797)", () => {
  it("in sync when both sides agree on code and configuration", () => {
    const signal = buildDeploySignal(WEB, { ...WEB });
    expect(signal.tone).toBe("success");
    expect(signal.status).toBe("in sync");
  });

  it("code mismatch is red and names both shas", () => {
    const signal = buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "1234abcd" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("code mismatch");
    expect(signal.detail).toContain("aaaaaaaa");
    expect(signal.detail).toContain("cccccccc");
  });

  it("config mismatch is red even when the code matches — the expensive silent case", () => {
    const signal = buildDeploySignal(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("config mismatch");
    expect(signal.detail).toContain("1234abcd");
    expect(signal.detail).toContain("9999ffff");
  });

  it("both wrong at once is reported as one split deploy, not two half-truths", () => {
    const signal = buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("split deploy");
  });

  it("a missing heartbeat row warns instead of claiming agreement", () => {
    const signal = buildDeploySignal(WEB, null);
    expect(signal.tone).toBe("warning");
    expect(signal.status).toBe("no worker heartbeat");
  });

  it("an unknown commit sha never masquerades as a match", () => {
    const signal = buildDeploySignal(
      { commitSha: null, configFingerprint: "1234abcd" },
      { commitSha: null, configFingerprint: "1234abcd" },
    );
    expect(signal.tone).toBe("info");
    expect(signal.detail).toContain("cannot be compared");
  });

  it("shows short shas, not full ones", () => {
    const signal = buildDeploySignal(WEB, { ...WEB });
    expect(signal.detail).toContain("aaaaaaaa");
    expect(signal.detail).not.toContain("aaaaaaaabbbbbbbb");
  });
});
