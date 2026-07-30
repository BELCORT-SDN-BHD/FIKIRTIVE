/**
 * otto-turn-cost.test.ts — #555: a charged Otto turn must show what it cost.
 *
 * Covers the read seam (turnCostOf over the durable `data-cost` part) and the plan card's
 * disclosure copy. Display only — no test here touches the reserve/settle path.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/otto-client-actions", () => ({ ottoApprove: vi.fn() }));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));

import { turnCostOf } from "@/lib/otto-status-helpers";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { OttoPlanCard } from "@/components/otto/OttoPlanCard";

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

describe("plan card spend disclosure", () => {
  function renderCard(): string {
    return renderToStaticMarkup(createElement(OttoPlanCard, {
      cardId: "card_1",
      payload: { kind: "image", structuredPrompt: "a plate of nasi lemak", estimatedCredits: 1 },
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      cardState: "open" as never,
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
    }));
  }

  it("no longer calls a conversation turn 'a little credit'", () => {
    expect(renderCard()).not.toMatch(/a little credit/i);
  });

  it("tells the merchant chatting costs credits and where every charge is listed", () => {
    const markup = renderCard();
    expect(markup).toContain("Chatting with Otto uses credits");
    expect(markup).toContain("Billing");
    // one shared constant, so the three surfaces cannot drift apart again
    expect(CHAT_SPEND_NOTE).toBe("Chatting with Otto uses credits — every charge is listed in Billing.");
  });
});
