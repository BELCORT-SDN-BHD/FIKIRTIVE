import { describe, expect, it } from "vitest";
import {
  refGenRequest,
  refGenJobData,
  REFGEN_MODELS,
  MAX_REFGEN_COUNT,
  MAX_REFGEN_PROMPT,
} from "./refgen.js";

const ok = { entityId: "01ABC", prompt: "a red hoodie with the logo", count: 4 };

describe("refGenRequest", () => {
  it("accepts a well-formed request and defaults the model", () => {
    expect(refGenRequest.parse(ok)).toEqual({ ...ok, model: "seedream", mode: "REFSHEET" });
  });

  it("trims and bounds the prompt", () => {
    expect(refGenRequest.parse({ ...ok, prompt: "  hi  " }).prompt).toBe("hi");
    expect(() => refGenRequest.parse({ ...ok, prompt: "" })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, prompt: "   " })).toThrow(); // trims to empty
    expect(() => refGenRequest.parse({ ...ok, prompt: "x".repeat(MAX_REFGEN_PROMPT + 1) })).toThrow();
  });

  it("bounds count to the provider's per-call window", () => {
    expect(refGenRequest.parse({ ...ok, count: 1 }).count).toBe(1);
    expect(refGenRequest.parse({ ...ok, count: MAX_REFGEN_COUNT }).count).toBe(MAX_REFGEN_COUNT);
    expect(() => refGenRequest.parse({ ...ok, count: 0 })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, count: MAX_REFGEN_COUNT + 1 })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, count: 2.5 })).toThrow();
  });

  it("rejects unknown models and unknown fields (no url smuggling)", () => {
    expect(() => refGenRequest.parse({ ...ok, model: "midjourney" })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, inputImageUrls: ["http://evil/x.png"] })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, entityId: "" })).toThrow();
  });

  it("only ships the documented model menu", () => {
    expect(REFGEN_MODELS).toEqual(["seedream"]);
  });

  it("defaults mode to REFSHEET and rejects mode/variantId mismatch", () => {
    expect(refGenRequest.parse(ok).mode).toBe("REFSHEET");
    expect(refGenRequest.parse({ ...ok, mode: "BASE" }).mode).toBe("BASE");
    // VARIANT requires a variantId
    expect(() => refGenRequest.parse({ ...ok, mode: "VARIANT" })).toThrow();
    expect(refGenRequest.parse({ ...ok, mode: "VARIANT", variantId: "v1" }).variantId).toBe("v1");
    // a variantId without VARIANT mode is a contract error
    expect(() => refGenRequest.parse({ ...ok, mode: "BASE", variantId: "v1" })).toThrow();
    expect(() => refGenRequest.parse({ ...ok, variantId: "v1" })).toThrow();
    // unknown mode rejected
    expect(() => refGenRequest.parse({ ...ok, mode: "WHATEVER" })).toThrow();
  });
});

describe("refGenJobData", () => {
  it("is a strict id envelope", () => {
    expect(refGenJobData.parse({ refGenJobId: "j1" }).refGenJobId).toBe("j1");
    expect(() => refGenJobData.parse({ refGenJobId: "" })).toThrow();
    expect(() => refGenJobData.parse({ refGenJobId: "j1", extra: 1 })).toThrow();
  });
});
