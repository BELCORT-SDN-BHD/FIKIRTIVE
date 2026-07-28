/**
 * approval-chain.test.ts — #498 round-4: the chained-approval client seam.
 *
 * A chained ottoApprove resume (status "needs_approval") persists NEW GEN_CARDs
 * server-side with no live stream. These tests lock the client chain end to end:
 *   1. the approve result parses into { pendingCardIds, fallbackReply } (chainedApprovalOf);
 *   2. the chained ids ENTER the pendingApproval set (nextPendingApprovalCardIds) —
 *      that set is what renders a card with pendingApproval=true, which routes its
 *      click through ottoApprove (RunState resume), never coworkGenerate;
 *   3. the post-approve poll merge APPENDS the chained cards so they render without
 *      a reload (mergeDurableIntoLive), while never re-injecting TEXT;
 *   4. the components actually wire this seam (lexical guards, same technique as
 *      otto-card-seams.test.ts — the wiring lives in click handlers that a node
 *      harness cannot execute).
 *
 * Pure helpers, no React, no I/O (mirrors otto-inject-helpers.test.ts).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  chainedApprovalOf,
  nextPendingApprovalCardIds,
  mergeDurableIntoLive,
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
      }),
    ).toEqual({
      pendingCardIds: ["card_b", "card_c"],
      fallbackReply: "为了守住你的积分，光靠一句话不会开始生成——请逐张确认上方卡片，我会马上开始。",
    });
  });

  it("model-narrated chain (fallbackReply null) keeps the ids and a null receipt", () => {
    expect(
      chainedApprovalOf({ ok: true, status: "needs_approval", pendingCardIds: ["card_b"], fallbackReply: null }),
    ).toEqual({ pendingCardIds: ["card_b"], fallbackReply: null });
  });

  it("returns null for done / stale / degraded / error / non-object results", () => {
    expect(chainedApprovalOf({ ok: true, status: "done", reply: "All set." })).toBeNull();
    expect(chainedApprovalOf({ ok: true, status: "stale" })).toBeNull();
    expect(chainedApprovalOf({ ok: true, status: "degraded" })).toBeNull();
    expect(chainedApprovalOf({ error: "Couldn't approve — please try again." })).toBeNull();
    expect(chainedApprovalOf(undefined)).toBeNull();
    expect(chainedApprovalOf("needs_approval")).toBeNull();
  });

  it("tolerates malformed pendingCardIds (missing / non-array / non-string entries)", () => {
    expect(chainedApprovalOf({ status: "needs_approval" })).toEqual({ pendingCardIds: [], fallbackReply: null });
    expect(
      chainedApprovalOf({ status: "needs_approval", pendingCardIds: ["card_b", 7, null], fallbackReply: 3 }),
    ).toEqual({ pendingCardIds: ["card_b"], fallbackReply: null });
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
    // …and TEXT is never re-injected (the streamed reply already rendered).
    expect(merged.some((m) => m.metadata?.durableId === "receipt")).toBe(false);
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

// ── Wiring guards (lexical, same technique as otto-card-seams.test.ts) ────────
// The chain lives in click handlers a node harness cannot execute; these pin the
// component wiring so the seam cannot silently disconnect again.
describe("#498 round-4 wiring — components consume the chain seam", () => {
  const COMPONENTS = path.resolve(__dirname, "../../components/otto");
  const planCard = fs.readFileSync(path.join(COMPONENTS, "OttoPlanCard.tsx"), "utf8");
  const chatStream = fs.readFileSync(path.join(COMPONENTS, "OttoChatStream.tsx"), "utf8");
  const packCard = fs.readFileSync(path.join(COMPONENTS, "PackCard.tsx"), "utf8");

  it("OttoPlanCard splits the spend channel on pendingApproval and hands the chained outcome up", () => {
    // Channel split: parked → ottoApprove (RunState resume); proposed → coworkGenerate.
    expect(planCard).toMatch(/pendingApproval\s*\n?\s*\?\s*await ottoApprove/);
    // The chained ids leave the component via onApproved (not just a local count).
    expect(planCard).toMatch(/const chained = chainedApprovalOf\(res\)/);
    expect(planCard).toMatch(/onApproved\(chained \?\? undefined\)/);
    // The immediate hint is the SERVER's localized receipt, not hardcoded English.
    expect(planCard).toMatch(/setChainedReceipt\(chained\.fallbackReply\)/);
    expect(planCard).not.toMatch(/still needs .*approval.* in this conversation/);
  });

  it("OttoChatStream feeds chained ids into the pending set in BOTH approve handlers and appends cards in the poll", () => {
    const handlerUses = chatStream.match(/nextPendingApprovalCardIds\(cur,/g) ?? [];
    expect(handlerUses.length).toBeGreaterThanOrEqual(2); // single-card + pack handlers
    // The post-approve poll merges results AND missing cards (chained cards render).
    expect(chatStream).toMatch(/setMessages\(\(cur\) => mergeDurableIntoLive\(cur, fresh\)\)/);
  });

  it("PackCard consumes the chained state and passes it through onApproved", () => {
    expect(packCard).toMatch(/chainedApprovalOf\(res\)/);
    expect(packCard).toMatch(/onApproved\(chained\)/);
  });
});
