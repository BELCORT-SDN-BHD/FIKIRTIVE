/**
 * otto-turn-cost.test.ts — #555: a charged Otto turn must show what it cost, and the three
 * surfaces that disclose the conversation charge must all tell the same true story.
 *
 * Covers the read seam (turnCostOf over the durable `data-cost` part) and renders ALL THREE
 * copy surfaces (round-1 review P3: only one of them was actually rendered before).
 * Display only — no test here touches the reserve/settle path.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/memory-actions", () => ({
  addMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(), restoreMemory: vi.fn(), listMyMemory: vi.fn(),
}));
vi.mock("@/lib/brand-record-actions", () => ({
  saveBrandRecord: vi.fn(), deleteBrandRecord: vi.fn(), restoreBrandRecord: vi.fn(),
  listMyBrandRecords: vi.fn(),
}));
vi.mock("@/lib/product-ingest-actions", () => ({ ingestProductFromUrl: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import { turnCostOf } from "@/lib/otto-status-helpers";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { OttoPlanCard } from "@/components/otto/OttoPlanCard";
import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";
import { OttoMemory } from "@/components/otto/OttoMemory";

describe("turnCostOf", () => {
  it("reads the settled cost off the turn's durable cost part", () => {
    expect(turnCostOf([
      { type: "text", text: "here you go" } as never,
      { type: "data-cost", data: { credits: 3.3 } },
    ])).toBe(3.3);
  });

  it("reports nothing when the turn carried no cost part (free turn, or a message from before this shipped)", () => {
    expect(turnCostOf([{ type: "text" } as never])).toBeNull();
    expect(turnCostOf([])).toBeNull();
  });

  it("never claims a charge that did not happen", () => {
    expect(turnCostOf([{ type: "data-cost", data: { credits: 0 } }])).toBeNull();
    expect(turnCostOf([{ type: "data-cost", data: { credits: -1 } }])).toBeNull();
    expect(turnCostOf([{ type: "data-cost", data: { credits: Number.NaN } }])).toBeNull();
    expect(turnCostOf([{ type: "data-cost", data: {} }])).toBeNull();
  });
});

describe("the conversation-charge disclosure is one sentence in three places", () => {
  // `cardState` is a real CardState value ("idle" is the pre-approval state whose footer
  // carries this copy) — round-1 review P3 flagged the earlier `"open" as never`, which
  // typechecked while naming a state the union does not have.
  function renderPlanCard(): string {
    return renderToStaticMarkup(createElement(OttoPlanCard, {
      cardId: "card_1",
      payload: { kind: "image", structuredPrompt: "a plate of nasi lemak", estimatedCredits: 1 },
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      cardState: "idle",
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
      onOptionsChanged: vi.fn(),
    }));
  }

  function renderFrontDoor(): string {
    return renderToStaticMarkup(createElement(OttoFrontDoor, {
      projectId: "proj_1",
      userName: "Siti",
      onThreadStarted: vi.fn(),
      onStreamStart: vi.fn(),
    }));
  }

  function renderMemory(): string {
    return renderToStaticMarkup(createElement(OttoMemory, {
      initialMemory: [],
      initialRecords: [],
      projectId: "proj_1",
    }));
  }

  const surfaces: Array<[string, () => string]> = [
    ["plan card", renderPlanCard],
    ["front door", renderFrontDoor],
    ["brand memory", renderMemory],
  ];

  for (const [name, render] of surfaces) {
    it(`${name}: no longer calls a conversation turn "a little credit"`, () => {
      expect(render()).not.toMatch(/a little credit/i);
    });

    // Founder 的第二次裁决(2026-08-18)把对话放回按用量收费:成本 +5%。这三处共用的那一句
    // 因此必须再跟着钱走一次 —— 免费那半天的说法一个字都不许留下,而且新说法要把「按用量、
    // 去哪里查」讲清楚,不能又退回「a little credit」那种没凭据的软话。
    //
    // 这条纪律最后砍掉的是它自己的初稿。那一句原本还带一个量级断言「usually a fraction of
    // one per message」:1.05 下实测一次回复是 1.4 displayed credits,#536 实测区间
    // (0.21–1.73)大半在 1 credit 以上,而且它下方就渲染着 CHAT_HOLD_NOTE(holds up to 4
    // credits)—— 它跟「a little credit」是同一种没凭据的软话,只是换了个方向,所以整个量级
    // 断言删掉,不是改小。要再写量级,先拿当日价格下的实测来。
    it(`${name}: says a chat turn costs credits for what it uses, and where to check`, () => {
      const markup = render();
      expect(markup).toContain("Chatting with Otto costs credits for what it uses");
      expect(markup).toContain("Billing");
      expect(markup).not.toMatch(/Chatting with Otto is free/);
    });
  }

  it("comes from ONE constant, so the three surfaces cannot drift apart again", () => {
    expect(CHAT_SPEND_NOTE).toBe(
      "Chatting with Otto costs credits for what it uses — your charges are listed in Billing.",
    );
    for (const [, render] of surfaces) {
      expect(render()).toContain("your charges are listed in Billing");
      // 量级断言不许悄悄回来(见上面那段:删的理由是没凭据,不是嫌它长)。
      expect(render()).not.toMatch(/fraction of (one|a credit)/i);
    }
  });
});
