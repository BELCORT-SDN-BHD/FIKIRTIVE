import { describe, it, expect, beforeEach } from "vitest";
import { readPick, writePick } from "@/lib/result-pick";

// Use a simple in-memory localStorage mock for jsdom-less environments.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; },
};
Object.defineProperty(globalThis, "window", { value: { localStorage: localStorageMock }, writable: true });

beforeEach(() => localStorageMock.clear());

describe("writePick / readPick", () => {
  it("round-trips an index", () => {
    writePick("gen_abc123", 2);
    expect(readPick("gen_abc123")).toBe(2);
  });

  it("returns null for unknown id", () => {
    expect(readPick("gen_unknown")).toBeNull();
  });

  it("returns null for corrupt storage value", () => {
    store["otto:pick:gen_bad"] = "notanumber";
    expect(readPick("gen_bad")).toBeNull();
  });

  it("overwrites previous pick", () => {
    writePick("gen_xyz", 0);
    writePick("gen_xyz", 3);
    expect(readPick("gen_xyz")).toBe(3);
  });

  it("isolates picks by id", () => {
    writePick("gen_a", 0);
    writePick("gen_b", 1);
    expect(readPick("gen_a")).toBe(0);
    expect(readPick("gen_b")).toBe(1);
  });
});
