import { describe, it, expect } from "vitest";
import { canvasNodeDisplayStatus, firstDisplayableGenerationId, planPendingJobNodes, type GenCardMsg } from "../otto-canvas-bridge-core";

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
        ["job-video", { id: "job-video", generationIds: [], status: "GENERATING" }],
        ["job-image", { id: "job-image", generationIds: [], status: "GENERATING" }],
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
        ["job-existing-node", { id: "job-existing-node", generationIds: [], status: "GENERATING" }],
        ["job-existing-generation", { id: "job-existing-generation", generationIds: ["gen-1"], status: "GENERATING" }],
        ["job-new", { id: "job-new", generationIds: [], status: "GENERATING" }],
      ]),
      ["gen-1"],
      ["job-existing-node"],
    );
    expect(out).toEqual([{ genJobId: "job-new", kind: "video", prompt: "new" }]);
  });

  /**
   * #613 r2 (cross-family judge P1). The GEN_CARD is durable — production stamps it with its job
   * id and it lives in the thread for ever — so this planner meets the same card on every reload,
   * long after the job ended. Only a job that is genuinely still running may be given a card here;
   * a finished one, settled or not, belongs to the settlement and the backfill sweep.
   */
  it.each(["QUEUED", "GENERATING"])("plans a card for a job that is still %s", (status) => {
    const out = planPendingJobNodes(
      [card(1, "job-1", "image", "a still")],
      new Map([["job-1", { id: "job-1", generationIds: [], status }]]),
      [],
      [],
    );
    expect(out).toEqual([{ genJobId: "job-1", kind: "image", prompt: "a still" }]);
  });

  it.each(["DONE", "FAILED", "CANCELLED"])("never plans a card for a job that already ended (%s)", (status) => {
    const out = planPendingJobNodes(
      [card(1, "job-1", "image", "a still")],
      // The board is empty and the job's outputs are nowhere on it — i.e. its settlement write
      // fell over. Every OTHER guard in this planner passes; only the status gate stops it.
      new Map([["job-1", { id: "job-1", generationIds: ["gen-1"], status }]]),
      [],
      [],
    );
    expect(out).toEqual([]);
  });

  it("never plans a card for a status nobody has considered", () => {
    // Fails closed: a status added to the schema without meeting the decision in
    // CANVAS_IN_FLIGHT_JOB_STATUSES gets no card from a board read.
    const out = planPendingJobNodes(
      [card(1, "job-1", "image", "a still")],
      new Map([["job-1", { id: "job-1", generationIds: [], status: "SOMETHING_NEW" }]]),
      [],
      [],
    );
    expect(out).toEqual([]);
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
