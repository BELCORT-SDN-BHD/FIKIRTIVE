// @vitest-environment jsdom
/**
 * R3-F27 —— 商家离开这一页再回来的那一下,进行中的那张卡要当场更新,不等下一格轮询。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5 的 2026-09-18 登记行
 * (Founder 2026-09-18 裁(对谈):修)。现场:
 * `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` R3-F27 ——
 * 批完一单视频、去 `/library` 看一眼、按浏览器返回回到首页,面板里那张「进行中」的卡
 * 停在离开前那一眼上。
 *
 * 这个文件钉三件事,全在真的 `OttoChatStream` 上(`useChat` 与那条取数是替身,钱路一个
 * 把手都碰不到):
 *
 *  ① **切回前台就读一次**(`visibilitychange` → `visible`)。
 *  ② **bfcache 摊开也读一次**(`pageshow` 且 `persisted`)—— 那一拍连计时器都是冻住的,
 *     不主动读就只能等下一格;慢档一格是 60 秒。
 *  ③ **两条反向**:首次加载那一声 `pageshow`(`persisted` 为 false)不读 —— 那一拍没有
 *     「回来」可言;这一条对话已经全是终态(没有在跑的活)时也不读 —— 看不见的那一页读
 *     回来的东西没有人在看,不为它多发一次已认证请求。
 *
 * 2026-09-18 复审回修再钉三件(两镜头各自实证的 P2/P3):
 *
 *  ④ **切回来不许抹掉钱的诚实话**。补读走的是 `rearmGenerationPoll()`,而它会把档位打回
 *     快轮 —— 于是快轮烧完之后屏幕上那句「This is taking longer than usual. Your credits
 *     for this are on hold…」会因为商家切了个标签页回来就当场消失,换回「Otto is making
 *     this」。服务端那一头什么都没变,我们却把自己承认过的「等太久了」收了回去。
 *     新纪律:**读**照补,**档位**只在本来就是快轮时才重上膛。
 *  ⑤ **隐藏那一声不读**。`visibilityState !== "visible"` 那道闸此前一条测试都没有 ——
 *     切**走**(hidden)也会敲一声 `visibilitychange`,那一下不该发请求。
 *  ⑥ **一次返回只读一次**。bfcache 摊开会连着敲 `pageshow` 与 `visibilitychange` 两声,
 *     它们说的是同一件事;在飞去重之前那是两趟请求、两次重上膛。
 *
 * 2026-09-18 第二轮复审再钉一件(P1):
 *
 *  ⑦ **每批活只在第一次切回时重臂快档。** ④ 只写了「快档才重臂」,那还不够:重臂会 bump
 *     `pollNonce`,而 bounded poll 的 `pollCount` 每次重建 effect 就归零,快档额度是
 *     2.5s × 48 ≈ 2 分钟 —— 一个每隔一分半切回来看一眼的商家会把这 2 分钟无限往后推,
 *     慢档永远到不了,那句「额度冻结」永远不出现。同一句话,换一种方式弄没了。
 *
 * 红→绿:修之前三处监听一条都不存在,①②两条各读到 0 次调用;第一轮回修之前 ④ 读到那句话
 * 被抹掉、⑤ 读到隐藏时也发了请求、⑥ 读到两次调用;第二轮回修之前 ⑦ 读到第二次切回把额度
 * 又推后了一整轮,那句话没有出现。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getCoworkThreadClient: vi.fn(),
  chat: {
    status: "ready" as const,
    messages: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.chat.messages,
    setMessages: vi.fn(),
    sendMessage: mocks.sendMessage,
    status: mocks.chat.status,
    error: null,
  }),
}));
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(_opts: unknown) { void _opts; } } }));
vi.mock("@/lib/cowork-fetch", () => ({
  getCoworkThreadClient: (...args: unknown[]) => mocks.getCoworkThreadClient(...args),
}));
vi.mock("@/components/otto/plan-approval", () => ({ runPlanApproval: vi.fn() }));
vi.mock("@/lib/reference-search-actions", () => ({
  searchReferencesAction: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

const { OttoChatStream } = await import("@/components/otto/OttoChatStream");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const THREAD_ID = "thread-r3f27";
const JOB_ID = "job_video_1";

/** 快轮这一档的全部额度:`GENERATION_WATCH_GEARS.fast` = 2.5s × 48 格 —— 烧完这些,
 *  `nextSyncPhase` 把档位交给慢轮,屏幕上那句「太久了」才有资格出现。 */
const FAST_GEAR_MS = 2500 * 48;
/** 还在快轮时那句话。 */
const WORKING_LINE = "Otto is making this";
/** 快轮烧完、慢轮还在问时那句**钱**的话(后半句带实体引号,只对这一句的前半截)。 */
const DELAYED_LINE = "This is taking longer than usual.";

/** 一张已经批准、钱已经花出去、结果还没回来的卡 —— `hasWorkingJob` 为真的最小现场。 */
const workingCard = () => ({
  id: "card_1",
  role: "assistant",
  metadata: { kind: "GEN_CARD", durableId: "card_1", genJobId: JOB_ID, payload: null },
  parts: [{ type: "text", text: "plan card" }],
});

/** 同一张卡,但结果已经落地 —— 这条对话没有在跑的活了。 */
const settledResult = () => ({
  id: "result_1",
  role: "assistant",
  metadata: { kind: "GEN_RESULT", durableId: "result_1", genJobId: JOB_ID },
  parts: [{ type: "text", text: "done" }],
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

const element = (): ReactElement =>
  createElement(OttoChatStream, {
    projectId: "project-1",
    entities: [],
    thread: {
      id: THREAD_ID,
      projectId: "project-1",
      title: "Untitled",
      updatedAt: new Date().toISOString(),
      messages: [],
    },
    balanceUsd: 40,
    onRefresh: async () => {},
    onThreadUpdate: () => {},
  }) as ReactElement;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element()));
}

/** 切走再切回来 —— 商家换了个标签页,回头看看跑得怎么样。 */
async function returnToForeground(): Promise<void> {
  setVisibility("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  setVisibility("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}

/** 按浏览器返回、这一页从 bfcache 里被摊开的那一声。 */
async function pageShow(persisted: boolean): Promise<void> {
  await act(async () => {
    const event = new Event("pageshow") as Event & { persisted?: boolean };
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
  });
}

/** 真实的 bfcache 摊开:同一拍里连着敲两声(`pageshow` 与 `visibilitychange`),
 *  它们说的是同一件事 —— 商家回到了这一页。 */
async function bfcacheRestore(): Promise<void> {
  await act(async () => {
    const event = new Event("pageshow") as Event & { persisted?: boolean };
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** 屏幕上此刻的字。 */
const screenText = (): string => container?.textContent ?? "";

beforeEach(() => {
  setVisibility("visible");
  mocks.chat.messages = [workingCard()];
  mocks.getCoworkThreadClient.mockResolvedValue(null);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("R3-F27 回到这一页就读一次进行中的那张卡", () => {
  it("R3-F27 — 切回前台时立刻读一次,不等下一格轮询", async () => {
    await mount();
    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();

    await returnToForeground();

    expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
  });

  it("R3-F27 — 整页从 bfcache 摊开(pageshow persisted)也立刻读一次", async () => {
    await mount();
    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();

    await pageShow(true);

    expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
  });

  it("R3-F27 — 首次加载那一声 pageshow(persisted 为 false)不读", async () => {
    await mount();

    await pageShow(false);

    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();
  });

  it("R3-F27 — 这条对话已经全是终态时,回到前台不再多发一次请求", async () => {
    mocks.chat.messages = [workingCard(), settledResult()];
    await mount();

    await returnToForeground();
    await pageShow(true);

    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();
  });

  it("R3-F27 — 快轮烧完之后切回来:那句「太久了」还在,读照样补一次(档位不被拨回去)", async () => {
    // 这一条钉的是**钱的话不许被一次切标签页抹掉**。修之前补读无条件调
    // `rearmGenerationPoll()`,档位打回快轮 ⇒ `pollGaveUp` 翻假 ⇒ 「This is taking longer
    // than usual. Your credits for this are on hold…」当场换回「Otto is making this」,
    // 商家于是重新从头等一轮 —— 我们把自己已经承认的「等太久了」悄悄收了回去。
    vi.useFakeTimers();
    try {
      await mount();
      expect(screenText()).toContain(WORKING_LINE);
      expect(screenText()).not.toContain(DELAYED_LINE);

      // 把快轮的额度烧光 —— 到顶那一格由 `nextSyncPhase` 把档位交给慢轮。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_GEAR_MS);
      });
      expect(screenText()).toContain(DELAYED_LINE);

      mocks.getCoworkThreadClient.mockClear();
      await returnToForeground();

      // 读照补(这才是本票要的那一下)……
      expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
      // ……但那句话原地不动:能把窗口拨回快轮的只有商家自己按的「Check again」。
      expect(screenText()).toContain(DELAYED_LINE);
      expect(screenText()).not.toContain(WORKING_LINE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3-F27 — 切**走**那一声(visibilityState 是 hidden)不读", async () => {
    // `visibilityState !== "visible"` 那道闸此前一条测试都没有:切走也会敲一声
    // `visibilitychange`,而看不见的那一页读回来的东西没有人在看。
    await mount();

    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mocks.getCoworkThreadClient).not.toHaveBeenCalled();
  });

  it("R3-F27 — bfcache 摊开连敲两声,一次返回也只读一次", async () => {
    await mount();

    await bfcacheRestore();

    expect(mocks.getCoworkThreadClient).toHaveBeenCalledTimes(1);
  });

  it("R3-F27 — 同一单反复切回来,快档额度照常走完:那句「额度冻结」照样会到", async () => {
    // 这一条钉的是**那句钱的话一定会来**。重臂会 bump `pollNonce`,bounded poll 的
    // `pollCount` 随之归零 —— 若每次切回来都重臂,一个每隔一分半回来看一眼的商家就把快档
    // 那 2 分钟无限往后推,慢档永远到不了,「This is taking longer than usual. Your
    // credits for this are on hold…」永远不出现。同一句话,换一种方式弄没了。
    //
    // 时间线(快档 2.5s × 48 = 120s):
    //   t=0      挂载,快档开跑
    //   t=60s    第一次切回 ⇒ 允许重臂一次(把后台白烧的额度还它一次),额度从这里重新数
    //   t=120s   第二次切回 ⇒ 只补读,不重臂
    //   t=185s   自第一次重臂起已走 125s > 120s ⇒ 档位交给慢档,那句话上屏
    // 没有这道闸:第二次切回把额度推到 t=240s 才到顶,t=185s 这一刻屏幕上还是「Otto is
    // making this」—— 这一条当场红。
    vi.useFakeTimers();
    try {
      await mount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await returnToForeground();
      expect(screenText()).not.toContain(DELAYED_LINE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      mocks.getCoworkThreadClient.mockClear();
      await returnToForeground();
      // 补读照旧每次都发 —— 被卡住的只有重臂,不是那一下读。
      expect(mocks.getCoworkThreadClient).toHaveBeenCalledWith(THREAD_ID);
      expect(screenText()).not.toContain(DELAYED_LINE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });

      expect(screenText()).toContain(DELAYED_LINE);
      expect(screenText()).not.toContain(WORKING_LINE);
    } finally {
      vi.useRealTimers();
    }
  });
});
