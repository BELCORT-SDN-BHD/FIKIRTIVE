import { describe, expect, it } from "vitest";
import { CANVAS_JOB_KEY_PREFIX, isCanvasJobKey } from "@fikirtive/core";
import {
  canvasActionKey,
  factoryAttemptKey,
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  parseCanvasActionKey,
  parseFactoryAttemptKey,
} from "../batch-idempotency";

describe("canvas action keys", () => {
  it("derives a stable reserved key without exposing the client action id", () => {
    const first = canvasActionKey("canvas-action-123");
    const replay = canvasActionKey("canvas-action-123");
    const other = canvasActionKey("canvas-action-456");

    expect(first).toEqual(replay);
    expect(first.key).toHaveLength(71);
    expect(first.key).not.toContain("canvas-action-123");
    expect(parseCanvasActionKey(first.key)).toEqual(first);
    expect(first).not.toEqual(other);
    expect(parseCanvasActionKey("canvas:caller-controlled")).toBeNull();
  });

  it("keeps the WHOLE key shape the settlement reads as 'this job was bought from the board'", () => {
    // The canvas settlement decides whether a delivered job belongs on a board by reading this
    // key (packages/core, isCanvasJobKey). The two live in different packages, so pin them
    // together here: changing the shape on one side without the other would silently stop paid
    // canvas work from ever reaching the board.
    const minted = canvasActionKey("canvas-action-123").key;
    expect(minted.startsWith(CANVAS_JOB_KEY_PREFIX)).toBe(true);
    expect(CANVAS_JOB_KEY_PREFIX).toBe("canvas:");
    expect(isCanvasJobKey(minted)).toBe(true);

    // …and the reading side is no looser than the minting side (#601 r2 judge P2①). Anything the
    // reserved-family parser refuses must not be read back as a board purchase either.
    for (const forged of ["canvas:caller-controlled", `${CANVAS_JOB_KEY_PREFIX}abc`, `${CANVAS_JOB_KEY_PREFIX}${"a".repeat(32)}`]) {
      expect({ forged, parsed: parseCanvasActionKey(forged), read: isCanvasJobKey(forged) })
        .toEqual({ forged, parsed: null, read: false });
    }
  });
});

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

    expect(factoryMaterialMatches({
      ...expected,
      variantSel: { e1: "v1", e2: "changed" },
    }, expected)).toBe(false);
    expect(factoryMaterialMatches({
      ...expected,
      variantSel: { e1: "v1", e3: "v2" },
    }, expected)).toBe(false);
  });

  it("canonicalizes omitted and empty image variant selections to the same material in both directions", () => {
    const omitted = normalizeFactoryMaterial({
      prompt: "hero",
      model: "seedream",
      kind: "image",
      count: 1,
      entityIds: ["e1"],
    });
    const empty = normalizeFactoryMaterial({
      prompt: "hero",
      model: "seedream",
      kind: "image",
      count: 1,
      entityIds: ["e1"],
      variantSel: {},
    });

    expect(empty.variantSel).toBeNull();
    expect(factoryMaterialMatches({ ...omitted, variantSel: {} }, omitted)).toBe(true);
    expect(factoryMaterialMatches({ ...empty, variantSel: null }, empty)).toBe(true);
  });

  it("does not erase duplicate entity ids — [a,a] is different from [a]", () => {
    expect(factoryMaterialMatches({
      ...expected,
      entityIds: ["e1", "e2", "e2"],
    }, expected)).toBe(false);
  });

  it("binds the live thread attribution as frozen generation material", () => {
    expect(factoryMaterialMatches({
      ...expected,
      threadId: "thread-other",
    }, {
      ...expected,
      threadId: "thread-expected",
    })).toBe(false);
  });
});
