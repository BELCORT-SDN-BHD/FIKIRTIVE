import { describe, expect, it } from "vitest";
import {
  factoryAttemptKey,
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  parseFactoryAttemptKey,
} from "../batch-idempotency";

describe("factory attempt keys", () => {
  it("are stable, parseable, and exactly 79 chars (inside genRequest's 80-char cap)", () => {
    const first = factoryAttemptKey("b".repeat(64), 23, "a".repeat(64));
    const replay = factoryAttemptKey("b".repeat(64), 23, "a".repeat(64));

    expect(first).toEqual(replay);
    expect(first.key).toHaveLength(79);
    expect(parseFactoryAttemptKey(first.key)).toEqual(first);
  });

  it("separates logical cells from retry attempts", () => {
    const a = factoryAttemptKey("batch-1", 0, "attempt-a");
    const replay = factoryAttemptKey("batch-1", 0, "attempt-a");
    const retry = factoryAttemptKey("batch-1", 0, "attempt-b");
    const nextCell = factoryAttemptKey("batch-1", 1, "attempt-a");

    expect(a.key).toBe(replay.key);
    expect(a.logicalPrefix).toBe(retry.logicalPrefix);
    expect(a.key).not.toBe(retry.key);
    expect(a.logicalPrefix).not.toBe(nextCell.logicalPrefix);
    expect(parseFactoryAttemptKey("batch:legacy:cell:0")).toBeNull();
  });
});

describe("factory material binding", () => {
  const expected = normalizeFactoryMaterial({
    prompt: "hero",
    model: "seedream",
    kind: "image",
    count: 1,
    entityIds: ["e1", "e2"],
    variantSel: { e1: "v1", e2: "v2" },
  });

  it("keeps entity order significant while ignoring JSON object key order", () => {
    expect(factoryMaterialMatches({
      ...expected,
      entityIds: ["e1", "e2"],
      variantSel: { e2: "v2", e1: "v1" },
    }, expected)).toBe(true);

    expect(factoryMaterialMatches({
      ...expected,
      entityIds: ["e2", "e1"],
    }, expected)).toBe(false);
  });

  it("does not erase duplicate entity ids — [a,a] is different from [a]", () => {
    expect(factoryMaterialMatches({
      ...expected,
      entityIds: ["e1", "e2", "e2"],
    }, expected)).toBe(false);
  });
});
