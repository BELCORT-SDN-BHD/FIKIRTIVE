import { describe, expect, it } from "vitest";
import { castFindings } from "./cowork-guardian.js";

const ent = (id: string, type: string, liveRefCount: number, name = id) => ({ id, name, type, liveRefCount });

describe("castFindings", () => {
  it("clean request → no findings", () => {
    expect(castFindings({ requestedEntityIds: ["a"], entities: [ent("a", "CHARACTER", 2)] })).toEqual([]);
  });

  it("missing-entity: a requested id with no live entity loaded", () => {
    const f = castFindings({ requestedEntityIds: ["a", "ghost"], entities: [ent("a", "CHARACTER", 1)] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "missing-entity", entityId: "ghost" });
  });

  it("character-no-refs: CHARACTER with zero live refs (only CHARACTER, not LOCATION)", () => {
    const f = castFindings({
      requestedEntityIds: ["c", "l"],
      entities: [ent("c", "CHARACTER", 0, "Mara"), ent("l", "LOCATION", 0)],
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "character-no-refs", entityId: "c" });
    expect(f[0]?.message).toContain("Mara");
  });

  it("a CHARACTER with refs is fine", () => {
    expect(castFindings({ requestedEntityIds: ["c"], entities: [ent("c", "CHARACTER", 3)] })).toEqual([]);
  });

  it("multi-char-block ONLY when 2+ characters AND castRule is block", () => {
    const two = [ent("a", "CHARACTER", 1), ent("b", "CHARACTER", 1)];
    expect(castFindings({ requestedEntityIds: ["a", "b"], entities: two, castRule: "block" }).some((x) => x.kind === "multi-char-block")).toBe(true);
    // "warn" is Coach's job, NOT a Guardian block
    expect(castFindings({ requestedEntityIds: ["a", "b"], entities: two, castRule: "warn" }).some((x) => x.kind === "multi-char-block")).toBe(false);
    // no rule → no block
    expect(castFindings({ requestedEntityIds: ["a", "b"], entities: two }).some((x) => x.kind === "multi-char-block")).toBe(false);
    // a single character never blocks
    expect(castFindings({ requestedEntityIds: ["a"], entities: [ent("a", "CHARACTER", 1)], castRule: "block" }).some((x) => x.kind === "multi-char-block")).toBe(false);
  });

  it("no entities requested → no findings", () => {
    expect(castFindings({ requestedEntityIds: [], entities: [], castRule: "block" })).toEqual([]);
  });
});
