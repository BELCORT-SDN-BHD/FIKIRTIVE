// @vitest-environment jsdom
/**
 * 画布上的钱:**价格在承诺动作旁,余额不在画布上**(设计原则第 18 条)。
 *
 * ── 退役立碑(Founder 2026-08-25 授权的旧架构归位)────────────────────────────────
 *
 * 这个文件原本钉的是 #932:画布顶栏那份常驻余额与全局导航侧栏的余额**同步**——
 * `NorthstarCanvasWorkspace` 的 `refreshBalance` 只重读自己的 state,从没喊出
 * `notifyBalanceRefresh()`,于是一次结算之后顶栏对了、侧栏停在旧数字。三条断言:
 * 落地读出 "1,240 credits"、结算后顶栏变 "1,180 credits" 且共享信号被叫醒、
 * 本地读还在飞时信号也不许被吞。
 *
 * **那个 bug 的宿主没有了,而且是被裁掉的,不是被改坏的。** 设计原则第 18 条
 * (Founder 2026-08-21 裁决,`docs/design/v4/design-principles.md`)写死:
 *
 *   「价格只出现在承诺动作旁;余额只住 Billing 一处…… Billing 以外出现常驻余额,违规。」
 *
 * R22 画布(Founder 08-24 检查点亲选 direction 2)因此**不渲染任何常驻余额** —— 顶栏那份
 * 数字是被裁决删掉的,不是漏做的。旧断言里的 "1,240 credits" 今天要是真出现在画布上,
 * 那才是违规。所以三条整体退役:再钉它们等于用测试把一条已经被推翻的设计钉回去。
 *
 * 断言目标改钉这一面**今天真正承重**的那半条 —— 同一条原则的另一半,「花钱先看见」
 * (原则第 3 条:凡要花 credits 的动作,按下之前价格已在屏上):
 *
 *   ① 报价没回来之前,composer 不编一个价格,发送键按不下去;
 *   ② 报价回来之后,那个**确切**数字就贴在发送键旁边;
 *   ③ 画布上没有一处常驻余额(第 18 条的判法逐字);
 *   ④ 钱不够时,服务端那句实话原样到达商家,画布不自己发明第二套说法、也不发明一个余额。
 *
 * 已知缺口(本次不补,已上报):④ 到达的是一段**纯文字**。`lib/credit-format.ts` 的
 * `TOP_UP_CTA`(「Top up in Billing.」)本来该由 `components/exits/Exits.tsx` 的
 * `ErrorWithTopUp` 渲染成一条真能点的链接(#979 的整个理由),而 R22 画布的 notice 行
 * 没有接它 —— 商家在已经决定付钱的那一刻,仍然得自己去找 Billing 在哪。这里只钉「话到了」,
 * 不假装链接已经在了。
 *
 * 零后端、零生成:付费适配器整个是替身,一个积分都花不出去。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, installToastEnvironment, latestToast, settleToasts, withToaster } from "./__helpers__/toast-probe";
installToastEnvironment();
import { outOfCreditsMessage } from "@/lib/credit-format";

const mocks = vi.hoisted(() => ({
  quoteCosts: vi.fn(),
  imageShapes: vi.fn(),
  generateImage: vi.fn(),
  /** useCanvasGen 的第 5 个位置参数 —— 付费路径把失败讲给商家听的**唯一**出口。 */
  onError: { current: null as null | ((message: string) => void) },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: (
    _projectId: string,
    _onNode: unknown,
    _onResolve: unknown,
    _activeThreadId: unknown,
    onError: (message: string) => void,
  ) => {
    mocks.onError.current = onError;
    return {
      generateImage: mocks.generateImage,
      quoteCosts: mocks.quoteCosts,
      imageShapes: mocks.imageShapes,
    };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");

/** 服务端给的落地余额。它进得来,但按第 18 条**画布上一个字都不许印**。 */
const SERVER_BALANCE = 1240;

const RUNTIME_CONTEXT = {
  projects: [{ id: "p1", name: "Kedai Kopi" }],
  threads: [{ id: "t1", projectId: "p1", title: "Morning shots", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null }],
  activeProjectId: "p1",
  activeThreadId: "t1",
  initialBalance: SERVER_BALANCE,
  visualFixture: null as null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.quoteCosts.mockResolvedValue({ imageCredits: 8, videoCredits: 80 });
  mocks.imageShapes.mockResolvedValue({ options: ["1:1", "9:16", "16:9"], defaultAspect: "1:1" });
});

afterEach(async () => {
  clearToasts();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.onError.current = null;
  vi.clearAllMocks();
});

async function renderSurface(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    // 回执由根布局上的 Toaster 画(审计 A-4),挂在同一棵树里。
    root!.render(withToaster(createElement(R22CanvasSurface, { runtimeContext: RUNTIME_CONTEXT, entities: [] })));
  });
  await act(async () => { await Promise.resolve(); });
}

function sendButton(): HTMLButtonElement {
  const button = container!.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
  expect(button, "composer 没有发送键 —— 下面几条就在核对空气").not.toBeNull();
  return button!;
}

function priceText(): string {
  return container!.querySelector(".r22-canvas-price")?.textContent ?? "";
}

/**
 * 在 composer 里打一句话。
 *
 * beta 卫生大扫除(2026-08-26,台账 P1-3)之后,空输入时发送键本来就是灰的 —— 那是**另一条**
 * 闸(「按得动就一定有事发生」)。这一份文件钉的是**价格**那条闸,所以每条断言之前先把字打进去:
 * 否则「按不下去」会因为输入框是空的而恒真,断言就从「价格拦住了它」滑成「什么都没证明」。
 * 口径因此是升的,不是降的。
 */
async function typePrompt(): Promise<void> {
  const composer = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Describe what to make"]');
  expect(composer, "composer 没有输入框 —— 下面几条在核对空气").not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(composer!, "A tray of kuih for Raya");
    composer!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("花钱先看见:价格贴在发送键旁(设计原则第 3 条)", () => {
  it("报价还没回来时不编一个数字,发送键按不下去", async () => {
    // 报价永远不 resolve —— 就是「这一刻还不知道要花多少」。
    mocks.quoteCosts.mockReturnValue(new Promise(() => {}));
    await renderSurface();

    expect(priceText()).toBe("Checking cost…");
    expect(priceText(), "还不知道价格,屏上却已经印了一个数").not.toMatch(/\d/);

    await typePrompt();

    expect(sendButton().disabled, "价格未知,发送键却按得下去").toBe(true);
  });

  it("报价回来之后,贴在发送键旁的就是那个确切数字", async () => {
    await renderSurface();

    expect(mocks.quoteCosts).toHaveBeenCalledWith(1);
    expect(priceText()).toBe("8 cr");

    await typePrompt();

    expect(sendButton().disabled, "价格已经在屏上了,发送键还被拦着").toBe(false);
  });

  it("形状读不出来时同样按不下去 —— 半份事实不算看见了", async () => {
    mocks.imageShapes.mockRejectedValue(new Error("shapes unavailable"));
    await renderSurface();

    await typePrompt();

    expect(sendButton().disabled, "形状读不出来,发送键却按得下去").toBe(true);
  });
});

describe("余额只住 Billing 一处(设计原则第 18 条)", () => {
  it("服务端把余额递进来了,画布上一个字都不印", async () => {
    await renderSurface();
    const text = container!.textContent ?? "";

    for (const forbidden of ["1,240 credits", "1,240", "1240", "credits left", "Balance"]) {
      expect(text, `画布上出现了常驻余额「${forbidden}」—— 第 18 条的判法逐字`).not.toContain(forbidden);
    }
    // 屏上唯一合法的钱,是承诺动作旁那一份报价。
    expect(priceText()).toBe("8 cr");
  });
});

describe("钱不够时说实话,不发明第二套说法", () => {
  it("服务端那一句原样到达商家,画布不自己拼一份", async () => {
    await renderSurface();
    expect(mocks.onError.current, "付费路径没有把失败出口交给这一面").toBeTypeOf("function");

    // 服务端拼的就是这一句(`outOfCreditsMessage` 是它唯一的出处,#699/#979)。
    const serverSentence = outOfCreditsMessage(8);
    await act(async () => { mocks.onError.current!(serverSentence); });
    await settleToasts();

    expect(latestToast(), "商家读到的不是服务端那一句").toContain(serverSentence);
    // 报价被复述成第二个数字、或凭空出现一个余额,都是这条要挡的事。
    expect(document.body.textContent).not.toContain("1,240");
  });

  it("这一面自己不重打一份「钱不够」措辞 —— 它只转述服务端说的话", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const surface = readFileSync(resolve(webRoot, "components/canvas/R22CanvasSurface.tsx"), "utf8");

    // 抄一份的代价就是漂移:服务端改了句子,抄的那份不会跟着变。
    expect(surface, "「钱不够」那句被抄进画布了 —— 转述它,别复制它").not.toContain("Not enough credits");
    expect(surface).not.toContain("Top up in Billing.");
  });
});
