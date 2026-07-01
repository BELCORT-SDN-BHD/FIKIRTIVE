import { describe, it, expect } from "vitest";
import { identityLockClause, promptRef, CAMERA_MOVES } from "./prompt-vocab.js";

describe("identityLockClause", () => {
  it("empty refs → empty string", () => {
    expect(identityLockClause([])).toBe("");
  });
  it("product lock phrasing names the entity", () => {
    const out = identityLockClause([{ role: "product", name: "the AeroBottle", lock: true }]);
    expect(out).toContain("the AeroBottle");
    expect(out).toContain("same shape, color, and label");
  });
  it("character lock preserves face/hair/build", () => {
    const out = identityLockClause([{ role: "character", name: "Mia", lock: true }]);
    expect(out).toContain("same face, hairstyle, and build");
  });
  it("lock:false switches to stylistic-inspiration phrasing", () => {
    const out = identityLockClause([{ role: "location", name: "the loft", lock: false }]);
    expect(out).toContain("draw stylistic inspiration from the loft");
  });
  it("multiple refs joined with '; '", () => {
    const out = identityLockClause([
      { role: "product", name: "A", lock: true },
      { role: "brandmark", name: "B", lock: true },
    ]);
    expect(out).toContain("; ");
    expect(out).toContain("reproduce the B logo");
  });
});

describe("promptRef schema", () => {
  it("defaults lock to true", () => {
    expect(promptRef.parse({ role: "product", name: "X" }).lock).toBe(true);
  });
  it("rejects an unknown role", () => {
    expect(promptRef.safeParse({ role: "vehicle", name: "X" }).success).toBe(false);
  });
});

describe("vocab constants", () => {
  it("camera moves is a non-empty readonly list", () => {
    expect(CAMERA_MOVES.length).toBeGreaterThan(0);
  });
});
