// @vitest-environment jsdom
/**
 * R3-F29 —— 失败卡上那颗「Try again」按下去有没有回应。
 *
 * staging 构建 c0d25917（2026-09-17）走查实测：商家在一张失败的确认卡上按「Try again」，
 * 服务端 200、对话里真的多了一张克隆卡，**可屏幕上什么都没留下** —— 一分钟之后回头看，
 * 卡面与按之前一模一样，只有整页重载才看得见那张新卡。商家于是一分钟按一次，连按四次
 * （05:28:05／05:29:26／05:30:12／05:30:58），拿到四张一模一样的克隆卡。
 *
 * **修之前已经有的**（照实记，免得这一份把自己写成比实际更大的修）：在飞那一格
 * （`disabled` ＋ 按钮改口）、`if (busy) return` 那道同帧闸、以及失败那句话落进卡上那块
 * 持久的 Alert —— 三样都在 c0d25917 的源码里。**唯一缺的是成交那一格**：按回来什么都不设，
 * 于是屏幕上一秒之后就什么都不剩，而那四次按压相隔一分钟，同帧闸根本轮不到它上场。
 *
 * 病根是同一件事有两份回执合同：`OttoResult` 的「Make another」与 `OttoPlanCard` 的
 * 「Try again」落到**同一个**服务端动作（`coworkVaryCard`），前者会亮「Added」两秒半，
 * 后者什么都不设。今天钱没受影响（`coworkVaryCard` 不预扣、不建 GenJob、不写账本，
 * 见 `apps/web/lib/cowork-actions.ts` 的 `coworkVaryCard`；staging 四次按压实测 0 条
 * GenJob、0 条 CreditLedger），但同样的沉默长在一颗会扣钱的键上就是钱的缺陷。
 *
 * 所以这一份钉的是**两处共用一份回执合同**（`components/otto/vary-card-feedback.tsx`）：
 *  1. 按下去先转圈（禁用 ＋ `VARY_BUSY_LABEL`），回来说「Added」；
 *  2. 那句「Added」**到点自己收**（`VARY_CONFIRM_MS`），不会永远挂在卡上；
 *  3. 在飞时再按一下是**空动作** —— 不打第二趟，因此不会再多一张克隆卡；
 *  4. 服务端说不行、以及连服务端都没够着（transport 抛错），那句话都出现在卡上的 Alert 里；
 *  5. 「Make another」与「Try again」读的是同一份字与同一段时长（单一源头，§7.3）。
 *
 * 规格：docs/specs/frontend-baseline.md §5（2026-09-17 R3-F29 登记行）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OttoPlanCardPayload } from "@/components/otto/plan-card-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ coworkVaryCard: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: h.coworkVaryCard,
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");
const { OttoResult } = await import("@/components/otto/OttoResult");
const {
  useVaryCard,
  VARY_ADDED_LABEL,
  VARY_ADDED_NOTE,
  VARY_BUSY_LABEL,
  VARY_CONFIRM_MS,
  VARY_FAILED_NOTE,
} = await import("@/components/otto/vary-card-feedback");
type VaryRun = ReturnType<typeof useVaryCard>["run"];

/** 那一行「加好了」。**区域始终挂着**（读屏只播报已存在 live region 的内容变化），
 *  所以判据是它里面那句话，而不是它在不在 DOM 里。 */
function statusText(host: HTMLElement): string {
  const region = host.querySelector('[role="status"]');
  if (!region) throw new Error(`the role="status" live region must stay mounted: ${host.innerHTML}`);
  return region.textContent ?? "";
}

/** 一张服务端真会铸出来的图片卡 —— 走查现场那张就是这个形状。 */
function failedCard(): OttoPlanCardPayload {
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
  } as OttoPlanCardPayload;
}

const roots: Array<[Root, HTMLElement]> = [];
afterEach(() => {
  for (const [root, host] of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
});
beforeEach(() => {
  h.coworkVaryCard.mockReset();
});

function mount(element: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  act(() => root.render(element));
  return host;
}

function mountFailedCard(onRetry = vi.fn()): HTMLElement {
  return mount(
    createElement(OttoPlanCard, {
      cardId: "card_failed_1",
      payload: failedCard(),
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      genJobId: "job_1",
      cardState: "failed" as const,
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
      onOptionsChanged: vi.fn(),
      onRetry,
    }),
  );
}

function buttonLabelled(host: HTMLElement, ...labels: string[]): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) =>
    labels.some((label) => (b.textContent ?? "").includes(label)),
  );
  if (!found) throw new Error(`no button matching ${labels.join(" / ")}: ${host.textContent}`);
  return found as HTMLButtonElement;
}

function click(button: HTMLButtonElement): void {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** A promise whose settlement this test controls — the action stays in flight until told. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("R3-F29 · 失败卡「Try again」的回执合同", () => {
  it("按下去先转圈、回来说 Added（走查里缺的正是后面那一格）", async () => {
    const gate = deferred<{ threadId: string }>();
    h.coworkVaryCard.mockReturnValue(gate.promise);
    const onRetry = vi.fn();
    const host = mountFailedCard(onRetry);

    // 按之前：live region 已经挂在那儿，只是空的。
    expect(statusText(host)).toBe("");

    click(buttonLabelled(host, "Try again"));

    // ① 在飞：按钮禁用并改口，商家看得出这一下被收到了（这一格 c0d25917 上已经有）。
    const busy = buttonLabelled(host, VARY_BUSY_LABEL);
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain(VARY_BUSY_LABEL);

    // ② 回来：确认亮起来，卡下那一行人话有了字，父组件被通知去取那张新卡（这一格从前没有）。
    await act(async () => {
      gate.resolve({ threadId: "thread_1" });
      await gate.promise;
    });
    expect(buttonLabelled(host, VARY_ADDED_LABEL).textContent).toContain(VARY_ADDED_LABEL);
    expect(statusText(host)).toContain(VARY_ADDED_NOTE);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(h.coworkVaryCard).toHaveBeenCalledTimes(1);
  });

  it("那句 Added 到点自己收，按钮回到 Try again（确认不会永远挂在卡上）", async () => {
    vi.useFakeTimers();
    h.coworkVaryCard.mockResolvedValue({ threadId: "thread_1" });
    const host = mountFailedCard();

    await act(async () => {
      buttonLabelled(host, "Try again").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(buttonLabelled(host, VARY_ADDED_LABEL).textContent).toContain(VARY_ADDED_LABEL);
    expect(statusText(host)).toContain(VARY_ADDED_NOTE);

    // 这一段时长是合同里那一个数（`VARY_CONFIRM_MS`）—— 两颗键共用它，所以这里钉的是它，
    // 不是一个抄在测试里的 2500。
    act(() => {
      vi.advanceTimersByTime(VARY_CONFIRM_MS);
    });
    expect(buttonLabelled(host, "Try again").textContent).toContain("Try again");
    // 区域还在（读屏要的就是它一直在），里面的字收走了。
    expect(statusText(host)).toBe("");
  });

  it("在飞时再按一下是空动作 —— 不会再克隆一张卡", async () => {
    const gate = deferred<{ threadId: string }>();
    h.coworkVaryCard.mockReturnValue(gate.promise);
    const host = mountFailedCard();

    click(buttonLabelled(host, "Try again"));
    // 走查现场那四下的第二下：卡面还在飞，商家又按了一次。
    click(buttonLabelled(host, VARY_BUSY_LABEL));
    click(buttonLabelled(host, VARY_BUSY_LABEL));

    expect(h.coworkVaryCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve({ threadId: "thread_1" });
      await gate.promise;
    });
    expect(h.coworkVaryCard).toHaveBeenCalledTimes(1);
  });

  it("合同自己也拦得住连按 —— 不靠按钮那一格 disabled（同一帧两下只出一趟）", async () => {
    // 上面那条走的是真按钮，而按钮在飞行时是 disabled 的 —— React 根本不会把第二下交给
    // handler。所以那一条证明的是「屏幕上按不动」，不是「合同自己拦得住」。这一条直接对着
    // 合同连打两趟（键盘、竞速的重渲染、将来某个忘了写 disabled 的调用方都长这样）：
    // 判据是一个 ref，`busy` 这个 state 在同一帧里还没换过来。
    const gate = deferred<{ threadId: string }>();
    h.coworkVaryCard.mockReturnValue(gate.promise);

    let run: VaryRun | null = null;
    function Probe() {
      run = useVaryCard().run;
      return null;
    }
    mount(createElement(Probe));

    let second: ReturnType<VaryRun> | null = null;
    await act(async () => {
      const first = run!("card_x");
      second = run!("card_x");
      gate.resolve({ threadId: "thread_1" });
      await Promise.all([first, second]);
    });

    expect(h.coworkVaryCard).toHaveBeenCalledTimes(1);
    // 第二趟拿回 null —— 调用方据此知道「这一下没送出去」，而不是误以为又加了一张卡。
    await expect(second!).resolves.toBeNull();
  });

  it("服务端说不行时，那句话出现在卡上（不再一声不吭）", async () => {
    h.coworkVaryCard.mockResolvedValue({ error: "This card is no longer valid." });
    const onRetry = vi.fn();
    const host = mountFailedCard(onRetry);

    await act(async () => {
      buttonLabelled(host, "Try again").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This card is no longer valid.");
    expect(statusText(host)).toBe("");
    expect(onRetry).not.toHaveBeenCalled();
    // 按钮回到可按 —— 失败不能把唯一的出路锁死。
    expect(buttonLabelled(host, "Try again").disabled).toBe(false);
  });

  it("连服务端都没够着（transport 抛错）时，也有一句人话落在卡上", async () => {
    // 服务端那条 `{ error }` 路上面那一条已经钉住；这一条是**抛出来**的那一支 ——
    // 断网、fetch 炸了、server action 反序列化失败。从前这一支由组件自己 catch，两处各写
    // 一句；现在合同兜住并给出同一句 `VARY_FAILED_NOTE`。
    h.coworkVaryCard.mockRejectedValue(new Error("network down"));
    const onRetry = vi.fn();
    const host = mountFailedCard(onRetry);

    await act(async () => {
      buttonLabelled(host, "Try again").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(VARY_FAILED_NOTE);
    expect(statusText(host)).toBe("");
    expect(onRetry).not.toHaveBeenCalled();
    expect(buttonLabelled(host, "Try again").disabled).toBe(false);
  });

  it("「Make another」与「Try again」读同一份回执合同（单一源头 §7.3）", async () => {
    h.coworkVaryCard.mockResolvedValue({ threadId: "thread_1" });
    const host = mount(
      createElement(OttoResult, {
        payload: { kind: "image", urls: ["https://cdn.example/one.png"] },
        sourceCardId: "card_done_1",
        onMakeAnother: vi.fn(),
      }),
    );

    await act(async () => {
      buttonLabelled(host, "Make another").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(buttonLabelled(host, VARY_ADDED_LABEL).textContent).toContain(VARY_ADDED_LABEL);
    expect(statusText(host)).toContain(VARY_ADDED_NOTE);
  });

  it("「Make another」那一行确认也到点自己收（两颗键同一段时长）", async () => {
    vi.useFakeTimers();
    h.coworkVaryCard.mockResolvedValue({ threadId: "thread_1" });
    const host = mount(
      createElement(OttoResult, {
        payload: { kind: "image", urls: ["https://cdn.example/one.png"] },
        sourceCardId: "card_done_1",
        onMakeAnother: vi.fn(),
      }),
    );

    await act(async () => {
      buttonLabelled(host, "Make another").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(statusText(host)).toContain(VARY_ADDED_NOTE);

    act(() => {
      vi.advanceTimersByTime(VARY_CONFIRM_MS);
    });
    expect(buttonLabelled(host, "Make another").textContent).toContain("Make another");
    expect(statusText(host)).toBe("");
  });
});
