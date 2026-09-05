// @vitest-environment jsdom
/**
 * creation-a5-card-change-form —— 「Change something」那张小表单，与供应商提示词收进
 * 「Advanced details」的证据（清单 A5 / P2-013）。
 *
 * 规格 `docs/specs/creation-engine.md`，验收 **CREATE-A1**（画布路径的判定落在 Otto 确认
 * 卡片上：花钱之前那张卡必须**可编辑**）。
 *
 * 主干上那颗按钮从前只做一件事：把这张卡送给供应商的那段原话整段塞回输入框，商家自己
 * 在一坨机器措辞上改。这一份钉四件事：
 *
 *  1. **表单真的长出来**（默认收起；按一下出现「Tell Otto what to change」那一行）；
 *  2. **能就地改的那几格仍走服务端重铸**——表单不新造第二条改档路，`ottoUpdateGenCardOptions`
 *     的入参逐字仍是那一格（钱路口径与从前一个字节没变）；
 *  3. **人话提交把「他写的那句 + 这张卡的原话」送回对话**，走的仍是 `onChangeSomething`
 *     那**一条**既有路；
 *  4. **供应商提示词默认收起**（`<details>` 无 `open`），而且不再占着卡面主视图。
 *
 * 还钉一条「不摆做不到的控件」：`applyCardOptions` 今天只收图片卡的三格（视频卡整张
 * 拒绝、参考没有入口），所以表单里**没有**时长／声音／参考三格 —— 摆一个按下去必然
 * 被拒的控件，就是把 fail closed 做成陷阱（与三格里精修那一格同一条理由）。
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
const { CHANGE_FORM_LABEL, CHANGE_FORM_SEND, changeRequestSeed, askOttoNote, inPlaceOptionNames } =
  await import("@/components/otto/CardOptionControls");

const PROMPT = "A pandan kaya jar on a marble counter, soft window light, 50mm";

/** 一张服务端今天真会铸出来的图片卡（三格菜单齐全）。 */
function imageCard(over: Partial<OttoPlanCardPayload> = {}): OttoPlanCardPayload {
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

/** 一张视频卡 —— 服务端今天**改不动**它（`applyCardOptions` 对非图片卡整张拒绝）。 */
function videoCard(over: Partial<OttoPlanCardPayload> = {}): OttoPlanCardPayload {
  return {
    kind: "video",
    model: "seedance-2-mini",
    params: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 5, audio: true, count: 1 },
    reason: "video",
    specChips: ["9:16", "5s", "720p", "With sound"],
    downgraded: false,
    structuredPrompt: "A slow push-in on the jar",
    entityIds: [],
    variantSel: {},
    estimatedPriceUsd: 0.39,
    estimatedCredits: 8,
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

/** 生产里那个父组件的最小替身：重铸后的整张卡由它持有，送回对话的那句话记在 `seeds` 里。 */
function CardHost({
  initial,
  seeds,
  cardState = "idle",
}: {
  initial: OttoPlanCardPayload;
  seeds: string[];
  cardState?: "idle" | "working";
}) {
  const [payload, setPayload] = useState<unknown>(initial);
  return createElement(OttoPlanCard, {
    cardId: "card_1",
    payload,
    entities: [],
    threadId: "thread_1",
    projectId: "proj_1",
    // 生产里这张卡由消息 id 挂载：批准之后 `cardState` 从 idle 变 working，**组件不卸载**。
    genJobId: cardState === "working" ? "job_1" : null,
    cardState,
    pendingApproval: true,
    onApproved: vi.fn(),
    onChangeSomething: (seed: string) => { seeds.push(seed); },
    onOptionsChanged: (_cardId: string, next: unknown) => setPayload(next),
  });
}

function mount(payload: OttoPlanCardPayload): {
  host: HTMLElement;
  seeds: string[];
  /** 同一棵树上换 `cardState` —— 卡不卸载，正是生产里按下 Generate 之后那一刻。 */
  setCardState: (next: "idle" | "working") => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  const seeds: string[] = [];
  act(() => { root.render(createElement(CardHost, { initial: payload, seeds })); });
  return {
    host,
    seeds,
    setCardState: (next) => {
      act(() => { root.render(createElement(CardHost, { initial: payload, seeds, cardState: next })); });
    },
  };
}

function mountCanvas(payload: OttoPlanCardPayload): { host: HTMLElement; seeds: string[] } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  const seeds: string[] = [];
  act(() => {
    root.render(
      createElement(OttoTurnCard, {
        status: { phase: "needs-confirmation", label: "Waiting for you", dot: "bg-brand", detail: null, busy: false } as const,
        text: "Here's what I'll make.",
        streaming: false,
        confirmCards: [{ cardId: "card_1", threadId: "thread_1", payload, pendingApproval: true }],
        onApproved: vi.fn(),
        onChangeSomething: (seed: string) => { seeds.push(seed); },
        onOptionsChanged: vi.fn(),
      }),
    );
  });
  return { host, seeds };
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`no button labelled "${text}"`);
  return found;
}

function noteBox(host: HTMLElement): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${CHANGE_FORM_LABEL}"]`);
}

async function type(box: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function advancedDetails(host: HTMLElement): HTMLDetailsElement | null {
  return [...host.querySelectorAll("details")].find(
    (d) => (d.querySelector("summary")?.textContent ?? "").includes("Advanced details"),
  ) ?? null;
}

describe("CREATE-A1 确认卡的「Change something」= 一张小表单，不是把原话塞回输入框", () => {
  it("CREATE-A1 表单默认收起；按下 Change something 才长出那一行人话输入与 Send", async () => {
    const { host } = mount(imageCard());
    expect(noteBox(host)).toBeNull();
    const button = buttonByText(host, "Change something");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click(button);
    expect(noteBox(host)).toBeTruthy();
    expect(host.textContent).toContain(CHANGE_FORM_SEND);
    expect(buttonByText(host, "Change something").getAttribute("aria-expanded")).toBe("true");
    // 再按一下收回去 —— 同一颗键，两个方向。
    await click(buttonByText(host, "Change something"));
    expect(noteBox(host)).toBeNull();
  });

  it("CREATE-A1 卡一开跑表单就消失 —— 已扣过钱的卡上不许挂一张关不掉的「告诉我要改什么」", async () => {
    // 判官 #1245 P1-1：卡由消息 id 挂载，按下 Generate 之后组件不卸载。渲染闸从前只问
    // `changeOpen`，于是表单跟着已付费的卡走，而那颗切换键此刻已经不在了 —— 商家关不掉它。
    const { host, setCardState } = mount(imageCard());
    await click(buttonByText(host, "Change something"));
    expect(noteBox(host)).toBeTruthy();
    setCardState("working");
    // 已排队的卡：那一行写着「✓ You approved this」，表单与切换键都必须已经不在。
    expect(host.textContent).toContain("✓ Approved — in the queue");
    expect(noteBox(host)).toBeNull();
    expect(host.querySelector('[data-slot="card-change-form"]')).toBeNull();
    expect([...host.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim())).not.toContain(
      "Change something",
    );
  });

  it("CREATE-A1 只出得了一张的卡：Images 那一格不渲染，指路句也不点它的名（两边同一条判据）", async () => {
    // 判官 #1245 P2-4：`inPlaceOptionNames` 早就只在 `maxCount > 1` 时说 images，而卡上那颗
    // 下拉照旧渲染成一个只有一项的死控件 —— 话与卡面对不上。
    const single = imageCard({ options: { maxCount: 1, aspectRatios: ["1:1", "4:3"], fineDetailAvailable: false } });
    expect(inPlaceOptionNames(single)).toEqual(["shape"]);
    const { host } = mount(single);
    expect(
      [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "How many images"),
    ).toBeUndefined();
    // 形状那一格照旧在 —— 一格摆不动不该把整块控件收掉。
    expect(
      [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Shape of the image"),
    ).toBeTruthy();
    await click(buttonByText(host, "Change something"));
    const form = host.querySelector('[data-slot="card-change-form"]')!;
    expect(form.textContent).toContain("Shape is on the card above");
    expect(form.textContent).not.toContain("images");
  });

  it("CREATE-A1 空的那一行送不出去 —— Send 在他写字之前是禁用的", async () => {
    const { host, seeds } = mount(imageCard());
    await click(buttonByText(host, "Change something"));
    const send = buttonByText(host, CHANGE_FORM_SEND);
    expect(send.disabled).toBe(true);
    await click(send);
    expect(seeds).toEqual([]);
  });

  it("CREATE-A1 人话提交 ⇒ 他写的那句连同这张卡的原话回到对话，走的是既有那一条路", async () => {
    const { host, seeds } = mount(imageCard());
    await click(buttonByText(host, "Change something"));
    await type(noteBox(host)!, "  make it 4:5 and warmer  ");
    await click(buttonByText(host, CHANGE_FORM_SEND));
    expect(seeds).toEqual([`make it 4:5 and warmer\n\nThe plan to change: ${PROMPT}`]);
    // 送完表单收起 —— 商家的下一眼回到「要不要买」。
    expect(noteBox(host)).toBeNull();
  });

  it("CREATE-A1 表单开着时，卡上那几格照旧走服务端重铸（参数逐字，不新造第二条改档路）", async () => {
    updateOptionsMock.mockResolvedValue({
      ok: true,
      payload: { ...imageCard(), params: { aspectRatio: "3:4", count: 1 } },
    });
    const { host } = mount(imageCard());
    await click(buttonByText(host, "Change something"));
    const shapes = [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Shape of the image");
    await act(async () => {
      shapes!.value = "3:4";
      shapes!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(updateOptionsMock).toHaveBeenCalledTimes(1);
    expect(updateOptionsMock).toHaveBeenCalledWith({ threadId: "thread_1", cardId: "card_1", aspectRatio: "3:4" });
  });

  it("CREATE-A1 视频卡：表单里不摆时长与声音那两格，改说出「它们改不动，用人话告诉我」", async () => {
    // `applyCardOptions` 对非图片卡整张拒绝，所以时长与声音在这张卡上没有就地改法。
    expect(askOttoNote(videoCard())).toContain("length and sound");
    const { host } = mount(videoCard());
    await click(buttonByText(host, "Change something"));
    // 表单开着，可它一个做不到的控件都没有 —— 只有那一行人话。
    expect(host.querySelectorAll("select").length).toBe(0);
    expect(host.querySelector('[data-slot="card-options"]')).toBeNull();
    expect(host.querySelector('[data-slot="card-change-form"]')!.textContent).toContain(
      "I can't change length and sound on this card",
    );
    expect(noteBox(host)).toBeTruthy();
  });

  it("CREATE-A1 带参考的卡：表单说得出「哪几件参考改不动」，而不是摆一个点不动的挑选器", async () => {
    const withRef = imageCard({
      approvedEntities: [{ id: "e1", name: "Aisyah", type: "CHARACTER" }],
    });
    expect(askOttoNote(withRef)).toContain("which references it uses");
    const { host } = mount(withRef);
    await click(buttonByText(host, "Change something"));
    const form = host.querySelector('[data-slot="card-change-form"]')!;
    expect(form.textContent).toContain("which references it uses");
    // 能就地改的那几格在卡上，表单只指路，不抄第二份控件。
    expect(form.querySelectorAll("select").length).toBe(0);
    expect(form.textContent).toContain("are on the card above");
  });

  it("CREATE-A1 画布上那张卡的 Change 打开的是同一份表单（两处不可能说出两件事）", async () => {
    const { host, seeds } = mountCanvas(imageCard());
    expect(noteBox(host)).toBeNull();
    await click(buttonByText(host, "Change"));
    await type(noteBox(host)!, "drop the blue cup");
    await click(buttonByText(host, CHANGE_FORM_SEND));
    expect(seeds).toEqual([`drop the blue cup\n\nThe plan to change: ${PROMPT}`]);
  });

  it("CREATE-A1 `changeRequestSeed` 纯函数：读不懂原话的老卡只送商家自己那句", () => {
    expect(changeRequestSeed("make it 4:5", {})).toBe("make it 4:5");
    expect(changeRequestSeed("", imageCard())).toBe(PROMPT);
  });
});

describe("CREATE-A1 供应商提示词收进 Advanced details（默认收起）", () => {
  it("CREATE-A1 卡面主视图不再摆那段原话；它住在默认收起的 Advanced details 里", () => {
    const { host } = mount(imageCard());
    const details = advancedDetails(host);
    expect(details).toBeTruthy();
    // 默认收起 —— `<details>` 上没有 `open`。
    expect(details!.hasAttribute("open")).toBe(false);
    expect(details!.textContent).toContain(PROMPT);
    // 那段字**只**出现在折叠区里：主视图不再有第二份。
    const outside = host.textContent!.replace(details!.textContent!, "");
    expect(outside).not.toContain(PROMPT);
    // 收起不等于藏起 —— Copy 也还在里面。
    expect(details!.textContent).toContain("Copy");
    expect(details!.textContent).toContain("The prompt sent to the image engine");
  });

  it("CREATE-A1 视频卡的折叠区说的是视频引擎那一句（措辞跟着卡自己的类型走）", () => {
    const { host } = mount(videoCard());
    expect(advancedDetails(host)!.textContent).toContain("The prompt sent to the video engine");
  });

  it("CREATE-A1 没有原话的老卡 ⇒ 整块折叠区不出现（不编一句提示词充数）", () => {
    const bare = { ...imageCard() };
    delete bare.structuredPrompt;
    const { host } = mount(bare);
    expect(advancedDetails(host)).toBeNull();
    // 卡照旧可批准 —— 少一段提示词不该让一张有价的卡失去按钮。
    expect(host.textContent).toContain("Generate · 1 credit");
  });
});
