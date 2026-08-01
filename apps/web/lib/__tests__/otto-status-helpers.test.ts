/**
 * otto-status-helpers.test.ts — unit tests for the PURE status/error narrowing
 * helpers (pickLiveStatusText, asStatusData, asErrorData). Pure: no React, no
 * SDK construction, runs in the node harness.
 */
import { describe, it, expect } from "vitest";
import {
  pickLiveStatusText,
  asStatusData,
  asErrorData,
  dataErrorOf,
  asStepData,
  deriveTraceSteps,
  isTerminalRunState,
  runStateOfCard,
  runStateOfStream,
  runStateSpins,
  shouldShowTracePanel,
  TERMINAL_RUN_STATES,
  type OttoRunState,
} from "@/lib/otto-status-helpers";
import type { OttoStatusData, OttoStepData } from "@/lib/otto-stream-bridge";

const startStep = (id: string, label: string): OttoStepData => ({ id, label, phase: "start" });
const doneStep = (id: string, label: string): OttoStepData => ({ id, label, phase: "done" });

describe("pickLiveStatusText", () => {
  it("returns the text for a planning status", () => {
    const s: OttoStatusData = { kind: "planning", text: "planning your ad…" };
    expect(pickLiveStatusText(s)).toBe("planning your ad…");
  });

  it("returns null for null", () => {
    expect(pickLiveStatusText(null)).toBeNull();
  });

  it("returns null for terminal kinds (done, degraded, stale, needs_approval)", () => {
    expect(pickLiveStatusText({ kind: "done", threadId: "thr_1" })).toBeNull();
    expect(pickLiveStatusText({ kind: "degraded", text: "something went wrong" })).toBeNull();
    expect(pickLiveStatusText({ kind: "stale", text: "stale" })).toBeNull();
    expect(pickLiveStatusText({ kind: "needs_approval", pendingCardIds: ["c1"] })).toBeNull();
  });
});

describe("asStatusData", () => {
  it("returns the data for a data-status part", () => {
    const payload: OttoStatusData = { kind: "planning", text: "planning…" };
    expect(asStatusData({ type: "data-status", data: payload })).toEqual(payload);
  });

  it("returns null for non-data-status parts", () => {
    expect(asStatusData({ type: "data-error", data: { kind: "error", text: "oops" } })).toBeNull();
    expect(asStatusData({ type: "text" })).toBeNull();
  });
});

describe("asErrorData", () => {
  it("returns the data for a data-error part", () => {
    const payload = { kind: "error" as const, text: "oops" };
    expect(asErrorData({ type: "data-error", data: payload })).toEqual(payload);
  });

  it("returns the data for insufficient_credits", () => {
    const payload = { kind: "insufficient_credits" as const, text: "Top up your credits" };
    expect(asErrorData({ type: "data-error", data: payload })).toEqual(payload);
  });

  it("returns null for non-data-error parts", () => {
    expect(asErrorData({ type: "data-status", data: { kind: "planning", text: "…" } })).toBeNull();
  });
});

describe("dataErrorOf", () => {
  // Loosely-typed message parts (a UIMessage's parts carry `text` on text parts, `data`
  // on data-* parts) — mirrors what the OttoChatStream renderer passes.
  type Part = { type: string; text?: string; data?: unknown };

  it("returns the error payload carried by a message's parts (the durable data-error part)", () => {
    const parts: Part[] = [
      { type: "step-start" },
      { type: "text", text: "" },
      { type: "data-error", data: { kind: "error", text: "Otto hit a snag - please try again. Reference: OTTO-ABCD1234" } },
    ];
    expect(dataErrorOf(parts)).toEqual({ kind: "error", text: "Otto hit a snag - please try again. Reference: OTTO-ABCD1234" });
  });

  it("surfaces insufficient_credits from message parts", () => {
    const parts: Part[] = [{ type: "data-error", data: { kind: "insufficient_credits", text: "You're out of credits." } }];
    expect(dataErrorOf(parts)).toEqual({ kind: "insufficient_credits", text: "You're out of credits." });
  });

  it("returns null when no part is a data-error (text-only assistant message)", () => {
    const parts: Part[] = [{ type: "text", text: "hi" }, { type: "data-status", data: { kind: "done", threadId: "t" } }];
    expect(dataErrorOf(parts)).toBeNull();
  });

  it("returns null for an empty parts array", () => {
    expect(dataErrorOf([])).toBeNull();
  });

  it("returns the first data-error when a turn streamed partial text before failing", () => {
    const parts: Part[] = [
      { type: "text", text: "Here's a start" },
      { type: "data-error", data: { kind: "error", text: "Otto hit a snag" } },
    ];
    expect(dataErrorOf(parts)).toEqual({ kind: "error", text: "Otto hit a snag" });
  });
});

describe("asStepData", () => {
  it("narrows data-step parts and ignores other data parts", () => {
    expect(asStepData({ type: "data-step", data: { id: "a", label: "A", phase: "start" } })).toEqual({
      id: "a",
      label: "A",
      phase: "start",
    });
    expect(asStepData({ type: "data-status", data: {} })).toBeNull();
    expect(asStepData({ type: "data-error", data: {} })).toBeNull();
  });
});

describe("deriveTraceSteps", () => {
  it("keeps first-seen order; a step stays active until its done event arrives", () => {
    const steps = deriveTraceSteps([startStep("a", "A"), doneStep("a", "A"), startStep("b", "B")], null);
    expect(steps).toEqual([
      { label: "A", status: "done" },
      { label: "B", status: "active" },
    ]);
  });

  it("marks every step done once the run reports done", () => {
    const steps = deriveTraceSteps([startStep("a", "A"), startStep("b", "B")], { kind: "done", threadId: "t" });
    expect(steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("dedupes by id and never invents pending steps", () => {
    const steps = deriveTraceSteps([startStep("a", "A"), startStep("a", "A"), doneStep("a", "A")], null);
    expect(steps).toEqual([{ label: "A", status: "done" }]);
  });

  it("empty events → empty list", () => {
    expect(deriveTraceSteps([], null)).toEqual([]);
  });

  // #591: the merchant typed "make it", the run PARKED on approval, and the trace kept
  // showing an active step with a rolling progress bar — while the same screen said
  // nothing had started. An unfinished step under needs_approval is waiting, not running.
  it("a run parked on approval leaves nothing running — unfinished steps go to waiting", () => {
    const steps = deriveTraceSteps(
      [startStep("a", "Planning the campaign"), doneStep("a", "Planning the campaign"), startStep("b", "Making a visual")],
      { kind: "needs_approval", pendingCardIds: ["card_1"] },
    );
    expect(steps).toEqual([
      { label: "Planning the campaign", status: "done" },
      { label: "Making a visual", status: "waiting" },
    ]);
    expect(steps.some((s) => s.status === "active")).toBe(false);
  });

  it("a completed run is still done, not waiting", () => {
    const steps = deriveTraceSteps([startStep("a", "A")], { kind: "done", threadId: "t" });
    expect(steps.map((s) => s.status)).toEqual(["done"]);
  });

  // #580 复审 r1 P1-3: a turn that ended abnormally used to leave its last step "active"
  // forever, so the spinner spun on a run that would never move again.
  it.each([
    ["degraded", { kind: "degraded", text: "…" } as OttoStatusData, null],
    ["stale", { kind: "stale", text: "…" } as OttoStatusData, null],
    ["data-error", null, { kind: "error" as const, text: "…" }],
    ["insufficient credits", null, { kind: "insufficient_credits" as const, text: "…" }],
  ])("a run that ended on %s stops its unfinished steps instead of spinning", (_name, status, error) => {
    const steps = deriveTraceSteps(
      [startStep("a", "A"), doneStep("a", "A"), startStep("b", "B")],
      status,
      error,
    );
    expect(steps).toEqual([
      { label: "A", status: "done" },
      { label: "B", status: "stopped" },
    ]);
  });

  it("a stream error is the turn's verdict — it outranks whatever status arrived first", () => {
    const steps = deriveTraceSteps([startStep("a", "A")], { kind: "planning", text: "…" }, { kind: "error", text: "…" });
    expect(steps.map((s) => s.status)).toEqual(["stopped"]);
  });
});

// ---------------------------------------------------------------------------
// #580 复审 r1 P1-3 —— 显式状态代数
// ---------------------------------------------------------------------------

describe("run-state algebra", () => {
  const ALL: OttoRunState[] = [
    "queued",
    "running",
    "waiting",
    "done",
    "failed",
    "stale",
    "degraded",
    "data-error",
  ];

  it("terminal states are exactly the five that can never move again", () => {
    expect([...TERMINAL_RUN_STATES].sort()).toEqual(["data-error", "degraded", "done", "failed", "stale"]);
    for (const state of ALL) {
      expect(isTerminalRunState(state)).toBe(TERMINAL_RUN_STATES.has(state));
    }
  });

  it("only a genuinely running turn may animate", () => {
    for (const state of ALL) expect(runStateSpins(state)).toBe(state === "running");
  });

  it("every stream signal maps to exactly one state", () => {
    expect(runStateOfStream({ kind: "planning", text: "…" }, null)).toBe("running");
    expect(runStateOfStream({ kind: "needs_approval", pendingCardIds: [] }, null)).toBe("waiting");
    expect(runStateOfStream({ kind: "degraded", text: "…" }, null)).toBe("degraded");
    expect(runStateOfStream({ kind: "stale", text: "…" }, null)).toBe("stale");
    expect(runStateOfStream({ kind: "done", threadId: "t" }, null)).toBe("done");
    expect(runStateOfStream(null, { kind: "error", text: "…" })).toBe("data-error");
    // An error is the turn's verdict even when a live status arrived before it.
    expect(runStateOfStream({ kind: "planning", text: "…" }, { kind: "error", text: "…" })).toBe("data-error");
    expect(runStateOfStream(null, null)).toBeNull();
  });

  it("a card with a job id is QUEUED, not running — the client cannot prove it started", () => {
    expect(runStateOfCard("working")).toBe("queued");
    expect(runStateSpins(runStateOfCard("working"))).toBe(false);
    expect(runStateOfCard("idle")).toBe("waiting");
    expect(runStateOfCard("done")).toBe("done");
    expect(runStateOfCard("failed")).toBe("failed");
  });
});

describe("shouldShowTracePanel", () => {
  const parked = [
    { label: "A", status: "done" as const },
    { label: "B", status: "waiting" as const },
  ];

  it("keeps a parked panel while this thread still has a card awaiting approval", () => {
    expect(shouldShowTracePanel({ steps: parked, pendingCardIds: new Set(["card_1"]) })).toBe(true);
  });

  it("retires a parked panel once nothing is awaiting approval", () => {
    expect(shouldShowTracePanel({ steps: parked, pendingCardIds: new Set() })).toBe(false);
  });

  it("never retires a running panel, whatever the pending set says", () => {
    const running = [{ label: "B", status: "active" as const }];
    expect(shouldShowTracePanel({ steps: running, pendingCardIds: new Set() })).toBe(true);
  });

  it("no steps, no panel", () => {
    expect(shouldShowTracePanel({ steps: [], pendingCardIds: new Set(["card_1"]) })).toBe(false);
  });
});
