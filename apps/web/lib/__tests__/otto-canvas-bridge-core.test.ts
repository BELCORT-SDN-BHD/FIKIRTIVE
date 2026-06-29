import { describe, it, expect } from "vitest";
import { planBridgeNodes, type GenResultMsg } from "../otto-canvas-bridge-core";

const msg = (seq: number, genJobId: string | null, kind?: string, text: string | null = null): GenResultMsg => ({
  seq,
  genJobId,
  payload: kind ? { kind } : {},
  text,
});

describe("planBridgeNodes", () => {
  it("plans one node per generation, ordered by seq, with image/video kind", () => {
    const out = planBridgeNodes(
      [msg(2, "job-b", "video", "a clip"), msg(1, "job-a", "image", "a still")],
      new Map([
        ["job-a", ["gen-a1"]],
        ["job-b", ["gen-b1"]],
      ]),
      [],
    );
    expect(out).toEqual([
      { generationId: "gen-a1", genJobId: "job-a", kind: "image", prompt: "a still" },
      { generationId: "gen-b1", genJobId: "job-b", kind: "video", prompt: "a clip" },
    ]);
  });

  it("is idempotent: skips generations already on the canvas (the money-adjacent safety property)", () => {
    const out = planBridgeNodes(
      [msg(1, "job-a", "image")],
      new Map([["job-a", ["gen-a1", "gen-a2"]]]),
      ["gen-a1"], // already bridged
    );
    expect(out.map((n) => n.generationId)).toEqual(["gen-a2"]);
  });

  it("never plans the same generation twice within one pass", () => {
    // two GEN_RESULTs pointing at jobs that share a generation id
    const out = planBridgeNodes(
      [msg(1, "job-a", "image"), msg(2, "job-b", "image")],
      new Map([
        ["job-a", ["gen-shared"]],
        ["job-b", ["gen-shared", "gen-b2"]],
      ]),
      [],
    );
    expect(out.map((n) => n.generationId)).toEqual(["gen-shared", "gen-b2"]);
  });

  it("defaults to image when kind is missing or invalid; ignores messages with no job", () => {
    const out = planBridgeNodes(
      [msg(1, null, "image"), msg(2, "job-x", "bogus")],
      new Map([["job-x", ["gen-x"]]]),
      [],
    );
    expect(out).toEqual([{ generationId: "gen-x", genJobId: "job-x", kind: "image", prompt: null }]);
  });

  it("returns nothing when there are no results or no resolved generations", () => {
    expect(planBridgeNodes([], new Map(), [])).toEqual([]);
    expect(planBridgeNodes([msg(1, "job-a", "image")], new Map(), [])).toEqual([]);
  });
});
