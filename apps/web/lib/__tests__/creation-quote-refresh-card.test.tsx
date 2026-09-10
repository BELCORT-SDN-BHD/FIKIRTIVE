// @vitest-environment jsdom
/**
 * creation-quote-refresh-card —— 报价版本对不上被服务器拒绝之后，**商家眼前那张卡换成新价**。
 *
 * 规格 `docs/specs/creation-engine.md` §5 :170（FSE-012，Founder 2026-09-10 裁 #1307：走服务器
 * 校验报价版本，旧报价提交即拒绝**并刷新**；**不锁控件**）。追溯落在那条变更登记行上，不认领
 * 任何 CREATE- 编号（理由与本片其余测试同一把尺子，见 PR 描述）。
 *
 * 判官第 3 轮 P2-e —— 这道闸有两半：「拒绝」那一半有真账本证据（`creation-quote-version-ledger`），
 * 「刷新」那一半（商家眼前那张卡当场换成新价）此前**零自动化覆盖**。一道只拒不刷的闸，
 * 对商家就是一颗按下去只会报错、数字永远不变的按钮。
 *
 * 这一份钉三件事，两条批准路各钉一遍：
 *   ① 服务端交回来的那张新卡**当场上卡面**（走的是改三格那条同一条路 `onOptionsChanged`）；
 *   ② 那句拒绝也在卡上（商家知道刚才那一下为什么没成）；
 *   ③ **控件不锁**：Generate 仍然点得动，商家看着新价再决定（2026-09-06 A4 那一轮的决定不推翻）。
 *
 * 纯前端：这里不预扣、不结算、不调 provider，两个 Server Action 都是替身。
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTE_VERSION_STALE } from "@fikirtive/core/quote-version";
import type { OttoPlanCardPayload } from "@/components/otto/plan-card-contract";
import type { TurnReferenceDraft } from "@/lib/turn-reference-draft";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
const ottoApproveMock = vi.fn();
const coworkGenerateMock = vi.fn();
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: (...args: unknown[]) => ottoApproveMock(...args),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: (...args: unknown[]) => coworkGenerateMock(...args),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");

const PROMPT = "A pandan kaya jar on a marble counter, soft window light, 50mm";

/** 商家眼前那一版：1 张、1 credit。 */
function oneImage(over: Partial<OttoPlanCardPayload> = {}): OttoPlanCardPayload {
  return {
    kind: "image",
    model: "seedream",
    params: { aspectRatio: "1:1", count: 1 },
    reason: "image",
    specChips: ["2048 × 2048", "1:1", "1 image"],
    downgraded: false,
    structuredPrompt: PROMPT,
    entityIds: [],
    variantSel: {},
    estimatedPriceUsd: 0.04,
    estimatedCredits: 1,
    options: { maxCount: 4, aspectRatios: ["1:1", "4:3", "3:4"], fineDetailAvailable: true },
    ...over,
  };
}

/**
 * 服务端拒绝时交回来的那一份 —— 与真服务端同形：走过 `genCardPayloadDTO` 那条剥离，
 * 所以**没有** `model`／`reason`（供应商保密），`params` 只剩白名单那几格。
 */
const REFRESHED_QUOTE = {
  kind: "image",
  params: { aspectRatio: "1:1", count: 2 },
  specChips: ["2048 × 2048", "1:1", "2 images"],
  downgraded: false,
  structuredPrompt: PROMPT,
  entityIds: [],
  variantSel: {},
  estimatedPriceUsd: 0.08,
  estimatedCredits: 2,
  options: { maxCount: 4, aspectRatios: ["1:1", "4:3", "3:4"], fineDetailAvailable: true },
};

const roots: Array<[ReturnType<typeof createRoot>, HTMLElement]> = [];
afterEach(() => {
  for (const [root, host] of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});
beforeEach(() => {
  ottoApproveMock.mockReset();
  coworkGenerateMock.mockReset();
});

/** 生产里那个父组件的最小替身：重铸后的整张卡由它持有，顺着 `onOptionsChanged` 流回卡面。 */
function CardHost({ initial, pendingApproval }: { initial: OttoPlanCardPayload; pendingApproval: boolean }) {
  const [payload, setPayload] = useState<unknown>(initial);
  return createElement(OttoPlanCard, {
    cardId: "card_1",
    payload,
    entities: [],
    threadId: "thread_1",
    projectId: "proj_1",
    genJobId: null,
    cardState: "idle" as const,
    pendingApproval,
    onApproved: vi.fn(),
    onChangeSomething: (_draft: TurnReferenceDraft) => {},
    onOptionsChanged: (_cardId: string, next: unknown) => setPayload(next),
  });
}

function mount(payload: OttoPlanCardPayload, pendingApproval: boolean): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  act(() => { root.render(createElement(CardHost, { initial: payload, pendingApproval })); });
  return host;
}

function generateButton(host: HTMLElement): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("Generate ·"));
  if (!found) throw new Error(`no Generate button; buttons = ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("creation §5 :170 FSE-012 拒绝之后的另一半:卡面换成新价", () => {
  it("creation §5 :170 FSE-012 提议卡(coworkGenerate)被拒:卡面当场换成新价,拒绝那句在卡上,Generate 仍点得动", async () => {
    coworkGenerateMock.mockResolvedValue({ error: QUOTE_VERSION_STALE, quote: REFRESHED_QUOTE });
    const host = mount(oneImage(), false);
    // 按下去之前,他看的是 1 credit 那一版。
    expect(generateButton(host).textContent).toContain("1 credit");

    await click(generateButton(host));

    // ① 卡面换成了服务端交回来的那一版。
    const after = generateButton(host);
    expect(after.textContent).toContain("2 credits");
    // ② 那句拒绝也在卡上 —— 商家知道刚才那一下为什么没成。
    expect(host.textContent).toContain(QUOTE_VERSION_STALE);
    // ③ 控件不锁:他看着新价可以直接再按一次。
    expect(after.disabled).toBe(false);
  });

  it("creation §5 :170 FSE-012 停下来等批准的卡(ottoApprove)被拒:同一条刷新路,同样不锁控件", async () => {
    ottoApproveMock.mockResolvedValue({ error: QUOTE_VERSION_STALE, quote: REFRESHED_QUOTE });
    const host = mount(oneImage(), true);

    await click(generateButton(host));

    expect(ottoApproveMock).toHaveBeenCalledTimes(1);
    const after = generateButton(host);
    expect(after.textContent).toContain("2 credits");
    expect(host.textContent).toContain(QUOTE_VERSION_STALE);
    expect(after.disabled).toBe(false);
  });

  it("creation §5 :170 FSE-012 与报价无关的拒绝(余额不足这类):卡面数字不动,只多一句话", async () => {
    // 服务端没交回 `quote` ⇒ 刷新那一半不发生。卡面照旧写着他批的那一版,不许凭空改数字。
    coworkGenerateMock.mockResolvedValue({ error: "You don't have enough credits for this." });
    const host = mount(oneImage(), false);

    await click(generateButton(host));

    const after = generateButton(host);
    expect(after.textContent).toContain("1 credit");
    expect(host.textContent).toContain("You don't have enough credits for this.");
    expect(after.disabled).toBe(false);
  });
});
