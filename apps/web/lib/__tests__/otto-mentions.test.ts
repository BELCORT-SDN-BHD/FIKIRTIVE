import { describe, it, expect } from "vitest";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";

describe("activeMentionQuery", () => {
  it("returns the query when caret is right after typed text", () => {
    expect(activeMentionQuery("hi @sun", 7)).toBe("sun");
  });

  it("returns null when a space after the mention closed it", () => {
    expect(activeMentionQuery("hi @sun ", 8)).toBe(null);
  });

  it("returns null when there is no @ present", () => {
    expect(activeMentionQuery("hi", 2)).toBe(null);
  });

  it("returns empty string when @ is typed but nothing follows", () => {
    expect(activeMentionQuery("@", 1)).toBe("");
  });

  it("returns partial query when caret is mid-word", () => {
    expect(activeMentionQuery("hi @sun", 5)).toBe("s");
  });

  it("returns null when @ is preceded by non-whitespace (email-style)", () => {
    expect(activeMentionQuery("email@domain.com", 16)).toBe(null);
  });

  it("returns empty string when @ is at end with nothing typed", () => {
    expect(activeMentionQuery("hi @", 4)).toBe("");
  });
});

describe("resolveSentEntityIds", () => {
  it("keeps only entities whose @name appears in the text", () => {
    expect(
      resolveSentEntityIds("use @Sunglasses please", [
        { id: "e1", name: "Sunglasses" },
        { id: "e2", name: "Hat" },
      ])
    ).toEqual(["e1"]);
  });

  it("returns both ids when both @names appear", () => {
    const result = resolveSentEntityIds("use @Hat and @Sunglasses", [
      { id: "e1", name: "Sunglasses" },
      { id: "e2", name: "Hat" },
    ]);
    expect(result).toHaveLength(2);
    expect(result).toContain("e1");
    expect(result).toContain("e2");
  });

  it("returns empty array when no mentions appear in text", () => {
    expect(
      resolveSentEntityIds("no mentions here", [{ id: "e1", name: "Sunglasses" }])
    ).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(
      resolveSentEntityIds("use @sunglasses please", [{ id: "e1", name: "Sunglasses" }])
    ).toEqual(["e1"]);
  });

  it("returns only the entity whose name still appears", () => {
    expect(
      resolveSentEntityIds("@Hat was removed", [
        { id: "e1", name: "Sunglasses" },
        { id: "e2", name: "Hat" },
      ])
    ).toEqual(["e2"]);
  });
});
