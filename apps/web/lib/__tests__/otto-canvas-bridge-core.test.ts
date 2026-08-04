import { describe, it, expect } from "vitest";
import { canvasNodeDisplayStatus, firstDisplayableGenerationId, planPendingJobNodes, settledCanvasNodeRepairPatch, type GenCardMsg } from "../otto-canvas-bridge-core";

// The GEN_RESULT planner that used to live here is gone (#601 r2 judge P2②): a delivered job's
// cards are the shared settlement's to plan, so the chat bridge has no second opinion left to test.

const card = (seq: number, genJobId: string | null, kind: string, structuredPrompt?: string): GenCardMsg => ({
  seq,
  genJobId,
  payload: { kind, structuredPrompt },
  text: null,
});

describe("planPendingJobNodes", () => {
  it("plans one pending node per approved GEN_CARD before a GEN_RESULT exists", () => {
    const out = planPendingJobNodes(
      [card(2, "job-video", "video", "make the portrait walk through rain"), card(1, "job-image", "image", "a still")],
      new Map([
        ["job-video", { id: "job-video", generationIds: [] }],
        ["job-image", { id: "job-image", generationIds: [] }],
      ]),
      [],
      [],
    );
    expect(out).toEqual([
      { genJobId: "job-image", kind: "image", prompt: "a still" },
      { genJobId: "job-video", kind: "video", prompt: "make the portrait walk through rain" },
    ]);
  });

  it("does not duplicate a job or a job whose generation is already on canvas", () => {
    const out = planPendingJobNodes(
      [
        card(1, "job-existing-node", "video", "already pending"),
        card(2, "job-existing-generation", "image", "already done"),
        card(3, "job-new", "video", "new"),
        card(4, "job-new", "video", "duplicate card"),
      ],
      new Map([
        ["job-existing-node", { id: "job-existing-node", generationIds: [] }],
        ["job-existing-generation", { id: "job-existing-generation", generationIds: ["gen-1"] }],
        ["job-new", { id: "job-new", generationIds: [] }],
      ]),
      ["gen-1"],
      ["job-existing-node"],
    );
    expect(out).toEqual([{ genJobId: "job-new", kind: "video", prompt: "new" }]);
  });
});

describe("canvasNodeDisplayStatus", () => {
  it("treats a resolved URL as done even when the stored row is still pending", () => {
    expect(canvasNodeDisplayStatus("pending", "DONE", "/files/u/video.mp4")).toBe("done");
  });

  it("uses linked GenJob terminal status when the canvas row is stale", () => {
    expect(canvasNodeDisplayStatus("pending", "FAILED", null)).toBe("failed");
    expect(canvasNodeDisplayStatus("pending", "DONE", null)).toBe("missing");
  });

  it("shows a cancelled job as cancelled, never as a failure (#612)", () => {
    expect(canvasNodeDisplayStatus("pending", "CANCELLED", null)).toBe("cancelled");
  });

  it("only treats linked in-flight jobs as pending", () => {
    expect(canvasNodeDisplayStatus("done", "QUEUED", null)).toBe("pending");
    expect(canvasNodeDisplayStatus("done", "GENERATING", null)).toBe("pending");
  });

  it("falls back to the stored row status when no linked job status is available", () => {
    expect(canvasNodeDisplayStatus("pending", null, null)).toBe("pending");
    expect(canvasNodeDisplayStatus("failed", undefined, null)).toBe("failed");
  });
});

describe("firstDisplayableGenerationId", () => {
  it("uses the first generation with a resolved thumbnail before falling back to the first id", () => {
    expect(firstDisplayableGenerationId(["g-missing", "g-good"], { "g-good": { src: "/files/u/good.jpeg" } })).toBe("g-good");
    expect(firstDisplayableGenerationId(["g-missing", "g-later"], {})).toBe("g-missing");
    expect(firstDisplayableGenerationId([], {})).toBeNull();
  });
});

describe("settledCanvasNodeRepairPatch", () => {
  it("repairs a stale pending node when a linked done job has displayable media", () => {
    expect(settledCanvasNodeRepairPatch("pending", null, "DONE", "gen-1", "/files/u/gen-1.jpeg")).toEqual({
      status: "done",
      generationId: "gen-1",
    });
  });

  it("only backfills generationId when the stored status is already done", () => {
    expect(settledCanvasNodeRepairPatch("done", null, "DONE", "gen-1", "/files/u/gen-1.jpeg")).toEqual({
      generationId: "gen-1",
    });
  });

  it("marks failed terminal jobs without inventing a generation id", () => {
    expect(settledCanvasNodeRepairPatch("pending", null, "FAILED", null, null)).toEqual({ status: "failed" });
  });

  it("does not persist a missing-media display state as a destructive repair", () => {
    expect(settledCanvasNodeRepairPatch("pending", null, "DONE", "gen-1", null)).toBeNull();
  });
});
