// @vitest-environment jsdom
/**
 * card-topup-exit — #707:三张卡说「积分不够,去充值」,却没有一条能点的路。
 *
 * 来源:PR #706(修 #699)实施观察。#699 已经把服务端三个出口的文案收进
 * `outOfCreditsMessage()` 这一处权威并指向 Billing;卡片这一层没跟上 ——
 * ResearchCard / StoryboardCard / PackCard 里的「Not enough credits — top up …」
 * 仍是 `role="alert"` 纯文本,商家要自己找去 Billing 的路。
 *
 * 两条钉板:
 *   ① 每一处「积分不够」都必须挂着一个真的指向 /billing 的链接;
 *   ② 这句话只能来自一个地方 —— 下面按源码枚举四个卡面出口,任何一处自己手写
 *      「Not enough credits」都红。这封的是「再抄一份」,不是「换个措辞」。
 *
 * 每一处都走真实交互到达:PackCard 直接以余额 0 渲染;ResearchCard 走服务端
 * 拒绝的那一支(前端算得起、服务端说不够的竞态);StoryboardCard 两道闸各点一次。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ottoApprove: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
  coworkGenerate: vi.fn(),
  approveResearch: vi.fn(),
  getResearchCard: vi.fn(),
  prepareStoryboardFirstFrames: vi.fn(),
  prepareStoryboardVideos: vi.fn(),
  regenShotFirstFrameCard: vi.fn(),
  regenShotVideoCard: vi.fn(),
  getStoryboardVideoOptions: vi.fn(),
  syncStoryboardMedia: vi.fn(),
  editShotPrompt: vi.fn(),
  addShot: vi.fn(),
  deleteShot: vi.fn(),
  reorderShots: vi.fn(),
}));

vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: mocks.ottoApprove,
  setAdsAutonomy: mocks.setAdsAutonomy,
  setAdsWritesPaused: mocks.setAdsWritesPaused,
}));
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));
vi.mock("@/lib/research-actions", () => ({
  approveResearch: mocks.approveResearch,
  getResearchCard: mocks.getResearchCard,
}));
vi.mock("@/lib/storyboard-gate1-actions", () => ({
  prepareStoryboardFirstFrames: mocks.prepareStoryboardFirstFrames,
  prepareStoryboardVideos: mocks.prepareStoryboardVideos,
  regenShotFirstFrameCard: mocks.regenShotFirstFrameCard,
  regenShotVideoCard: mocks.regenShotVideoCard,
  getStoryboardVideoOptions: mocks.getStoryboardVideoOptions,
  syncStoryboardMedia: mocks.syncStoryboardMedia,
}));
vi.mock("@/lib/storyboard-actions", () => ({
  editShotPrompt: mocks.editShotPrompt,
  addShot: mocks.addShot,
  deleteShot: mocks.deleteShot,
  reorderShots: mocks.reorderShots,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { PackCard } = await import("@/components/otto/PackCard");
const { ResearchCard } = await import("@/components/otto/ResearchCard");
const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

const WEB_ROOT = path.resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function clickByText(dom: HTMLElement, startsWith: string): Promise<void> {
  const button = Array.from(dom.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(startsWith),
  );
  expect(button, `no button starting with "${startsWith}"`).toBeTruthy();
  return act(async () => {
    button!.click();
  });
}

/** The exit every short-balance card owes the merchant. */
function expectTopUpExit(dom: HTMLElement, where: string): void {
  const alert = dom.querySelector('[role="alert"]');
  expect(alert, `${where}: the short-balance notice is not shown at all`).toBeTruthy();
  expect(alert!.textContent, `${where}: does not say the balance is short`).toContain("Not enough credits");
  const link = alert!.querySelector<HTMLAnchorElement>('a[href="/billing"]');
  expect(link, `${where}: told the merchant to top up without giving them the way`).toBeTruthy();
  expect(link!.textContent?.trim(), `${where}: the link has no label`).not.toBe("");
}

// ---------------------------------------------------------------------------
// PackCard — batch total over balance
// ---------------------------------------------------------------------------
describe("#707 PackCard", () => {
  it("links to Billing when the pack total is over the balance", async () => {
    const card = (id: string) => ({
      cardId: id,
      payload: { kind: "image" as const, estimatedCredits: 5, params: { count: 1 } },
      threadId: "thr_1",
      genJobId: null,
      cardState: "idle" as const,
      pendingApproval: true,
    });

    const dom = await mount(
      createElement(PackCard, {
        packTitle: "Raya set",
        cards: [card("c1"), card("c2")],
        balanceUsd: 0,
        onApproved: vi.fn(),
      }),
    );

    expectTopUpExit(dom, "PackCard");
  });
});

// ---------------------------------------------------------------------------
// PackCard — the OTHER way out the sentence names (#786)
//
// #707 gave the top-up half of "top up in Billing or approve them individually" a real
// link. The second half stayed a dead pointer: the whole pack renders as ONE card with
// compact read-only rows, so there was no per-item control anywhere on it, and "Make all"
// was the disabled button right underneath. Naming an option the product does not have is
// the same defect as naming a destination with no link.
// ---------------------------------------------------------------------------
describe("#786 PackCard's second way out", () => {
  const priced = (id: string, credits: number) => ({
    cardId: id,
    payload: { kind: "image" as const, estimatedCredits: credits, params: { count: 1 } },
    threadId: "thr_1",
    genJobId: null,
    cardState: "idle" as const,
    pendingApproval: true,
  });

  it("hands over a per-item approve that really fires, for the items still within reach", async () => {
    mocks.ottoApprove.mockResolvedValue({ status: "done" });
    const onApproved = vi.fn();

    // 8 credits in the wallet: the batch of two costs 10 (out of reach), one item costs 5.
    const dom = await mount(
      createElement(PackCard, {
        packTitle: "Raya set",
        cards: [priced("c1", 5), priced("c2", 5)],
        balanceUsd: 0.8,
        onApproved,
      }),
    );

    const alert = dom.querySelector('[role="alert"]');
    expect(alert, "the short-balance notice is not shown at all").toBeTruthy();
    expect(alert!.textContent, "the notice stopped naming the second way out").toContain(
      "approve them individually",
    );

    // The named option must exist as a real control — and spend through the SAME per-card
    // server action the batch loop uses. #896: one press, with the item's price on it.
    await clickByText(dom, "Make this");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.ottoApprove, "the per-item approve fired nothing").toHaveBeenCalledWith({
      threadId: "thr_1",
      cardId: "c1",
    });
    expect(mocks.coworkGenerate, "a parked card must resume, never re-generate").not.toHaveBeenCalled();
    expect(onApproved, "the parent never learned this item started").toHaveBeenCalled();
  });

  it("spends nothing until the merchant presses it — and the press is the approval (#896)", async () => {
    mocks.ottoApprove.mockResolvedValue({ status: "done" });

    const dom = await mount(
      createElement(PackCard, {
        packTitle: "Raya set",
        cards: [priced("c1", 5), priced("c2", 5)],
        balanceUsd: 0.8,
        onApproved: vi.fn(),
      }),
    );

    // Rendering a pack full of priced rows spends nothing on its own.
    expect(mocks.ottoApprove, "rendering the pack already spent real credits").not.toHaveBeenCalled();

    // The price is on the control the merchant presses, so that press IS the approval —
    // the same guarantee the removed second click used to carry.
    const perItem = Array.from(dom.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").trim().startsWith("Make this"),
    );
    expect(perItem?.textContent, "the per-item approve must name the price it charges").toContain("5 credits");

    await clickByText(dom, "Make this");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.ottoApprove, "the merchant's press did not reach the metered action").toHaveBeenCalledWith({
      threadId: "thr_1",
      cardId: "c1",
    });
  });

  it("names no second way out when not even one item is within reach", async () => {
    const dom = await mount(
      createElement(PackCard, {
        packTitle: "Raya set",
        cards: [priced("c1", 5), priced("c2", 5)],
        balanceUsd: 0,
        onApproved: vi.fn(),
      }),
    );

    const alert = dom.querySelector('[role="alert"]');
    expect(alert!.textContent, "still has to say the balance is short").toContain("Not enough credits");
    expect(
      alert!.textContent,
      "offers an option a merchant with nothing in the wallet cannot take",
    ).not.toContain("individually");
    expect(
      Array.from(dom.querySelectorAll("button")).filter((b) =>
        (b.textContent ?? "").trim().startsWith("Make this"),
      ),
      "renders a per-item approve nobody can afford",
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ResearchCard — the server refused for want of credits
// ---------------------------------------------------------------------------
describe("#707 ResearchCard", () => {
  const payload = {
    topic: "Raya gifting trends",
    goal: "Find what sells",
    questions: [],
    tier: "quick",
    status: "planned",
    estimatedCredits: 4,
  };

  it("links to Billing on the pre-check (balance visibly short)", async () => {
    const dom = await mount(
      createElement(ResearchCard, { cardId: "card_1", payload, balanceUsd: 0 }),
    );
    expectTopUpExit(dom, "ResearchCard pre-check");
  });

  it("links to Billing when the server refuses at confirm time", async () => {
    mocks.approveResearch.mockResolvedValue({ error: "no", code: "insufficient_credits" });

    // Balance covers the estimate, so the merchant gets all the way to the approve press —
    // this is the race the alert exists for (another spend landed between render and approve).
    const dom = await mount(
      createElement(ResearchCard, { cardId: "card_1", payload, balanceUsd: 10 }),
    );
    // #896: one press, with the estimate on it — that press IS the approval.
    expect(mocks.approveResearch, "rendering the card already approved it").not.toHaveBeenCalled();
    await clickByText(dom, "Run research");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.approveResearch).toHaveBeenCalled();
    expectTopUpExit(dom, "ResearchCard server refusal");
  });
});

// ---------------------------------------------------------------------------
// ResearchCard — a card that carries NO price (#896 r2 P0-b)
//
// Same family as #707, one step earlier: #707 was a card that told the truth about money
// with nowhere to click. This is a card that could not tell the truth about money at all
// and offered the spend anyway — a missing/malformed estimate parsed as 0, `canAffordPack(0)`
// is true for any balance, so the merchant got an enabled "Run research · 0 credits" while
// the server ran the tier's real, positive budget. "Not enough credits" is also the WRONG
// exit here: topping up fixes nothing when the card has no price on it.
// ---------------------------------------------------------------------------
describe("#896 r2 ResearchCard with no guaranteed price", () => {
  const unpriced = (over: Record<string, unknown> = {}) => ({
    topic: "Raya gifting trends",
    questions: [],
    tier: "quick",
    status: "planned",
    ...over,
  });

  function runButton(dom: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(dom.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").trim().startsWith("Run research"),
    );
  }

  const UNPRICED_CASES: [string, unknown][] = [
    ["missing", unpriced()],
    ["not a number", unpriced({ estimatedCredits: "4" })],
    ["zero", unpriced({ estimatedCredits: 0 })],
    ["negative", unpriced({ estimatedCredits: -4 })],
    ["fractional", unpriced({ estimatedCredits: 4.5 })],
  ];

  it.each(UNPRICED_CASES)("estimate %s → no priced button, and nothing spendable", async (_label, payload) => {
    const dom = await mount(
      createElement(ResearchCard, { cardId: "card_1", payload, balanceUsd: 10 }),
    );

    expect(runButton(dom), "offered a priced approve for a card that has no price").toBeUndefined();

    const checking = Array.from(dom.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").trim().startsWith("Checking cost"),
    );
    expect(checking, "the approve control must say the cost isn't known yet").toBeTruthy();
    expect(checking!.disabled, "an unpriced approve must be off, not merely relabelled").toBe(true);

    // Pressing it anyway (the button is the only entrance, but the gate is in the action)
    // must still reach nothing.
    await act(async () => checking!.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.approveResearch, "an unpriced card reached the spend action").not.toHaveBeenCalled();

    // And it must NOT be dressed up as a short balance — the wallet is not the problem.
    expect(
      dom.querySelector('[role="alert"]')?.textContent ?? "",
      "sent the merchant to Billing for a problem money cannot fix",
    ).not.toContain("Not enough credits");
  });

  it("a real positive quote still renders the one priced press", async () => {
    const dom = await mount(
      createElement(ResearchCard, {
        cardId: "card_1",
        payload: unpriced({ estimatedCredits: 4 }),
        balanceUsd: 10,
      }),
    );
    const run = runButton(dom);
    expect(run?.textContent, "the priced one-press approve must survive the fix").toContain("4 credits");
    expect(run!.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StoryboardCard — both spend gates
// ---------------------------------------------------------------------------
describe("#707 StoryboardCard", () => {
  const shots = [
    { shotId: "s0", index: 0, title: "Hero", firstFramePrompt: "ff-0", videoPrompt: "v-0" },
    { shotId: "s1", index: 1, title: "Detail", firstFramePrompt: "ff-1", videoPrompt: "v-1" },
  ];

  it("gate ① (first frames) links to Billing", async () => {
    mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
    mocks.prepareStoryboardFirstFrames.mockResolvedValue({
      children: [
        { shotId: "s0", childCardId: "child_0", estimatedCredits: 4, structuredPrompt: "ff-0", entityIds: [], spent: false },
        { shotId: "s1", childCardId: "child_1", estimatedCredits: 4, structuredPrompt: "ff-1", entityIds: [], spent: false },
      ],
      totalCredits: 8,
    });

    const dom = await mount(
      createElement(StoryboardCard, {
        cardId: "sb_1",
        payload: { storyboardTitle: "New shoes ad", shots },
        balanceUsd: 0,
      }),
    );
    await clickByText(dom, "Generate all first frames");
    await act(async () => {
      await Promise.resolve();
    });

    expectTopUpExit(dom, "StoryboardCard frames gate");
  });

  it("gate ② (videos) links to Billing", async () => {
    mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        { shotId: "s0", childCardId: "vchild_0", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: false },
        { shotId: "s1", childCardId: "vchild_1", estimatedCredits: 20, structuredPrompt: "v-1", entityIds: [], spent: false },
      ],
      totalCredits: 40,
    });

    const withFrames = shots.map((s, i) => ({
      ...s,
      firstFrameCardId: `child_${i}`,
      firstFrameGenerationId: `gen_${i}`,
      durationSeconds: 5,
    }));

    const dom = await mount(
      createElement(StoryboardCard, {
        cardId: "sb_1",
        payload: { storyboardTitle: "New shoes ad", shots: withFrames },
        balanceUsd: 0,
      }),
    );
    await clickByText(dom, "Make all videos");
    await act(async () => {
      await Promise.resolve();
    });

    expectTopUpExit(dom, "StoryboardCard videos gate");
  });
});

// ---------------------------------------------------------------------------
// one sentence, one source
// ---------------------------------------------------------------------------
describe("#707 the short-balance sentence has exactly one author", () => {
  const CARDS = [
    "components/otto/ResearchCard.tsx",
    "components/otto/StoryboardCard.tsx",
    "components/otto/PackCard.tsx",
  ];

  it.each(CARDS)("%s writes no short-balance copy of its own", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    expect(
      source,
      `${relative} hand-writes the short-balance sentence again — it belongs to one shared exit`,
    ).not.toMatch(/Not enough credits/);
  });
});
