// @vitest-environment jsdom
/**
 * creation-quote-version-storyboard-card —— 分镜卡那两个付费点也交回「他按下的是哪一版报价」。
 *
 * 规格 `docs/specs/creation-engine.md` §5 :170（FSE-012，Founder 2026-09-10 裁 #1307）。追溯
 * 落在那条变更登记行上，不认领任何 CREATE- 编号（理由与本片其余测试同一把尺子，见 PR #1333）。
 *
 * 判官第 3 轮 P2-d —— 这道闸在服务端是「带了就必须对得上，没带就放行」。所以每一个漏掉这一格
 * 的付费入口都是一个静默的绕行口：商家在那里仍旧能拿一份过期报价点下去，服务端一个字也不会说。
 *
 * FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 分镜首帧合成全退场,闸①(首帧那两个
 * 付费点)随之整段报废删除;原「四个付费点」（`StoryboardCard.tsx` 逐个标着 SPEND SITE n/4）
 * 现在是**两个**（SPEND SITE n/2,均在闸②/视频那一侧）。本文件同步改写:原「Generate all
 * first frames」批量确认（1/4）与它的过期重刷用例改钉「Make all videos」（现在的 1/2）;原
 * 「服务端没给版本」用例同样改钉视频那一侧;逐镜重出（2/2）继续只由文件末尾那条源码闸兜住,
 * 不需要替代覆盖（那段的完整渲染路径与本文件其余用例同族,零覆盖流失）。
 *
 * 与抽屉里那张卡不同的一点：**子卡的完整 payload 从不下发给浏览器**（`model` 是供应商机密），
 * 浏览器无从自己算这一串，只能收下服务端铸卡那一刻算好、随子卡交上来的那一份。所以这里钉的是
 * 「服务端给的哪一串，点下去交回去的就是哪一串」—— 不许在客户端另算一份，也不许丢掉。
 * （「服务端那一串算得对不对」由 `storyboard-gate1-actions.test.ts` 的同族三条钉，那里比对的是
 * 真正写进库的那一份 payload。）
 *
 * 纯前端：两个 Server Action 都是替身，这里不预扣、不结算、不调 provider。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTE_VERSION_STALE, cardQuoteVersion } from "@fikirtive/core/quote-version";

const mocks = vi.hoisted(() => ({
  syncStoryboardMedia: vi.fn(),
  getStoryboardVideoOptions: vi.fn(),
  prepareStoryboardVideos: vi.fn(),
  regenShotVideoCard: vi.fn(),
  editShotPrompt: vi.fn(),
  addShot: vi.fn(),
  deleteShot: vi.fn(),
  reorderShots: vi.fn(),
  coworkGenerate: vi.fn(),
}));

vi.mock("@/lib/storyboard-gate1-actions", () => ({
  prepareStoryboardVideos: mocks.prepareStoryboardVideos,
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
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

const CARD_ID = "card-1";
const SHOT_ID = "shot-1";

/** 一镜、什么都还没做 —— 唯一的那道闸(视频)看得见(videoEligibleCount 1)。 */
function videolessPayload() {
  return {
    storyboardTitle: "Kaya jar launch",
    continuity: false,
    shots: [{ shotId: SHOT_ID, index: 0, videoPrompt: "slow push in", entityIds: [] }],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderCard(payload: unknown): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(StoryboardCard, { cardId: CARD_ID, payload, balanceUsd: 100 }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function findButton(text: string): HTMLButtonElement {
  const el = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(el, `卡面上找不到写着「${text}」的按钮`).toBeTruthy();
  return el!;
}

async function click(text: string): Promise<void> {
  const button = findButton(text);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
  // 挂载时那一趟 sync：答一句「没有活作业」，卡面就停在可操作状态。
  mocks.syncStoryboardMedia.mockResolvedValue({
    payload: videolessPayload(),
    shots: [{ shotId: SHOT_ID, frame: { status: { kind: "absent" } }, video: { status: { kind: "absent" } } }],
  });
  mocks.coworkGenerate.mockResolvedValue({ id: "job-1" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("creation §5 :170 FSE-012 分镜卡的付费点交回报价版本", () => {
  it("creation §5 :170 FSE-012 「Make all videos」确认之后:服务端给的那一串原样交回去(SPEND SITE 1/2)", async () => {
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        {
          shotId: SHOT_ID,
          childCardId: "child-video-1",
          estimatedCredits: 20,
          structuredPrompt: "slow push in",
          entityIds: [],
          // 服务端铸卡那一刻算好的那一串(浏览器算不出来:子卡 payload 从不下发)。
          quoteVersion: "qv-video-server-side",
          spent: false,
        },
      ],
      totalCredits: 20,
    });
    await renderCard(videolessPayload());

    await click("Make all videos");
    await click("Confirm —");

    expect(mocks.coworkGenerate, "确认之后没有任何一次生成请求发出").toHaveBeenCalledTimes(1);
    expect(mocks.coworkGenerate.mock.calls[0][0]).toMatchObject({
      cardId: "child-video-1",
      // 这一格漏了,服务端那道闸按「缺席＝放行」让开 —— 商家又能拿一份过期报价点下去。
      quoteVersion: "qv-video-server-side",
    });
  });

  it("creation §5 :170 FSE-012 服务端没给版本的那一张子卡:交回去的也是缺席,不在客户端现编一串", async () => {
    // 老卡(这道闸出现之前铸的子卡)身上没有这一格。客户端手上只有被 DTO 剥过的东西,
    // 自己算一串必然与库里那张卡对不上 —— 那是把一次合法的批准变成一次拒绝。缺席就该缺席。
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        {
          shotId: SHOT_ID,
          childCardId: "child-video-legacy",
          estimatedCredits: 20,
          structuredPrompt: "slow push in",
          entityIds: [],
          spent: false,
        },
      ],
      totalCredits: 20,
    });
    await renderCard(videolessPayload());

    await click("Make all videos");
    await click("Confirm —");

    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.coworkGenerate.mock.calls[0][0].quoteVersion).toBeUndefined();
  });
});

/**
 * 验收 R2 —— 分镜卡的批准键上，「拒绝并刷新」的**后半句**。
 *
 * 从前这个入口只做到「拒绝」：那一句被当成第 n 帧的失败写进红框，而卡面上那一镜仍写着旧价，
 * 商家除了对着同一个旧数字再按一次之外无路可走。这一条钉的是另一半：服务端交回来的新报价
 * 当场回到确认框里（价 ＋ 那一串版本），没漂的那几镜照常生成，整批不中止，并且商家被告知
 * 换价的是**哪几镜**。
 */
describe("creation §5 :170 FSE-012 验收 R2 分镜卡:拒绝逐镜刷新,整批不中止", () => {
  /** 服务端拒绝时交回的那一份（已过 `genCardPayloadDTO` 剥离:无型号、无 reason）。 */
  const REFRESHED_VIDEO_QUOTE = {
    kind: "video",
    params: { durationSeconds: 5, count: 1 },
    structuredPrompt: "slow push in",
    entityIds: [],
    variantSel: {},
    estimatedCredits: 24,
  };

  it("creation §5 :170 FSE-012 R2 两镜里一镜报价过期:另一镜照常生成,过期那一镜换成新价并说清是哪一镜", async () => {
    const twoShots = {
      storyboardTitle: "Kaya jar launch",
      continuity: false,
      shots: [
        { shotId: "shot-1", index: 0, videoPrompt: "v1", entityIds: [] },
        { shotId: "shot-2", index: 1, videoPrompt: "v2", entityIds: [] },
      ],
    };
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload: twoShots,
      shots: [
        { shotId: "shot-1", frame: { status: { kind: "absent" } }, video: { status: { kind: "absent" } } },
        { shotId: "shot-2", frame: { status: { kind: "absent" } }, video: { status: { kind: "absent" } } },
      ],
    });
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        { shotId: "shot-1", childCardId: "child-1", estimatedCredits: 20, structuredPrompt: "v1", entityIds: [], quoteVersion: "qv-stale", spent: false },
        { shotId: "shot-2", childCardId: "child-2", estimatedCredits: 20, structuredPrompt: "v2", entityIds: [], quoteVersion: "qv-fresh", spent: false },
      ],
      totalCredits: 40,
    });
    mocks.coworkGenerate
      .mockResolvedValueOnce({ error: QUOTE_VERSION_STALE, quote: REFRESHED_VIDEO_QUOTE })
      .mockResolvedValueOnce({ id: "job-2" });
    await renderCard(twoShots);

    await click("Make all videos");
    await click("Confirm —");

    // ① 整批没有停在第一镜:第二镜真的被送出去了。
    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(2);
    expect(mocks.coworkGenerate.mock.calls[1][0]).toMatchObject({ cardId: "child-2" });
    // ② 换价那一镜回到确认框里,写着**新价**(20 → 24 credits),而且只剩它一张。
    expect(container!.textContent).toContain("Confirm — 1 clip");
    expect(container!.textContent).toContain("24 credits");
    // ③ 商家被告知是哪一镜换了价,而且这不是红色的失败框。
    expect(container!.textContent).toContain("Video 1 changed price");
    expect(container!.textContent).not.toContain("Action wasn't completed");
  });

  it("creation §5 :170 FSE-012 R2 换过价之后再确认一次:交回去的是新那一版的报价版本", async () => {
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        { shotId: SHOT_ID, childCardId: "child-video-1", estimatedCredits: 20, structuredPrompt: "slow push in", entityIds: [], quoteVersion: "qv-stale", spent: false },
      ],
      totalCredits: 20,
    });
    mocks.coworkGenerate
      .mockResolvedValueOnce({ error: QUOTE_VERSION_STALE, quote: REFRESHED_VIDEO_QUOTE })
      .mockResolvedValueOnce({ id: "job-1" });
    await renderCard(videolessPayload());

    await click("Make all videos");
    await click("Confirm —");
    await click("Confirm —");

    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(2);
    expect(mocks.coworkGenerate.mock.calls[0][0].quoteVersion).toBe("qv-stale");
    // 第二次交回去的是**服务端刚交回来的那一份**算出来的那一串 —— 不是刚被拒的那一串。
    expect(mocks.coworkGenerate.mock.calls[1][0].quoteVersion).toBe(cardQuoteVersion(REFRESHED_VIDEO_QUOTE));
  });
});

/**
 * 逐镜重出（SPEND SITE 2/2）的确认框要先把 sync 的答复演成「这一镜已经有片子了」
 * 才点得到，而那一段与这道闸无关。它们由这条源码闸兜住：分镜卡里**每一次** `coworkGenerate`
 * 都必须带上这一格。漏一处就是一个静默的绕行口（服务端「缺席＝放行」），而漏一处只需要少写
 * 一个字段。
 */
describe("creation §5 :170 FSE-012 分镜卡两个付费点一处不漏(源码闸)", () => {
  it("creation §5 :170 FSE-012 `StoryboardCard.tsx` 的每一次 coworkGenerate 都带 quoteVersion", () => {
    // jsdom 里 `import.meta.url` 是个 http URL,读文件只能走真路径(与 card-topup-exit 同一条写法)。
    const src = readFileSync(path.resolve(__dirname, "../../components/otto/StoryboardCard.tsx"), "utf8");
    // 一次调用写在一行上,所以按行取 —— 不用括号配对那一套(`variantSel: {}` 会把它带偏)。
    const calls = src.split("\n").filter((line) => line.includes("coworkGenerate({"));
    // FSE-208 之后两个付费点(均在闸②/视频那一侧),`StoryboardCard.tsx` 里逐个标着 SPEND SITE n/2。
    expect(calls, "付费点数量变了 —— 新增或删除一个付费点必须同时改这条闸").toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain("quoteVersion:");
    }
    expect(src.match(/SPEND SITE \d\/2/g) ?? []).toHaveLength(2);
  });
});
