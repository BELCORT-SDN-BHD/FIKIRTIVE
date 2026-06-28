/**
 * otto-inject-helpers.test.ts — unit tests for the PURE inject/dedup/poll helpers
 * that drive OttoChatStream's inline widgets (Task 5). No React, no I/O, runs in
 * the node harness (mirrors otto-ui-messages.test.ts / otto-status-helpers.test.ts).
 */
import { describe, it, expect } from "vitest";
import type { MetaActionStep } from "@/lib/meta-plan-card";
import {
  resultJobIds,
  errorJobIds,
  hasWorkingJob,
  proposeCardId,
  injectCardMessage,
  appendDurableResults,
  syncCardJobIds,
  deriveCardState,
  deriveActionState,
  deriveBuildState,
} from "@/lib/otto-inject-helpers";
import { threadToUiMessages } from "@/lib/otto-ui-messages";
import type { ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

function msg(
  over: Partial<ChatMessageDTO> & Pick<ChatMessageDTO, "id" | "role" | "kind">,
): ChatMessageDTO {
  return {
    seq: 1,
    text: "",
    payload: null,
    genJobId: null,
    createdAt: "2026-06-25T00:00:00.000Z",
    ...over,
  };
}

function thread(messages: ChatMessageDTO[]): ChatThreadDTO {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "Test thread",
    updatedAt: "2026-06-25T00:00:00.000Z",
    messages,
  };
}

describe("resultJobIds", () => {
  it("collects genJobIds that have a GEN_RESULT", () => {
    const ui = threadToUiMessages(
      thread([
        msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
        msg({ id: "r1", role: "AGENT", kind: "GEN_RESULT", genJobId: "job_1", payload: { urls: ["u"] } }),
        msg({ id: "c2", role: "AGENT", kind: "GEN_CARD", genJobId: "job_2" }),
      ]),
    );
    const ids = resultJobIds(ui);
    expect(ids.has("job_1")).toBe(true);
    expect(ids.has("job_2")).toBe(false);
  });
});

describe("errorJobIds", () => {
  it("collects genJobIds with a TURN_ERROR", () => {
    const ui = threadToUiMessages(
      thread([
        msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
        msg({ id: "e1", role: "AGENT", kind: "TURN_ERROR", genJobId: "job_1", text: "failed" }),
        msg({ id: "c2", role: "AGENT", kind: "GEN_CARD", genJobId: "job_2" }),
      ]),
    );
    const ids = errorJobIds(ui);
    expect(ids.has("job_1")).toBe(true);
    expect(ids.has("job_2")).toBe(false);
    expect(ids.size).toBe(1);
  });
});

describe("hasWorkingJob", () => {
  it("is true for a GEN_CARD with a genJobId and no terminal message", () => {
    const ui = threadToUiMessages(
      thread([msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" })]),
    );
    expect(hasWorkingJob(ui)).toBe(true);
  });

  it("is false once a GEN_RESULT lands for the job", () => {
    const ui = threadToUiMessages(
      thread([
        msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
        msg({ id: "r1", role: "AGENT", kind: "GEN_RESULT", genJobId: "job_1", payload: { urls: ["u"] } }),
      ]),
    );
    expect(hasWorkingJob(ui)).toBe(false);
  });

  it("is false once a TURN_ERROR lands for the job", () => {
    const ui = threadToUiMessages(
      thread([
        msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
        msg({ id: "e1", role: "AGENT", kind: "TURN_ERROR", genJobId: "job_1", text: "failed" }),
      ]),
    );
    expect(hasWorkingJob(ui)).toBe(false);
  });

  it("is false for a proposed (not-yet-approved) card with no genJobId", () => {
    const ui = threadToUiMessages(
      thread([msg({ id: "c1", role: "AGENT", kind: "GEN_CARD", genJobId: null })]),
    );
    expect(hasWorkingJob(ui)).toBe(false);
  });
});

describe("proposeCardId", () => {
  it("extracts cardId from a data-tool-propose part", () => {
    expect(
      proposeCardId({ type: "data-tool-propose", data: { cardId: "card_9", shownPriceDisplay: "$1" } }),
    ).toBe("card_9");
  });

  it("returns null for other part types", () => {
    expect(proposeCardId({ type: "data-status", data: { cardId: "x" } })).toBeNull();
  });

  it("returns null when cardId is missing/blank", () => {
    expect(proposeCardId({ type: "data-tool-propose", data: {} })).toBeNull();
    expect(proposeCardId({ type: "data-tool-propose", data: { cardId: "" } })).toBeNull();
    expect(proposeCardId({ type: "data-tool-propose", data: null })).toBeNull();
  });
});

describe("injectCardMessage", () => {
  it("appends the durable GEN_CARD (full payload) for the given cardId", () => {
    const existing = threadToUiMessages(
      thread([msg({ id: "u1", role: "USER", kind: "TEXT", text: "make an ad" })]),
    );
    const fresh = thread([
      msg({ id: "u1", role: "USER", kind: "TEXT", text: "make an ad" }),
      msg({
        id: "card_9",
        role: "AGENT",
        kind: "GEN_CARD",
        payload: { kind: "image", structuredPrompt: "a hat", estimatedPriceUsd: 0.5 },
      }),
    ]);
    const out = injectCardMessage(existing, fresh, "card_9");
    expect(out).toHaveLength(2);
    expect(out[1].metadata?.durableId).toBe("card_9");
    expect(out[1].metadata?.kind).toBe("GEN_CARD");
    expect(out[1].metadata?.payload).toEqual({
      kind: "image",
      structuredPrompt: "a hat",
      estimatedPriceUsd: 0.5,
    });
  });

  it("is idempotent — does not double-add a card already present (same ref)", () => {
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", payload: { kind: "image" } }),
    ]);
    const existing = threadToUiMessages(fresh);
    const out = injectCardMessage(existing, fresh, "card_9");
    expect(out).toBe(existing);
  });

  it("returns the same array when the cardId is not in the fresh thread", () => {
    const existing: ReturnType<typeof threadToUiMessages> = [];
    const fresh = thread([msg({ id: "other", role: "AGENT", kind: "GEN_CARD" })]);
    const out = injectCardMessage(existing, fresh, "card_missing");
    expect(out).toBe(existing);
  });
});

describe("syncCardJobIds", () => {
  it("patches genJobId on an in-memory GEN_CARD that has genJobId=null but durable has a real one", () => {
    const inMemory = threadToUiMessages(
      thread([msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: null })]),
    );
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_42" }),
    ]);
    const out = syncCardJobIds(inMemory, fresh);
    expect(out).not.toBe(inMemory); // new array
    expect(out[0].metadata?.genJobId).toBe("job_42");
  });

  it("is idempotent — returns the same array reference when nothing changed", () => {
    const inMemory = threadToUiMessages(
      thread([msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_42" })]),
    );
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_42" }),
    ]);
    const out = syncCardJobIds(inMemory, fresh);
    expect(out).toBe(inMemory); // same ref
  });

  it("does not touch non-GEN_CARD messages", () => {
    const inMemory = threadToUiMessages(
      thread([
        msg({ id: "u1", role: "USER", kind: "TEXT", text: "hi" }),
        msg({ id: "a1", role: "AGENT", kind: "TEXT", text: "hello" }),
      ]),
    );
    const fresh = thread([
      msg({ id: "u1", role: "USER", kind: "TEXT", text: "hi" }),
      msg({ id: "a1", role: "AGENT", kind: "TEXT", text: "hello" }),
    ]);
    const out = syncCardJobIds(inMemory, fresh);
    expect(out).toBe(inMemory); // no GEN_CARD → same ref, nothing mutated
  });

  it("after sync, hasWorkingJob is true for the patched card (was false before)", () => {
    const inMemory = threadToUiMessages(
      thread([msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: null })]),
    );
    expect(hasWorkingJob(inMemory)).toBe(false); // genJobId=null → not working yet
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_42" }),
    ]);
    const out = syncCardJobIds(inMemory, fresh);
    expect(hasWorkingJob(out)).toBe(true); // now arms the poll
  });
});

describe("appendDurableResults", () => {
  it("appends new GEN_RESULT / TURN_ERROR but never TEXT or GEN_CARD", () => {
    const existing = threadToUiMessages(
      thread([
        msg({ id: "u1", role: "USER", kind: "TEXT", text: "hi" }),
        msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
      ]),
    );
    const fresh = thread([
      msg({ id: "u1", role: "USER", kind: "TEXT", text: "hi" }),
      msg({ id: "a1", role: "AGENT", kind: "TEXT", text: "streamed reply" }), // must NOT be appended
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }), // must NOT be appended
      msg({ id: "r1", role: "AGENT", kind: "GEN_RESULT", genJobId: "job_1", payload: { urls: ["u"] } }),
    ]);
    const out = appendDurableResults(existing, fresh);
    expect(out).toHaveLength(3);
    expect(out[2].metadata?.durableId).toBe("r1");
    expect(out[2].metadata?.kind).toBe("GEN_RESULT");
  });

  it("dedupes by durableId — a result already present is not re-appended (same ref)", () => {
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
      msg({ id: "r1", role: "AGENT", kind: "GEN_RESULT", genJobId: "job_1", payload: { urls: ["u"] } }),
    ]);
    const existing = threadToUiMessages(fresh);
    const out = appendDurableResults(existing, fresh);
    expect(out).toBe(existing);
  });

  it("appends a TURN_ERROR worker failure", () => {
    const existing = threadToUiMessages(
      thread([msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" })]),
    );
    const fresh = thread([
      msg({ id: "card_9", role: "AGENT", kind: "GEN_CARD", genJobId: "job_1" }),
      msg({ id: "e1", role: "AGENT", kind: "TURN_ERROR", genJobId: "job_1", text: "couldn't finish" }),
    ]);
    const out = appendDurableResults(existing, fresh);
    expect(out).toHaveLength(2);
    expect(out[1].metadata?.kind).toBe("TURN_ERROR");
  });
});

describe("deriveCardState", () => {
  const S = (a: string[]) => new Set(a);

  it("deriveCardState: idle before approval", () => {
    expect(deriveCardState({ genJobId: null, submitted: false, results: S([]), errors: S([]) })).toBe(
      "idle",
    );
  });

  it("deriveCardState: working after approve even before genJobId lands", () => {
    expect(deriveCardState({ genJobId: null, submitted: true, results: S([]), errors: S([]) })).toBe(
      "working",
    );
  });

  it("deriveCardState: working while job runs", () => {
    expect(deriveCardState({ genJobId: "j1", submitted: true, results: S([]), errors: S([]) })).toBe(
      "working",
    );
  });

  it("deriveCardState: done when result landed", () => {
    expect(deriveCardState({ genJobId: "j1", submitted: false, results: S(["j1"]), errors: S([]) })).toBe(
      "done",
    );
  });

  it("deriveCardState: failed when TURN_ERROR landed (beats working)", () => {
    expect(deriveCardState({ genJobId: "j1", submitted: true, results: S([]), errors: S(["j1"]) })).toBe(
      "failed",
    );
  });
});

describe("deriveActionState", () => {
  const steps: MetaActionStep[] = [
    { index: 0, op: "pause", targetId: "t1", targetName: "Ad 1", currentValue: {}, targetValue: {}, moneyClass: "safe" },
    { index: 1, op: "resume", targetId: "t2", targetName: "Ad 2", currentValue: {}, targetValue: {}, moneyClass: "safe" },
  ];

  it("pending when no executions", () => {
    expect(deriveActionState(steps, [])).toBe("pending");
  });

  it("executing when at least one step is APPLYING", () => {
    expect(deriveActionState(steps, [{ stepIndex: 0, status: "APPLYING" }])).toBe("executing");
  });

  it("executing when some PENDING and some APPLYING", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLYING" },
      { stepIndex: 1, status: "PENDING" },
    ])).toBe("executing");
  });

  it("done when all steps are APPLIED", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "APPLIED" },
    ])).toBe("done");
  });

  it("done when all steps are APPLIED or SKIPPED", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "SKIPPED" },
    ])).toBe("done");
  });

  it("partial when some APPLIED and some FAILED", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "FAILED" },
    ])).toBe("partial");
  });

  it("partial when some APPLIED and some DIVERGED", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "DIVERGED" },
    ])).toBe("partial");
  });

  it("partial when some APPLIED and some NEEDS_CONFIRM", () => {
    expect(deriveActionState(steps, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "NEEDS_CONFIRM" },
    ])).toBe("partial");
  });

  it("failed when first step failed and none applied", () => {
    expect(deriveActionState(steps, [{ stepIndex: 0, status: "FAILED" }])).toBe("failed");
  });

  it("failed when DIVERGED and none applied", () => {
    expect(deriveActionState(steps, [{ stepIndex: 0, status: "DIVERGED" }])).toBe("failed");
  });
});

describe("deriveBuildState", () => {
  it("pending when no executions", () => {
    expect(deriveBuildState(null, [])).toBe("pending");
  });

  it("pending when executions exist but no buildOutcome", () => {
    // Even with executions, if buildOutcome is absent it's still pending-ish
    // but we check executions first — if some are APPLYING it's "building"
    expect(deriveBuildState(null, [])).toBe("pending");
  });

  it("building when at least one execution is APPLYING", () => {
    expect(deriveBuildState(null, [{ stepIndex: 0, status: "APPLYING" }])).toBe("building");
  });

  it("building when some PENDING and some APPLYING", () => {
    expect(deriveBuildState(null, [
      { stepIndex: 0, status: "APPLYING" },
      { stepIndex: 1, status: "PENDING" },
    ])).toBe("building");
  });

  it("built when all executions APPLIED and buildOutcome.state is done", () => {
    expect(deriveBuildState(
      { state: "done" },
      [
        { stepIndex: 0, status: "APPLIED" },
        { stepIndex: 1, status: "APPLIED" },
      ],
    )).toBe("built");
  });

  it("partial when some APPLIED and some FAILED", () => {
    expect(deriveBuildState(null, [
      { stepIndex: 0, status: "APPLIED" },
      { stepIndex: 1, status: "FAILED" },
    ])).toBe("partial");
  });

  it("failed when nothing applied and at least one terminal failure", () => {
    expect(deriveBuildState(null, [{ stepIndex: 0, status: "FAILED" }])).toBe("failed");
  });

  it("failed when DIVERGED and none applied", () => {
    expect(deriveBuildState(null, [{ stepIndex: 0, status: "DIVERGED" }])).toBe("failed");
  });
});
