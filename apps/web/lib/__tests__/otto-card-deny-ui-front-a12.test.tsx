// @vitest-environment jsdom
/**
 * FRONT-A12 — the merchant-facing half of 接线盘点 L8 (spec `docs/specs/frontend-baseline.md`).
 *
 * Two things FRONT-A12 forbids are checked here by driving the REAL click path (jsdom +
 * react-dom/client + act), not by reading static markup:
 *
 *  ① Deny must leave the browser. Before this change both Meta cards' Deny only ran
 *    `setDenied(true)` — a refusal that existed only until the tab reloaded. The assertions are
 *    therefore "ottoReject was called with this thread and this card", plus "a card that comes
 *    back from the server carrying `declinedAt` renders declined and offers no Approve".
 *  ② A button with nowhere to go must not exist. "Looks great" hid its own row and told nobody;
 *    it is gone. "Tweak it" stays — it really does move the cursor into the composer.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the vi.mock factory — a plain `const` above would be read before initialization.
const h = vi.hoisted(() => ({
  ottoReject: vi.fn(),
  approveMetaActionPlan: vi.fn(),
  approveAdBuild: vi.fn(),
}));
const { ottoReject, approveMetaActionPlan, approveAdBuild } = h;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoReject: h.ottoReject,
  approveMetaActionPlan: h.approveMetaActionPlan,
  approveAdBuild: h.approveAdBuild,
  launchAdDraft: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));

import { OttoActionPlanCard } from "@/components/otto/OttoActionPlanCard";
import { OttoAdBuildCard } from "@/components/otto/OttoAdBuildCard";
import { OttoResult } from "@/components/otto/OttoResult";
import { ACTION_PLAN_DECLINE_TEXT, AD_BUILD_DECLINE_TEXT, settlementTextFor } from "@/lib/meta-card-decline-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THREAD_ID = "thr_front_a12";
const CARD_ID = "msg_front_a12";

const planPayload = {
  planTitle: "Raise the Hari Raya adset budget",
  steps: [
    {
      index: 0,
      op: "budget_up",
      targetId: "adset_1",
      targetName: "Hari Raya gifting",
      currentValue: { status: "ACTIVE", dailyBudgetMinor: 3000, currency: "MYR" },
      targetValue: { dailyBudgetMinor: 5000 },
      moneyClass: "spend",
    },
  ],
  totalSpendImpactDisplay: "MYR 20.00/day",
  autoEligible: false,
  approval: { paramHash: "a".repeat(64), boundActor: "org", expiresAt: "2999-01-01T00:00:00.000Z" },
};

const buildPayload = {
  goal: "Launch a Hari Raya traffic ad",
  reasoning: "Your gifting page converts best before the holiday.",
  mode: "create",
  objective: "OUTCOME_TRAFFIC",
  accountId: "act_1",
  currency: "MYR",
  pageId: "page_1",
  targeting: { geo_locations: { countries: ["MY"] } },
  dailyBudgetMinor: 3000,
  creative: {
    assetId: "ast_1",
    kind: "image",
    message: "Gift jasmine this Raya",
    cta: "SHOP_NOW",
    link: "https://example.test/raya",
  },
  approval: { paramHash: "b".repeat(64), boundActor: "org", expiresAt: "2999-01-01T00:00:00.000Z" },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ottoReject.mockReset();
  ottoReject.mockResolvedValue({ ok: true, status: "done", reply: ACTION_PLAN_DECLINE_TEXT });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  ) as HTMLButtonElement | undefined;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("FRONT-A12 — Deny on Otto's Meta cards reaches the server", () => {
  it("FRONT-A12 the action plan card's Deny calls ottoReject with the thread and the card, then shows the declined line with no Approve left", async () => {
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: planPayload }),
      );
    });

    const deny = buttonNamed("Deny");
    expect(deny).toBeDefined();
    await click(deny!);

    expect(ottoReject).toHaveBeenCalledWith({ threadId: THREAD_ID, cardId: CARD_ID });
    // The plan is never approved locally: approveMetaActionPlan is the money gate and Deny must
    // not touch it.
    expect(approveMetaActionPlan).not.toHaveBeenCalled();
    expect(container.textContent).toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
    expect(buttonNamed("Deny")).toBeUndefined();
  });

  it("FRONT-A12 the ad build card's Deny calls ottoReject with the thread and the card", async () => {
    ottoReject.mockResolvedValue({ ok: true, status: "done", reply: AD_BUILD_DECLINE_TEXT });
    await act(async () => {
      root.render(
        createElement(OttoAdBuildCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: buildPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(ottoReject).toHaveBeenCalledWith({ threadId: THREAD_ID, cardId: CARD_ID });
    expect(approveAdBuild).not.toHaveBeenCalled();
    expect(container.textContent).toContain(AD_BUILD_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
  });

  it("FRONT-A12 a server refusal is shown, not swallowed — the card stays pending so the merchant can retry", async () => {
    ottoReject.mockResolvedValue({ error: "Couldn't decline that — please try again." });
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: planPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(container.textContent).toContain("Couldn't decline that");
    expect(container.textContent).not.toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Deny")).toBeDefined();
  });

  it("FRONT-A12 a card that comes back from the server already declined renders declined — the refusal survives the refresh", async () => {
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, {
          cardId: CARD_ID,
          threadId: THREAD_ID,
          payload: { ...planPayload, declinedAt: "2026-09-05T00:00:00.000Z" },
        }),
      );
    });
    expect(container.textContent).toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
    expect(buttonNamed("Deny")).toBeUndefined();

    await act(async () => {
      root.render(
        createElement(OttoAdBuildCard, {
          cardId: CARD_ID,
          threadId: THREAD_ID,
          payload: { ...buildPayload, declinedAt: "2026-09-05T00:00:00.000Z" },
        }),
      );
    });
    expect(container.textContent).toContain(AD_BUILD_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
    expect(buttonNamed("Deny")).toBeUndefined();
  });
});

describe("FRONT-A12 — a card that was already settled says WHICH settlement", () => {
  // Deny used to render the decline sentence for every non-error answer, so a plan someone else
  // had approved, and an ask that had run out of time, both read "Plan declined — nothing was
  // changed" (#1202 judge P2-1). Each of those is a different fact about the merchant's money.
  it("FRONT-A12 Deny on an already approved plan says it was approved, not that it was declined", async () => {
    ottoReject.mockResolvedValue({ ok: true, alreadyResolved: true, resolution: "approved" });
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: planPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(container.textContent).toContain(settlementTextFor("ACTION_CARD", "approved"));
    expect(container.textContent).not.toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
    expect(buttonNamed("Deny")).toBeUndefined();
  });

  it("FRONT-A12 Deny on an expired plan says it expired, not that it was declined", async () => {
    ottoReject.mockResolvedValue({ ok: true, alreadyResolved: true, resolution: "expired" });
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: planPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(container.textContent).toContain(settlementTextFor("ACTION_CARD", "expired"));
    expect(container.textContent).not.toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
  });

  it("FRONT-A12 Deny on an already approved build says it was approved, in the build's own words", async () => {
    ottoReject.mockResolvedValue({ ok: true, alreadyResolved: true, resolution: "approved" });
    await act(async () => {
      root.render(
        createElement(OttoAdBuildCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: buildPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(container.textContent).toContain(settlementTextFor("BUILD_CARD", "approved"));
    expect(container.textContent).not.toContain(AD_BUILD_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
  });

  it("FRONT-A12 Deny on an expired build says it expired, in the build's own words", async () => {
    ottoReject.mockResolvedValue({ ok: true, alreadyResolved: true, resolution: "expired" });
    await act(async () => {
      root.render(
        createElement(OttoAdBuildCard, { cardId: CARD_ID, threadId: THREAD_ID, payload: buildPayload }),
      );
    });

    await click(buttonNamed("Deny")!);

    expect(container.textContent).toContain(settlementTextFor("BUILD_CARD", "expired"));
    expect(container.textContent).not.toContain(AD_BUILD_DECLINE_TEXT);
  });

  it("FRONT-A12 a card that comes back carrying expiredAt renders expired and offers no Approve — the terminal state survives the refresh", async () => {
    await act(async () => {
      root.render(
        createElement(OttoActionPlanCard, {
          cardId: CARD_ID,
          threadId: THREAD_ID,
          payload: { ...planPayload, expiredAt: "2026-09-05T00:00:00.000Z" },
        }),
      );
    });
    expect(container.textContent).toContain(settlementTextFor("ACTION_CARD", "expired"));
    expect(container.textContent).not.toContain(ACTION_PLAN_DECLINE_TEXT);
    expect(buttonNamed("Approve")).toBeUndefined();
    expect(buttonNamed("Deny")).toBeUndefined();

    await act(async () => {
      root.render(
        createElement(OttoAdBuildCard, {
          cardId: CARD_ID,
          threadId: THREAD_ID,
          payload: { ...buildPayload, expiredAt: "2026-09-05T00:00:00.000Z" },
        }),
      );
    });
    expect(container.textContent).toContain(settlementTextFor("BUILD_CARD", "expired"));
    expect(buttonNamed("Approve")).toBeUndefined();
  });
});

describe("FRONT-A12 — the result nudge only offers what it can deliver", () => {
  it("FRONT-A12 'Looks great' is gone and 'Tweak it' still hands control to the composer", async () => {
    const onTweak = vi.fn();
    await act(async () => {
      root.render(
        createElement(OttoResult, {
          payload: { urls: ["https://example.test/a.png"], generationIds: ["gen_1"], prompt: "jasmine" },
          onTweak,
        }),
      );
    });

    expect(container.textContent).not.toContain("Looks great");
    const tweak = buttonNamed("Tweak it");
    expect(tweak).toBeDefined();

    await click(tweak!);
    expect(onTweak).toHaveBeenCalledTimes(1);
  });
});
