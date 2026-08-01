/**
 * #601 T2a — the settlement projection, exercised over its whole state space.
 *
 * This is the single place that decides what a merchant's board should contain after a paid job
 * finishes. It has no database, so every combination that used to need a live environment to
 * reproduce is an ordinary table row here: how many outputs the job produced, whether a card was
 * ever placed for it, whether the merchant deleted something, and whether the job belongs on a
 * board at all.
 */
import { describe, it, expect } from "vitest";
import {
  CANVAS_SETTLEMENT_CARD,
  planCanvasSettlement,
  type CanvasSettlementPlan,
  type PlannedCard,
  type SettlementCard,
  type SettlementJob,
} from "./canvas-settlement-plan.js";
import { canvasBatchSlotOffset } from "./canvas-layout.js";

const OUTPUTS = ["gen-1", "gen-2", "gen-3", "gen-4"];

function job(overrides: Partial<SettlementJob> = {}): SettlementJob {
  return {
    status: "DONE",
    generationIds: OUTPUTS.slice(0, 1),
    kind: "IMAGE",
    prompt: "a cup steaming",
    hasLiveThread: false,
    ...overrides,
  };
}

function card(overrides: Partial<SettlementCard> = {}): SettlementCard {
  return {
    id: "card-anchor",
    x: 100,
    y: 50,
    w: CANVAS_SETTLEMENT_CARD.w,
    h: CANVAS_SETTLEMENT_CARD.h,
    prompt: "a cup steaming",
    generationId: null,
    status: "pending",
    sourceNodeId: null,
    ...overrides,
  };
}

function place(plan: CanvasSettlementPlan): PlannedCard[] {
  if (plan.kind !== "place") throw new Error(`expected a placement plan, got skip:${plan.reason}`);
  return plan.cards;
}

function skipReason(plan: CanvasSettlementPlan): string {
  if (plan.kind !== "skip") throw new Error("expected the plan to skip");
  return plan.reason;
}

describe("how many cards a finished job should have", () => {
  // The batch sizes a merchant can actually buy: one image, or up to four variants of one press.
  for (const size of [1, 2, 3, 4]) {
    it(`projects ${size} card(s) for a ${size}-output job whose in-flight card is still waiting`, () => {
      const cards = planCanvasSettlement({
        job: job({ generationIds: OUTPUTS.slice(0, size) }),
        cards: [card()],
        occupied: [],
      });

      const planned = place(cards);
      expect(planned).toHaveLength(size);
      expect(planned.map((entry) => entry.batchIndex)).toEqual([...Array(size).keys()]);
      expect(planned[0]).toMatchObject({ action: "update", role: "anchor", id: "card-anchor" });
      expect(planned.slice(1).every((entry) => entry.action === "create" && entry.role === "sibling")).toBe(true);
    });
  }

  it("binds the in-flight card to the job's first output and calls it finished", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card()],
      occupied: [],
    }));

    expect(planned[0]).toEqual({
      action: "update",
      role: "anchor",
      batchIndex: 0,
      id: "card-anchor",
      patch: { generationId: "gen-1", status: "done" },
    });
  });

  it("leaves an already-correct board completely alone", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [
        card({ id: "a", generationId: "gen-1", status: "done" }),
        card({ id: "b", generationId: "gen-2", status: "done", x: 440, sourceNodeId: "a" }),
      ],
      occupied: [],
    }));

    expect(planned.every((entry) => entry.action === "keep")).toBe(true);
    expect(planned.map((entry) => (entry as { id: string }).id)).toEqual(["a", "b"]);
  });

  it("finishes a sibling card that was placed but never marked finished", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [
        card({ id: "a", generationId: "gen-1", status: "done" }),
        card({ id: "b", generationId: "gen-2", status: "pending", x: 440 }),
      ],
      occupied: [],
    }));

    expect(planned[1]).toEqual({
      action: "update", role: "sibling", batchIndex: 1, id: "b", patch: { status: "done" },
    });
  });
});

describe("where each card of a batch sits", () => {
  it("lays siblings out on the shared grid around the card that is already there", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS }),
      cards: [card({ x: 100, y: 50 })],
      occupied: [],
    }));

    expect(planned.slice(1).map((entry) => [(entry as { x: number }).x, (entry as { y: number }).y]))
      .toEqual([[440, 50], [100, 390], [440, 390]]);
  });

  it("uses the same offsets the browser uses — not a second copy of the arithmetic", () => {
    const anchor = card({ x: 7, y: 11, w: 200, h: 120 });
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 3) }),
      cards: [anchor],
      occupied: [],
    }));

    for (const [offset, entry] of planned.slice(1).entries()) {
      const slot = canvasBatchSlotOffset(offset + 1, { w: anchor.w, h: anchor.h });
      expect([(entry as { x: number }).x, (entry as { y: number }).y])
        .toEqual([anchor.x + slot.dx, anchor.y + slot.dy]);
      expect([(entry as { w: number }).w, (entry as { h: number }).h]).toEqual([anchor.w, anchor.h]);
    }
  });

  it("starts a never-placed batch at the top-left of an empty board", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2), hasLiveThread: true }),
      cards: [],
      occupied: [],
    }));

    expect(planned[0]).toMatchObject({ action: "create", role: "anchor", x: 80, y: 80, generationId: "gen-1" });
    expect(planned[1]).toMatchObject({ action: "create", role: "sibling", generationId: "gen-2" });
  });

  it("keeps a never-placed batch off work that is already on the board", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 1), hasLiveThread: true }),
      cards: [],
      occupied: [{ x: 80, y: 80, w: 320, h: 320 }],
    }));

    expect(planned[0]).toMatchObject({ action: "create" });
    expect([(planned[0] as { x: number }).x, (planned[0] as { y: number }).y]).not.toEqual([80, 80]);
  });

  it("hangs siblings off the batch anchor, and off the anchor's own source when it has one", () => {
    const withoutSource = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card({ id: "a" })],
      occupied: [],
    }));
    const withSource = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card({ id: "a", sourceNodeId: "made-from-this" })],
      occupied: [],
    }));

    expect(withoutSource[1]).toMatchObject({ layoutSourceNodeId: "a" });
    expect(withSource[1]).toMatchObject({ layoutSourceNodeId: "made-from-this" });
  });

  it("tells the caller to use the plan's own anchor when that anchor is brand new", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2), hasLiveThread: true }),
      cards: [],
      occupied: [],
    }));

    expect(planned[1]).toMatchObject({ action: "create", role: "sibling", layoutSourceNodeId: null });
  });
});

describe("what kind of card it is", () => {
  it.each([
    ["IMAGE", "image"],
    ["VIDEO", "video"],
  ] as const)("projects a %s job onto a %s card", (kind, expected) => {
    const planned = place(planCanvasSettlement({
      job: job({ kind, hasLiveThread: true }),
      cards: [],
      occupied: [],
    }));

    expect(planned[0]).toMatchObject({ type: expected });
  });

  it("carries the job's own words onto a card nobody placed", () => {
    const planned = place(planCanvasSettlement({
      job: job({ prompt: "a red bicycle", hasLiveThread: true }),
      cards: [],
      occupied: [],
    }));

    expect(planned[0]).toMatchObject({ prompt: "a red bicycle" });
  });

  it("keeps the words already on the card when one is there", () => {
    const planned = place(planCanvasSettlement({
      job: job({ prompt: "job wording", generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card({ prompt: "what the merchant typed" })],
      occupied: [],
    }));

    expect(planned[1]).toMatchObject({ prompt: "what the merchant typed" });
  });
});

describe("when the board must be left alone", () => {
  it.each([
    ["QUEUED"],
    ["GENERATING"],
    ["FAILED"],
    ["CANCELLED"],
    ["something-nobody-has-invented-yet"],
  ])("does nothing for a job in %s — only a delivered job projects onto cards in this slice", (status) => {
    expect(skipReason(planCanvasSettlement({
      job: job({ status, generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card()],
      occupied: [],
    }))).toBe("not-settled");
  });

  it("does nothing for a storyboard job that has no card and no chat", () => {
    expect(skipReason(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2), hasLiveThread: false }),
      cards: [],
      occupied: [],
    }))).toBe("not-a-canvas-job");
  });

  it("does nothing for a delivered job that recorded no output", () => {
    expect(skipReason(planCanvasSettlement({
      job: job({ generationIds: [], hasLiveThread: true }),
      cards: [],
      occupied: [],
    }))).toBe("nothing-to-place");
  });

  it("does not bring back a batch the merchant deleted while it was still running", () => {
    expect(skipReason(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS }),
      cards: [card({ status: "deleted", generationId: null })],
      occupied: [],
    }))).toBe("suppressed");
  });

  it("does not bring back the one card the merchant deleted from a finished batch", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 3) }),
      cards: [
        card({ id: "a", generationId: "gen-1", status: "done" }),
        card({ id: "b", generationId: "gen-2", status: "deleted", x: 440 }),
      ],
      occupied: [],
    }));

    expect(planned.map((entry) => entry.batchIndex)).toEqual([0, 2]);
    expect(planned[1]).toMatchObject({ action: "create", generationId: "gen-3" });
  });

  it("does not resurrect a deleted first output by binding it to the waiting card", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [
        card({ id: "waiting", generationId: null, status: "pending" }),
        card({ id: "gone", generationId: "gen-1", status: "deleted" }),
      ],
      occupied: [],
    }));

    // The waiting card leads with the first output the merchant still has — and says so: it is
    // the batch's SECOND card, because the first one is the one they deleted.
    expect(planned[0]).toEqual({
      action: "update", role: "anchor", batchIndex: 1, id: "waiting",
      patch: { generationId: "gen-2", status: "done" },
    });
    expect(planned).toHaveLength(1);
  });

  it("does not rebuild a batch whose every card the merchant deleted", () => {
    // The one card this job had was deleted after it was delivered. A redelivery or the reaper
    // settling the same job again must not put the merchant's deleted work back on the board.
    expect(skipReason(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 1), hasLiveThread: true }),
      cards: [card({ id: "gone", generationId: "gen-1", status: "deleted" })],
      occupied: [],
    }))).toBe("suppressed");
  });

  it("plans one entry per card even when the only card left is a later one of the batch", () => {
    // A board reachable only oddly (the batch's first card is gone without a tombstone). The
    // surviving card must be planned once, and the missing output must still get a card of its
    // own — laid out around the card that is actually there, not on top of it.
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 2) }),
      cards: [card({ id: "second", generationId: "gen-2", status: "done", x: 500, y: 200 })],
      occupied: [],
    }));

    const ids = planned.map((entry) => (entry as { id?: string }).id ?? "created");
    expect(new Set(ids).size).toBe(ids.length);
    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({ role: "anchor", id: "second", batchIndex: 1 });
    // gen-1 sits one slot to the LEFT of gen-2, which is where a two-card batch puts them.
    expect(planned[1]).toMatchObject({ action: "create", generationId: "gen-1", batchIndex: 0, x: 160, y: 200 });
  });

  it("still places the outputs that survive when an earlier one was deleted", () => {
    const planned = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 3), hasLiveThread: true }),
      cards: [card({ id: "gone", generationId: "gen-1", status: "deleted" })],
      occupied: [],
    }));

    expect(planned.map((entry) => (entry as { generationId?: string }).generationId)).toEqual(["gen-2", "gen-3"]);
    expect(planned[0]).toMatchObject({ action: "create", role: "anchor" });
  });
});

describe("running it twice", () => {
  it("asks for no change at all the second time", () => {
    const first = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 3) }),
      cards: [card({ id: "anchor" })],
      occupied: [],
    }));
    // Apply the first plan the way the caller would, then re-project the resulting board.
    const applied: SettlementCard[] = [
      card({ id: "anchor", generationId: "gen-1", status: "done" }),
      ...first.filter((entry): entry is Extract<PlannedCard, { action: "create" }> => entry.action === "create")
        .map((entry) => card({
          id: `made-${entry.batchIndex}`,
          x: entry.x,
          y: entry.y,
          generationId: entry.generationId,
          status: "done",
          sourceNodeId: "anchor",
        })),
    ];

    const second = place(planCanvasSettlement({
      job: job({ generationIds: OUTPUTS.slice(0, 3) }),
      cards: applied,
      occupied: [],
    }));

    expect(second.every((entry) => entry.action === "keep")).toBe(true);
    expect(second).toHaveLength(3);
  });
});
