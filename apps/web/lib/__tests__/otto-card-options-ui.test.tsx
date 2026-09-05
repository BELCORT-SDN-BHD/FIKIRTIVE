// @vitest-environment jsdom
/**
 * otto-card-options-ui —— 确认卡上那三格（张数／形状／精修）的**界面**证据。
 *
 * 规格 docs/specs/otto-engine.md，验收 ENGINE-A3（§5 登记 2026-09-05，Founder 裁决
 * 「加进确认卡」）。⑦段退役直出 composer 之后这三格无处可选，而这张卡是唯一的花钱入口。
 *
 * 这一份钉四件事：
 *  1. 三格真的接在生产的那个 $0 服务端动作上（改一格 = 一次调用，参数逐字是那一格）；
 *  2. 服务端重铸回来的那张卡**换掉了按钮上的价** —— 界面自己一分钱都不算；
 *  3. 精修那一格在服务端说它今天卖不动时**不出现**（Creation 规格里「没有价的 SKU
 *     ⇒ 拒绝、$0」那条验收的商家侧读法：菜单上不摆一个点了必然被拒的选项）；
 *  4. 复审 r1 P1-1：同一张卡的**两处**确认位（抽屉里那张 `OttoPlanCard` 与画布上那张
 *     `OttoTurnCard`，画布形态下抽屉只是 CSS 隐藏、不是卸载）同时挂着时，在一处改一格，
 *     另一处按钮上那个价必须跟着换 —— 两处各留一份重铸结果，就是「卡上一个数、预扣
 *     另一个数」。
 *
 * 钱路本身的证据在 `otto-card-options-ledger.test.ts`（真库、真 reserve）。
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OttoPlanCardPayload } from "@/components/otto/plan-card-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
const updateOptionsMock = vi.fn();
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: (...args: unknown[]) => updateOptionsMock(...args),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");
const { OttoTurnCard } = await import("@/components/otto/OttoTurnCard");

/** 一张服务端今天真会铸出来的图片卡（三格菜单齐全）。 */
function imageCard(over: Partial<OttoPlanCardPayload> = {}): OttoPlanCardPayload {
  return {
    kind: "image",
    model: "seedream",
    params: { aspectRatio: "1:1", count: 1 },
    reason: "image",
    specChips: ["2048 × 2048", "1:1", "1 image"],
    downgraded: false,
    structuredPrompt: "A pandan kaya jar on a marble counter",
    entityIds: [],
    variantSel: {},
    estimatedPriceUsd: 0.04,
    estimatedCredits: 1,
    options: { maxCount: 4, aspectRatios: ["1:1", "4:3", "3:4"], fineDetailAvailable: true },
    ...over,
  };
}

const roots: Array<[ReturnType<typeof createRoot>, HTMLElement]> = [];
afterEach(() => {
  for (const [root, host] of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  updateOptionsMock.mockReset();
});

/**
 * 生产里那个父组件的最小替身（`OttoChatStream`）：重铸后的整张卡由**它**持有，两处确认位
 * 都从它读。复审 r1 P1-1 的修法就是这条线 —— 组件自己不留一份重铸结果。
 */
function CardHost({
  initial,
  cardState,
  both,
}: {
  initial: OttoPlanCardPayload;
  cardState: "idle" | "working";
  both: boolean;
}) {
  const [payload, setPayload] = useState<unknown>(initial);
  const onOptionsChanged = (_cardId: string, next: unknown) => setPayload(next);
  const drawer = createElement(OttoPlanCard, {
    key: "drawer",
    cardId: "card_1",
    payload,
    entities: [],
    threadId: "thread_1",
    projectId: "proj_1",
    genJobId: cardState === "working" ? "job_1" : null,
    cardState,
    pendingApproval: true,
    onApproved: vi.fn(),
    onChangeSomething: vi.fn(),
    onOptionsChanged,
  });
  if (!both) return drawer;
  return createElement("div", null, [
    drawer,
    createElement(OttoTurnCard, {
      key: "canvas",
      status: { phase: "needs-confirmation", label: "Waiting for you", dot: "bg-brand", detail: null, busy: false } as const,
      text: "Here's what I'll make.",
      streaming: false,
      confirmCards: [{ cardId: "card_1", threadId: "thread_1", payload, pendingApproval: true }],
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
      onOptionsChanged,
    }),
  ]);
}

function mount(
  payload: OttoPlanCardPayload,
  cardState: "idle" | "working" = "idle",
  both = false,
): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  act(() => {
    root.render(createElement(CardHost, { initial: payload, cardState, both }));
  });
  return host;
}

function selectByLabel(host: HTMLElement, label: string): HTMLSelectElement | undefined {
  return [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === label);
}

async function chooseOption(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ENGINE-A3 确认卡上的三格 —— 接在生产那条 $0 路上", () => {
  it("ENGINE-A3 张数、形状、精修三格都在卡上,菜单逐字来自卡自己的 options", () => {
    const host = mount(imageCard());
    const counts = selectByLabel(host, "How many images");
    const shapes = selectByLabel(host, "Shape of the image");
    expect(counts).toBeTruthy();
    expect(shapes).toBeTruthy();
    expect([...counts!.options].map((o) => o.value)).toEqual(["1", "2", "3", "4"]);
    expect([...shapes!.options].map((o) => o.value)).toEqual(["1:1", "4:3", "3:4"]);
    expect(host.querySelector('[aria-label="Fine detail"]')).toBeTruthy();
  });

  it("ENGINE-A3 改张数 ⇒ 一次服务端调用,参数逐字是这张卡与那一格", async () => {
    updateOptionsMock.mockResolvedValue({ ok: true, payload: { ...imageCard(), params: { aspectRatio: "1:1", count: 3 }, estimatedCredits: 3 } });
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "How many images")!, "3");
    expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    expect(updateOptionsMock).toHaveBeenCalledWith({ threadId: "thread_1", cardId: "card_1", count: 3 });
  });

  it("ENGINE-A3 服务端重铸回来的卡换掉按钮上那个价 —— 界面自己一分钱都不算", async () => {
    const host = mount(imageCard());
    expect(host.textContent).toContain("Generate · 1 credit");
    updateOptionsMock.mockResolvedValue({
      ok: true,
      payload: { ...imageCard(), params: { aspectRatio: "1:1", count: 3 }, estimatedCredits: 3, specChips: ["2048 × 2048", "1:1", "3 images"] },
    });
    await chooseOption(selectByLabel(host, "How many images")!, "3");
    expect(host.textContent).toContain("Generate · 3 credits");
    expect(host.textContent).toContain("3 images");
  });

  it("ENGINE-A3 改形状 ⇒ 参数逐字是他点的那一格", async () => {
    updateOptionsMock.mockResolvedValue({ ok: true, payload: imageCard({ params: { aspectRatio: "3:4", count: 1 } }) });
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "Shape of the image")!, "3:4");
    expect(updateOptionsMock).toHaveBeenCalledWith({ threadId: "thread_1", cardId: "card_1", aspectRatio: "3:4" });
  });

  it("ENGINE-A3 服务端拒绝时,卡上原样说出那句话,而且价一格没动", async () => {
    updateOptionsMock.mockResolvedValue({ error: "Fine detail can't do 16:9 — it can do 1:1, 4:3, 3:4." });
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "How many images")!, "2");
    expect(host.textContent).toContain("Fine detail can't do 16:9");
    expect(host.textContent).toContain("Generate · 1 credit");
  });

  it("ENGINE-A3 精修那一格今天卖不动 ⇒ 卡上不出现它(不摆一个点了必然被拒的选项)", () => {
    const host = mount(imageCard({ options: { maxCount: 4, aspectRatios: ["1:1"], fineDetailAvailable: false } }));
    expect(host.querySelector('[aria-label="Fine detail"]')).toBeNull();
    // 别的两格照旧在 —— 一格卖不动不该把整块控件收掉。
    expect(selectByLabel(host, "How many images")).toBeTruthy();
  });

  it("ENGINE-A3 这条修改之前铸的老卡(没有 options)⇒ 一格控件都不渲染,与从前逐字相同", () => {
    const old = { ...imageCard() };
    delete old.options;
    const host = mount(old);
    expect(selectByLabel(host, "How many images")).toBeUndefined();
    expect(host.querySelector('[aria-label="Fine detail"]')).toBeNull();
    expect(host.textContent).toContain("Generate · 1 credit");
  });

  it("ENGINE-A3 两处确认位同挂 —— 在画布那一格改张数,抽屉那一张按钮上的价跟着换(复审 r1 P1-1)", async () => {
    // 生产里这两处是同时挂着的:画布形态下抽屉只是 CSS 隐藏(`canvasHistoryOpen ? "flex" : "hidden"`),
    // 不是卸载。重铸结果若停在各自组件里,就会一处写着新价、另一处仍按旧价出按钮 —— 而批准
    // 请求不带价(服务端从库里那张卡重建),陈旧那一侧按下去照旧按新价预扣。
    const host = mount(imageCard(), "idle", true);
    const canvas = host.querySelector('[aria-label="Otto current turn"]') as HTMLElement | null;
    expect(canvas).toBeTruthy();
    const generateLabels = () =>
      [...host.querySelectorAll("button")]
        .map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((t) => t.startsWith("Generate"));
    expect(generateLabels()).toEqual(["Generate · 1 credit", "Generate · 1 credit"]);
    updateOptionsMock.mockResolvedValue({
      ok: true,
      payload: { ...imageCard(), params: { aspectRatio: "1:1", count: 3 }, estimatedCredits: 3 },
    });
    const canvasCount = [...canvas!.querySelectorAll("select")].find(
      (s) => s.getAttribute("aria-label") === "How many images",
    );
    expect(canvasCount).toBeTruthy();
    await chooseOption(canvasCount!, "3");
    // 两颗按钮,一个数。
    expect(generateLabels()).toEqual(["Generate · 3 credits", "Generate · 3 credits"]);
  });

  it("ENGINE-A3 已经排队的卡不再出现这三格 —— 批准之后没有「再改一格」这回事", () => {
    const host = mount(imageCard(), "working");
    expect(selectByLabel(host, "How many images")).toBeUndefined();
    expect(host.querySelector('[aria-label="Fine detail"]')).toBeNull();
  });
});
