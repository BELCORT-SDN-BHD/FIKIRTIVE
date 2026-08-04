import { describe, it, expect } from "vitest";
import { canvasNodeDisplayStatus, censusCanvasJobCards, displayGenerationIdForCard, firstDisplayableGenerationId, planPendingJobNodes, type GenCardMsg } from "../otto-canvas-bridge-core";

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

/**
 * #613 r4 (cross-family judge P1) — the one rule both board readers use for "which output does
 * this card show?", and in particular what an UNBOUND card is allowed to borrow.
 */
describe("displayGenerationIdForCard", () => {
  const thumbs = { "gen-0": { src: "/files/u/0.jpeg" }, "gen-1": { src: "/files/u/1.jpeg" } };
  const outputs = ["gen-0", "gen-1"];

  function show(
    rowGenerationId: string | null,
    board: { genJobId: string | null; generationId: string | null }[],
    genJobId: string | null = "job-1",
  ) {
    return displayGenerationIdForCard({
      rowGenerationId,
      genJobId,
      jobGenerationIds: outputs,
      census: censusCanvasJobCards(board),
      thumbs,
    });
  }

  it("shows the output the row actually carries, whatever else is on the board", () => {
    expect(show("gen-1", [
      { genJobId: "job-1", generationId: "gen-0" },
      { genJobId: "job-1", generationId: "gen-1" },
    ])).toBe("gen-1");
  });

  it("lends the job's sole unbound card its first free output — what the fallback is FOR", () => {
    // A promptbar card, delivered but not yet settled: without this the merchant sees a blank
    // card and the client's Make video / Detail guard no-ops on it.
    expect(show(null, [{ genJobId: "job-1", generationId: null }])).toBe("gen-0");
  });

  it("never lends an output another live card of the same job is already showing", () => {
    expect(show(null, [
      { genJobId: "job-1", generationId: "gen-0" },
      { genJobId: "job-1", generationId: null },
    ])).toBe("gen-1");
    // …and when every output is spoken for, the extra card shows nothing at all.
    expect(show(null, [
      { genJobId: "job-1", generationId: "gen-0" },
      { genJobId: "job-1", generationId: "gen-1" },
      { genJobId: "job-1", generationId: null },
    ])).toBeNull();
  });

  it("lends nothing when a job has two unbound cards — neither one is knowably the anchor", () => {
    const twoAnchors = [
      { genJobId: "job-1", generationId: null },
      { genJobId: "job-1", generationId: null },
    ];
    expect(show(null, twoAnchors)).toBeNull();
  });

  it("counts each job's cards separately, and ignores cards that belong to no job", () => {
    const board = [
      { genJobId: "job-1", generationId: null },
      { genJobId: "job-2", generationId: null },
      { genJobId: null, generationId: "hand-placed" },
    ];
    expect(show(null, board, "job-1")).toBe("gen-0");
    expect(show(null, board, "job-2")).toBe("gen-0");
    // A card with no job has nothing to borrow from.
    expect(show(null, board, null)).toBeNull();
  });
});
