import { describe, it, expect } from "vitest";
import { nextActiveThreadId } from "../thread-list";

const threads = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
];

describe("nextActiveThreadId", () => {
  it("deleting non-active thread keeps active unchanged", () => {
    expect(nextActiveThreadId(threads, "b", "a")).toBe("a");
  });

  it("deleting active thread picks the first remaining thread", () => {
    // delete "a" (first) → next first remaining is "b"
    expect(nextActiveThreadId(threads, "a", "a")).toBe("b");
    // delete "b" (middle) → next first remaining is "a"
    expect(nextActiveThreadId(threads, "b", "b")).toBe("a");
  });

  it("deleting the only/last thread returns null", () => {
    expect(nextActiveThreadId([{ id: "x" }], "x", "x")).toBeNull();
  });

  it("returns null when currentActive is null and deletedId matches nothing", () => {
    expect(nextActiveThreadId(threads, "z", null)).toBeNull();
  });
});
