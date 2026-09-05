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
const { QUEUED_DROPPED_NOTE } = await import("@/components/otto/CardOptionControls");

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

function fineDetailSwitch(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[aria-label="Fine detail"]');
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 抽屉那张卡的规格条,逐格取（`OttoPlanCard` 里那几颗 `rounded-[7px]` 的小格）。 */
function specChipTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[class*="rounded-[7px]"]')].map((n) => (n.textContent ?? "").trim());
}

/** 一个可以按住不放的服务端答复 —— 用来站在「重铸还在飞」那半秒里。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
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
    // 没有第二格在排队时,不许平白多说一句「另一格也没送出去」。
    expect(host.textContent).not.toContain(QUEUED_DROPPED_NOTE);
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

/**
 * 终检 r4（2026-09-05 20:15，截图 r4-16-card-finedetail.png / r4-20-finedetail-attempt.png）
 * 的两条商家可见 P2。
 */
describe("ENGINE-A3 确认卡三格的界面残留 —— 终检 r4", () => {
  it("ENGINE-A3 精修打开 ⇒ 规格条多一格 Fine detail(价变了,规格条得说出贵在哪)", () => {
    const on = mount(imageCard({ fineDetail: true, estimatedCredits: 2 }));
    expect(specChipTexts(on)).toEqual(["2048 × 2048", "1:1", "1 image", "Fine detail"]);
    expect(on.textContent).toContain("Generate · 2 credits");
    // 关着的时候一格都不多 —— 这一格只跟着卡上那个 fineDetail 走。
    const off = mount(imageCard());
    expect(specChipTexts(off)).toEqual(["2048 × 2048", "1:1", "1 image"]);
  });

  it("ENGINE-A3 精修那一格补在服务端那份规格之后,老卡(没有 specChips)照旧不显示规格条", () => {
    const old = imageCard({ fineDetail: true });
    delete old.specChips;
    const host = mount(old);
    // 没有服务端那份规格就不猜一份出来（#580）—— 只剩一格「Fine detail」也不算规格条。
    expect(specChipTexts(host)).toEqual([]);
  });

  it("ENGINE-A3 画布那张卡的规格行同样多出 Fine detail —— 两处规格不说两件事", () => {
    const host = mount(imageCard({ fineDetail: true, estimatedCredits: 2 }), "idle", true);
    const canvas = host.querySelector('[aria-label="Otto current turn"]') as HTMLElement | null;
    expect(canvas).toBeTruthy();
    expect(canvas!.textContent).toContain("2048 × 2048 · 1:1 · 1 image · Fine detail");
  });

  it("ENGINE-A3 下拉改完立刻点精修 ⇒ 两次改动都落地(那一次点击不再被吞)", async () => {
    const first = deferred<unknown>();
    updateOptionsMock.mockReturnValueOnce(first.promise);
    updateOptionsMock.mockResolvedValueOnce({
      ok: true,
      payload: imageCard({
        params: { aspectRatio: "1:1", count: 3 },
        fineDetail: true,
        estimatedCredits: 6,
        specChips: ["2048 × 2048", "1:1", "3 images"],
      }),
    });
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "How many images")!, "3");
    // 第一趟重铸还在飞的时候点精修 —— 这一次点击必须真的落地。
    const toggle = fineDetailSwitch(host)!;
    await click(toggle);
    // 点下去立刻看得见（这一格自己的显示,价照旧等服务端）。
    expect(fineDetailSwitch(host)!.getAttribute("aria-checked")).toBe("true");
    expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    // 机制：重铸进行中控件**不是 disabled 的**（disabled 的 Switch 连事件都没有,那正是
    // 终检 r4 里被吞掉的那一次点击）,而是自报 aria-busy 并把这一格排进队。
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    expect(selectByLabel(host, "How many images")!.disabled).toBe(false);

    await act(async () => {
      first.resolve({
        ok: true,
        payload: imageCard({ params: { aspectRatio: "1:1", count: 3 }, estimatedCredits: 3, specChips: ["2048 × 2048", "1:1", "3 images"] }),
      });
      await first.promise;
    });

    // 排在后面那一格立刻接着发,参数逐字是他点的那一格。
    expect(updateOptionsMock).toHaveBeenCalledTimes(2);
    expect(updateOptionsMock).toHaveBeenNthCalledWith(1, { threadId: "thread_1", cardId: "card_1", count: 3 });
    expect(updateOptionsMock).toHaveBeenNthCalledWith(2, { threadId: "thread_1", cardId: "card_1", fineDetail: true });
    // 两次改动都落在卡上：价是服务端最后那张卡的价,规格条也说出了精修。
    expect(host.textContent).toContain("Generate · 6 credits");
    expect(specChipTexts(host)).toEqual(["2048 × 2048", "1:1", "3 images", "Fine detail"]);
    expect(fineDetailSwitch(host)!.getAttribute("aria-checked")).toBe("true");
    expect(fineDetailSwitch(host)!.getAttribute("aria-busy")).toBe("false");
  });

  it("ENGINE-A3 排队那一格被拒 ⇒ 说出服务端那句话,而且不替他再发一次", async () => {
    const first = deferred<unknown>();
    updateOptionsMock.mockReturnValueOnce(first.promise);
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "How many images")!, "3");
    await click(fineDetailSwitch(host)!);
    await act(async () => {
      first.resolve({ error: "Fine detail can't do that shape." });
      await first.promise;
    });
    expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Fine detail can't do that shape.");
    // 卡一格没动 —— 价、规格条、开关都回到服务端那一份。
    expect(host.textContent).toContain("Generate · 1 credit");
    expect(fineDetailSwitch(host)!.getAttribute("aria-checked")).toBe("false");
  });

  it("ENGINE-A3 第一趟被拒 ⇒ 排在后面那一格被丢掉这件事也说出来(#1241 判官 P2-2)", async () => {
    // 他点过两格,只有一格得到答复。排队那一格退回卡上原来的值,屏幕上却只有另一格的
    // 拒绝理由 —— 看上去像白点了一下。服务端那句原话在前,这一句跟在后面。
    const first = deferred<unknown>();
    updateOptionsMock.mockReturnValueOnce(first.promise);
    const host = mount(imageCard());
    await chooseOption(selectByLabel(host, "How many images")!, "3");
    await click(fineDetailSwitch(host)!);
    await act(async () => {
      first.resolve({ error: "Fine detail can't do that shape." });
      await first.promise;
    });
    expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    const said = host.querySelector('[role="alert"]')!.textContent ?? "";
    expect(said).toContain("Fine detail can't do that shape.");
    expect(said).toContain(QUEUED_DROPPED_NOTE);
    expect(fineDetailSwitch(host)!.getAttribute("aria-checked")).toBe("false");
  });

  it("ENGINE-A3 重铸在飞时看得见 —— 那三格自己变淡,不只是 aria-busy(#1241 判官 P2-1)", async () => {
    const first = deferred<unknown>();
    updateOptionsMock.mockReturnValueOnce(first.promise);
    const host = mount(imageCard());
    const box = () => host.querySelector<HTMLElement>('[data-slot="card-options"]')!;
    expect(box().getAttribute("aria-busy")).toBe("false");

    await chooseOption(selectByLabel(host, "How many images")!, "3");
    // 看得见的那一半:`aria-busy` 是给屏幕读者的,变淡是给眼睛的 —— 同一格状态,两个出口。
    expect(box().getAttribute("aria-busy")).toBe("true");
    expect(box().className).toContain("aria-busy:opacity-60");
    // 但控件仍然可点(变淡不是锁住):这一格照旧排得进队。
    expect(selectByLabel(host, "How many images")!.disabled).toBe(false);

    await act(async () => {
      first.resolve({ ok: true, payload: imageCard({ params: { aspectRatio: "1:1", count: 3 }, estimatedCredits: 3 }) });
      await first.promise;
    });
    expect(box().getAttribute("aria-busy")).toBe("false");
  });
});
