import { describe, expect, it } from "vitest";
import { buildBytePlusPackSignal } from "../byteplus-pack-alert";

describe("buildBytePlusPackSignal", () => {
  it("warns when pack capacity is not configured", () => {
    const signal = buildBytePlusPackSignal({ estimatedUsedUsd: 12.34, env: {} });

    expect(signal.status).toBe("configure alert");
    expect(signal.tone).toBe("warning");
    expect(signal.count).toBe(1234);
  });

  it("uses console-provided used USD when configured", () => {
    const signal = buildBytePlusPackSignal({
      estimatedUsedUsd: 5,
      env: { capacityUsd: "35.64", usedUsd: "30", alertPct: "20" },
    });

    expect(signal.status).toBe("renew soon");
    expect(signal.tone).toBe("warning");
    expect(signal.detail).toContain("$5.64 remaining");
  });

  it("marks a healthy pack as covered", () => {
    const signal = buildBytePlusPackSignal({
      estimatedUsedUsd: 10,
      env: { capacityUsd: "35.64", alertPct: "20" },
    });

    expect(signal.status).toBe("covered");
    expect(signal.tone).toBe("success");
  });

  it("marks exhausted or over-capacity packs as danger", () => {
    const signal = buildBytePlusPackSignal({
      estimatedUsedUsd: 40,
      env: { capacityUsd: "35.64" },
    });

    expect(signal.status).toBe("depleted");
    expect(signal.tone).toBe("danger");
    expect(signal.count).toBe(0);
  });
});
