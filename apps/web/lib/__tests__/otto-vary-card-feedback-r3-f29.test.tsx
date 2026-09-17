// @vitest-environment jsdom
/**
 * R3-F29 —— 失败卡上那颗「Try again」按下去有没有回应。
 *
 * staging 构建 c0d25917（2026-09-17）走查实测：商家在一张失败的确认卡上按「Try again」，
 * 服务端 200、对话里真的多了一张克隆卡，**可屏幕上一个字都没变** —— 按钮不转圈、不说
 * 「加好了」、也不报错，只有整页重载才看得见。商家于是一分钟按一次，连按四次
 * （05:28:05 / 05:29:26 / 05:30:xx / 05:3x），拿到四张一模一样的克隆卡。
 *
 * 病根是同一件事有两份回执合同：`OttoResult` 的「Make another」与 `OttoPlanCard` 的
 * 「Try again」落到**同一个**服务端动作（`coworkVaryCard`），前者会亮「Added」两秒半，
 * 后者什么都不设。今天钱没受影响（`coworkVaryCard` 不预扣、不建 GenJob、不写账本，
 * 见 `apps/web/lib/cowork-actions.ts` 的 `coworkVaryCard`；staging 四次按压实测 0 条
 * GenJob、0 条 CreditLedger），但同样的沉默长在一颗会扣钱的键上就是钱的缺陷。
 *
 * 所以这一份钉的是**两处共用一份回执合同**（`components/otto/vary-card-feedback.ts`）：
 *  1. 按下去先转圈（禁用 + 「Queuing…」），回来说「Added」；
 *  2. 在飞时再按一下是**空动作** —— 不打第二趟，因此不会再多一张克隆卡；
 *  3. 服务端说不行时，那句话出现在卡上的 Alert 里；
 *  4. 「Make another」与「Try again」读的是同一份字与同一段时长（单一源头，§7.3）。
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
const { useVaryCard, VARY_ADDED_LABEL, VARY_ADDED_NOTE, VARY_BUSY_LABEL, VARY_CONFIRM_MS } =
  await import("@/components/otto/vary-card-feedback");
type VaryRun = ReturnType<typeof useVaryCard>["run"];

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
  it("按下去先转圈、回来说 Added（走查里这两样一样都没有）", async () => {
    const gate = deferred<{ threadId: string }>();
    h.coworkVaryCard.mockReturnValue(gate.promise);
    const onRetry = vi.fn();
    const host = mountFailedCard(onRetry);

    click(buttonLabelled(host, "Try again"));

    // ① 在飞：按钮禁用并改口，商家看得出这一下被收到了。
    const busy = buttonLabelled(host, VARY_BUSY_LABEL);
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain(VARY_BUSY_LABEL);

    // ② 回来：确认亮起来，卡下多一行人话，父组件被通知去取那张新卡。
    await act(async () => {
      gate.resolve({ threadId: "thread_1" });
      await gate.promise;
    });
    expect(buttonLabelled(host, VARY_ADDED_LABEL).textContent).toContain(VARY_ADDED_LABEL);
    expect(host.textContent).toContain(VARY_ADDED_NOTE);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(VARY_ADDED_NOTE);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(h.coworkVaryCard).toHaveBeenCalledTimes(1);
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
    expect(host.textContent).not.toContain(VARY_ADDED_NOTE);
    expect(onRetry).not.toHaveBeenCalled();
    // 按钮回到可按 —— 失败不能把唯一的出路锁死。
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
    expect(host.querySelector('[role="status"]')?.textContent).toContain(VARY_ADDED_NOTE);
    // 两处同一段时长：确认到点自己收起来，不会永远挂在那儿。
    expect(VARY_CONFIRM_MS).toBeGreaterThan(0);
  });
});
