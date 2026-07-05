import { describe, expect, it } from "vitest";
import { coworkTurnRequest } from "./cowork.js";

describe("coworkTurnRequest sourceGenerationId", () => {
  const base = { projectId: "p1", text: "animate this" };
  it("is optional (a normal turn omits it)", () => {
    const r = coworkTurnRequest.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationId).toBeUndefined();
  });
  it("accepts an id within bounds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationId: "gen_abc" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationId).toBe("gen_abc");
  });
  it("rejects an over-long id", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest sourceGenerationIds", () => {
  const base = { projectId: "p1", text: "compare these" };
  it("accepts multiple bounded image reference ids", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationIds: ["gen_a", "gen_b"] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.sourceGenerationIds).toEqual(["gen_a", "gen_b"]);
  });
  it("rejects over-length ids inside sourceGenerationIds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, sourceGenerationIds: ["gen_a", "x".repeat(65)] });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest referenceVideoGenerationId", () => {
  const base = { projectId: "p", text: "hi" };
  it("accepts a bounded referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "gen_vid" });
    expect(r.success && r.data.referenceVideoGenerationId).toBe("gen_vid");
  });
  it("rejects an over-length referenceVideoGenerationId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });
});

describe("coworkTurnRequest referenceVideoGenerationIds", () => {
  const base = { projectId: "p", text: "hi" };
  it("accepts multiple bounded video reference ids", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationIds: ["gen_vid_1", "gen_vid_2"] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.referenceVideoGenerationIds).toEqual(["gen_vid_1", "gen_vid_2"]);
  });
  it("rejects over-length ids inside referenceVideoGenerationIds", () => {
    const r = coworkTurnRequest.safeParse({ ...base, referenceVideoGenerationIds: ["gen_vid", "x".repeat(65)] });
    expect(r.success).toBe(false);
  });
});
