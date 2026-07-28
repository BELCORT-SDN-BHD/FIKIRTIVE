/**
 * approval-chain.test.ts — #498 round-4/round-5: the chained-approval client seam.
 *
 * A chained ottoApprove resume (status "needs_approval") persists NEW GEN_CARDs
 * server-side with no live stream. These tests lock the client chain end to end:
 *   1. the approve result parses into { pendingCardIds, fallbackReply,
 *      narrationMessageId } (chainedApprovalOf);
 *   2. the pack "Make all" loop REALLY EXECUTES (round-5: runPackApprovalLoop is
 *      the loop, not a lexical proxy for it) — one authoritative pending set fed
 *      only by server responses, channel picked at call time, re-reported cards
 *      keep their approve gate;
 *   3. the chained ids ENTER the pendingApproval set (nextPendingApprovalCardIds) —
 *      that set is what renders a card with pendingApproval=true, which routes its
 *      click through ottoApprove (RunState resume), never coworkGenerate;
 *   4. the post-approve poll merge APPENDS the chained cards AND the server-named
 *      narration TEXT so both render without a reload (mergeDurableIntoLive),
 *      while never re-injecting any other TEXT.
 *
 * Pure helpers, no React, no I/O (mirrors otto-inject-helpers.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import {
  chainedApprovalOf,
  nextPendingApprovalCardIds,
  mergeDurableIntoLive,
  runPackApprovalLoop,
} from "@/components/otto/approval-chain";
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
    createdAt: "2026-07-29T00:00:00.000Z",
    ...over,
  };
}

function thread(messages: ChatMessageDTO[]): ChatThreadDTO {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "Test thread",
    updatedAt: "2026-07-29T00:00:00.000Z",
    messages,
  };
}

describe("chainedApprovalOf", () => {
  it("parses a chained needs_approval result: ids + the server's localized receipt", () => {
    expect(
      chainedApprovalOf({
        ok: true,
        status: "needs_approval",
        pendingCardIds: ["card_b", "card_c"],
        fallbackReply: "为了守住你的积分，光靠一句话不会开始生成——请逐张确认上方卡片，我会马上开始。",
        narrationMessageId: null,
      }),
    ).toEqual({
      pendingCardIds: ["card_b", "card_c"],
      fallbackReply: "为了守住你的积分，光靠一句话不会开始生成——请逐张确认上方卡片，我会马上开始。",
      narrationMessageId: null,
    });
  });

  it("model-narrated chain carries the persisted narration's durable id (round-5 P2c)", () => {
    expect(
      chainedApprovalOf({
        ok: true,
        status: "needs_approval",
        pendingCardIds: ["card_b"],
        fallbackReply: null,
        narrationMessageId: "msg_narration",
      }),
    ).toEqual({ pendingCardIds: ["card_b"], fallbackReply: null, narrationMessageId: "msg_narration" });
  });

  it("returns null for done / stale / degraded / error / non-object results", () => {
    expect(chainedApprovalOf({ ok: true, status: "done", reply: "All set." })).toBeNull();
    expect(chainedApprovalOf({ ok: true, status: "stale" })).toBeNull();
    expect(chainedApprovalOf({ ok: true, status: "degraded" })).toBeNull();
    expect(chainedApprovalOf({ error: "Couldn't approve — please try again." })).toBeNull();
    expect(chainedApprovalOf(undefined)).toBeNull();
    expect(chainedApprovalOf("needs_approval")).toBeNull();
  });

  it("tolerates malformed fields (missing / non-array / non-string entries)", () => {
    expect(chainedApprovalOf({ status: "needs_approval" })).toEqual({
      pendingCardIds: [],
      fallbackReply: null,
      narrationMessageId: null,
    });
    expect(
      chainedApprovalOf({ status: "needs_approval", pendingCardIds: ["card_b", 7, null], fallbackReply: 3, narrationMessageId: 9 }),
    ).toEqual({ pendingCardIds: ["card_b"], fallbackReply: null, narrationMessageId: null });
  });
});

describe("nextPendingApprovalCardIds", () => {
  it("removes the approved card and ADDS the chained ids (they must render pendingApproval=true → ottoApprove channel)", () => {
    const next = nextPendingApprovalCardIds(new Set(["card_a"]), ["card_a"], ["card_b", "card_c"]);
    expect(next).toEqual(new Set(["card_b", "card_c"]));
  });

  it("without a chained outcome it only removes the approved ids", () => {
    expect(nextPendingApprovalCardIds(new Set(["card_a", "card_x"]), ["card_a"])).toEqual(new Set(["card_x"]));
  });

  it("a card the server reports as STILL pending stays pending even when it was just clicked", () => {
    const next = nextPendingApprovalCardIds(new Set(["card_a"]), ["card_a"], ["card_a"]);
    expect(next).toEqual(new Set(["card_a"]));
  });

  it("never mutates the input set", () => {
    const cur = new Set(["card_a"]);
    nextPendingApprovalCardIds(cur, ["card_a"], ["card_b"]);
    expect(cur).toEqual(new Set(["card_a"]));
  });
});

// ── runPackApprovalLoop — the pack "Make all" loop, REALLY executed ───────────
// #498 round-5 (judge): the multi-card loop's behavior is executed here, not
// pinned by source regex. Scripted server responses stand in for ottoApprove /
// coworkGenerate; everything else is the real production loop.

describe("runPackApprovalLoop (#498 round-5)", () => {
  type Scripted = Record<string, unknown[]>;
  /** fire() stub that pops scripted responses per cardId and records each call's
   *  call-time channel decision. */
  function scriptedFire(script: Scripted) {
    const calls: Array<{ cardId: string; pendingApproval: boolean }> = [];
    const fire = vi.fn(async (card: { cardId: string }, pendingApproval: boolean) => {
      calls.push({ cardId: card.cardId, pendingApproval });
      const queue = script[card.cardId] ?? [{ ok: true, status: "done", reply: "ok" }];
      return queue.length > 1 ? queue.shift() : queue[0];
    });
    return { fire, calls };
  }

  const chainedRes = (over: Partial<{ pendingCardIds: string[]; fallbackReply: string | null; narrationMessageId: string | null }>) => ({
    ok: true,
    status: "needs_approval",
    pendingCardIds: [],
    fallbackReply: null,
    narrationMessageId: null,
    ...over,
  });

  it("routes by the authoritative set AT CALL TIME: a card an EARLIER response parked is approved, never re-generated", async () => {
    // Pack of three. A is parked (pendingApproval), B and C are plain proposals.
    // Approving A parks C (mid-loop!) and mints a new card X outside the pack.
    const { fire, calls } = scriptedFire({
      card_a: [chainedRes({ pendingCardIds: ["card_c", "card_x"], fallbackReply: "sahkan kad di atas" })],
      card_b: [{ ok: true }],
      card_c: [{ ok: true, status: "done", reply: "made it" }],
    });
    const outcome = await runPackApprovalLoop({
      cards: [
        { cardId: "card_a", pendingApproval: true },
        { cardId: "card_b", pendingApproval: false },
        { cardId: "card_c", pendingApproval: false },
      ],
      fire,
    });
    // Call-time channel decisions: A approve, B generate, C approve (the mid-loop
    // park flipped it — a render-time snapshot would have re-generated C).
    expect(calls).toEqual([
      { cardId: "card_a", pendingApproval: true },
      { cardId: "card_b", pendingApproval: false },
      { cardId: "card_c", pendingApproval: true },
    ]);
    expect(outcome.firedCardIds).toEqual(["card_a", "card_b", "card_c"]);
    // C was fired by this same loop, so only X is still pending; the receipt rides.
    expect(outcome.pendingCardIds).toEqual(["card_x"]);
    expect(outcome.fallbackReply).toBe("sahkan kad di atas");
    expect(outcome.failure).toBeNull();
  });

  it("a card the server RE-REPORTS as pending keeps its approve gate: not settled-cleared, still in the outcome's pending set", async () => {
    const { fire } = scriptedFire({
      card_a: [chainedRes({ pendingCardIds: ["card_a"], fallbackReply: "confirm the card above" })],
      card_b: [{ ok: true }],
    });
    const settled: Array<[string, boolean]> = [];
    const outcome = await runPackApprovalLoop({
      cards: [
        { cardId: "card_a", pendingApproval: true },
        { cardId: "card_b", pendingApproval: false },
      ],
      fire,
      onCardSettled: (cardId, cleared) => settled.push([cardId, cleared]),
    });
    // A fired but was re-reported pending → cleared=false (no submitted mark, no ✓);
    // B fired and cleared. A stays in the authoritative pending set.
    expect(settled).toEqual([
      ["card_a", false],
      ["card_b", true],
    ]);
    expect(outcome.pendingCardIds).toEqual(["card_a"]);
    expect(outcome.firedCardIds).toEqual(["card_a", "card_b"]);
  });

  it("an error mid-loop stops the loop but keeps the already-fired cards and the authoritative pending set (F11: never strand paid cards)", async () => {
    const { fire, calls } = scriptedFire({
      card_a: [chainedRes({ pendingCardIds: ["card_x"] })],
      card_b: [{ error: "Not enough credits." }],
      card_c: [{ ok: true }],
    });
    const outcome = await runPackApprovalLoop({
      cards: [
        { cardId: "card_a", pendingApproval: true },
        { cardId: "card_b", pendingApproval: false },
        { cardId: "card_c", pendingApproval: false },
      ],
      fire,
    });
    expect(outcome.failure).toEqual({ index: 1, message: "Not enough credits." });
    expect(outcome.firedCardIds).toEqual(["card_a"]);
    expect(outcome.pendingCardIds).toEqual(["card_x"]);
    // The loop stopped: C was never fired.
    expect(calls.map((c) => c.cardId)).toEqual(["card_a", "card_b"]);
  });

  it("a thrown fire() reports failure with a null message (generic copy) and preserves the seed pending state", async () => {
    const fire = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await runPackApprovalLoop({
      cards: [{ cardId: "card_a", pendingApproval: true }],
      fire,
    });
    expect(outcome).toEqual({
      firedCardIds: [],
      pendingCardIds: ["card_a"],
      fallbackReply: null,
      narrationMessageIds: [],
      failure: { index: 0, message: null },
    });
  });

  it("collects EVERY chained narration id across the loop (round-5 P2c) and the LATEST receipt", async () => {
    const { fire } = scriptedFire({
      card_a: [chainedRes({ pendingCardIds: ["card_b"], narrationMessageId: "msg_n1" })],
      card_b: [chainedRes({ pendingCardIds: ["card_x"], fallbackReply: "confirm the card above", narrationMessageId: "msg_n2" })],
    });
    const outcome = await runPackApprovalLoop({
      cards: [
        { cardId: "card_a", pendingApproval: true },
        { cardId: "card_b", pendingApproval: false },
      ],
      fire,
    });
    expect(outcome.narrationMessageIds).toEqual(["msg_n1", "msg_n2"]);
    expect(outcome.fallbackReply).toBe("confirm the card above");
    expect(outcome.pendingCardIds).toEqual(["card_x"]);
  });

  it("reports card progress through onCardStart in loop order", async () => {
    const { fire } = scriptedFire({});
    const started: number[] = [];
    await runPackApprovalLoop({
      cards: [
        { cardId: "card_a", pendingApproval: false },
        { cardId: "card_b", pendingApproval: false },
      ],
      fire,
      onCardStart: (i) => started.push(i),
    });
    expect(started).toEqual([0, 1]);
  });
});

describe("mergeDurableIntoLive", () => {
  it("appends a chained park's NEW GEN_CARD so it renders without a reload", () => {
    const cur = threadToUiMessages(
      thread([msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: null })]),
    );
    const fresh = thread([
      msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: "job_a" }),
      msg({ id: "receipt", role: "AGENT", kind: "TEXT", text: "Sahkan pada kad di atas.", seq: 2 }),
      msg({ id: "card_b", role: "AGENT", kind: "GEN_CARD", genJobId: null, seq: 3 }),
    ]);
    const merged = mergeDurableIntoLive(cur, fresh);
    // The chained card is now in the list (it renders), deduped by durableId…
    expect(merged.filter((m) => m.metadata?.durableId === "card_b")).toHaveLength(1);
    // …the approved card's genJobId was synced from the durable thread…
    expect(merged.find((m) => m.metadata?.durableId === "card_a")?.metadata?.genJobId).toBe("job_a");
    // …and un-named TEXT is never re-injected (the streamed reply already rendered).
    expect(merged.some((m) => m.metadata?.durableId === "receipt")).toBe(false);
  });

  it("appends the server-NAMED narration TEXT live, idempotently — and ONLY that text (round-5 P2c)", () => {
    const cur = threadToUiMessages(
      thread([msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: null })]),
    );
    const fresh = thread([
      msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: "job_a" }),
      msg({ id: "msg_narration", role: "AGENT", kind: "TEXT", text: "One down — confirm the next card.", seq: 2 }),
      msg({ id: "other_text", role: "AGENT", kind: "TEXT", text: "streamed earlier", seq: 3 }),
    ]);
    const merged = mergeDurableIntoLive(cur, fresh, ["msg_narration"]);
    const narration = merged.filter((m) => m.metadata?.durableId === "msg_narration");
    expect(narration).toHaveLength(1);
    expect(narration[0].parts).toEqual([{ type: "text", text: "One down — confirm the next card." }]);
    // Un-named TEXT stays out (double-render guard for streamed replies).
    expect(merged.some((m) => m.metadata?.durableId === "other_text")).toBe(false);
    // Idempotent: a second post-approve poll with the same id adds nothing.
    expect(mergeDurableIntoLive(merged, fresh, ["msg_narration"])).toBe(merged);
  });

  it("still appends worker results (GEN_RESULT) alongside the cards, deduped", () => {
    const cur = threadToUiMessages(
      thread([msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: "job_a" })]),
    );
    const fresh = thread([
      msg({ id: "card_a", role: "AGENT", kind: "GEN_CARD", genJobId: "job_a" }),
      msg({ id: "res_a", role: "AGENT", kind: "GEN_RESULT", genJobId: "job_a", payload: { urls: ["u"] }, seq: 2 }),
    ]);
    const merged = mergeDurableIntoLive(cur, fresh);
    expect(merged.filter((m) => m.metadata?.durableId === "res_a")).toHaveLength(1);
    // Idempotent: a second poll with the same thread adds nothing.
    expect(mergeDurableIntoLive(merged, fresh)).toBe(merged);
  });
});
