import { describe, expect, it } from "vitest";
import { coworkVaryCardRequest } from "./cowork.js";

describe("coworkVaryCardRequest", () => {
  it("accepts a valid cardId", () => {
    const r = coworkVaryCardRequest.safeParse({ cardId: "abc" });
    expect(r.success).toBe(true);
  });
  it("rejects missing cardId", () => {
    const r = coworkVaryCardRequest.safeParse({});
    expect(r.success).toBe(false);
  });
  it("rejects empty cardId", () => {
    const r = coworkVaryCardRequest.safeParse({ cardId: "" });
    expect(r.success).toBe(false);
  });
  it("rejects extra keys (.strict())", () => {
    const r = coworkVaryCardRequest.safeParse({ cardId: "abc", extra: "bad" });
    expect(r.success).toBe(false);
  });
});
