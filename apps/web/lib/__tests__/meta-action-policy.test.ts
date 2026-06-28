import { describe, it, expect } from "vitest";
import { classifyMoneyClass, policyDecision, type AdOp } from "../meta-action-policy";

describe("classifyMoneyClass", () => {
  it("pause and budget_down are safe", () => {
    expect(classifyMoneyClass("pause")).toBe("safe");
    expect(classifyMoneyClass("budget_down")).toBe("safe");
  });
  it("resume, budget_up, reschedule are spend (reschedule fail-safe)", () => {
    expect(classifyMoneyClass("resume")).toBe("spend");
    expect(classifyMoneyClass("budget_up")).toBe("spend");
    expect(classifyMoneyClass("reschedule")).toBe("spend");
  });
  it("unknown op falls back to spend", () => {
    expect(classifyMoneyClass("bogus" as AdOp)).toBe("spend");
  });
});

describe("policyDecision", () => {
  it("AUTO + safe → auto", () => {
    expect(policyDecision("AUTO", "safe")).toBe("auto");
  });
  it("everything else → ask", () => {
    expect(policyDecision("AUTO", "spend")).toBe("ask");
    expect(policyDecision("ASK", "safe")).toBe("ask");
    expect(policyDecision("ASK", "spend")).toBe("ask");
  });
  it("unknown mode → ask (fail-closed)", () => {
    expect(policyDecision("bogus" as never, "safe")).toBe("ask");
  });
});
