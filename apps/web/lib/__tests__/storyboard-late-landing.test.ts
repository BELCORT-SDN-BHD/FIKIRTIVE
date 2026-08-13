// @vitest-environment jsdom
/**
 * #782 r7 —— 判官 r6 的两条 UI 时序 P1,逐拍钉死在**真的渲染 + 真的时钟**上。
 *
 * 判官 r6 两次都不是逻辑判错,而是**时序**判错:每一拍单独看都对,连起来商家就走进死路。
 * 所以这一份不测「函数返回什么」,而是把两条时序原样走一遍 —— 挂一次卡、推真实的时钟、
 * 点真实的按钮,断言商家在屏幕上看得见什么。
 *
 *   P1-A 迟到的付费帧:轮询 40×3s 到顶 → 引擎晚一步交货 → **不重挂载**,帧必须自己落地。
 *        r6 的时序:到顶只清 spinner 就收工;挂载 sync 一次性;Generate all 复用一张已花钱
 *        的子卡会得到空的待发起集合、同样不重启轮询。于是「引擎晚一步」变成「商家付了钱、
 *        产出躺在库里、卡面永远不显示」,只有重开页面才解得开。
 *
 *   P1-B 死掉的片子:单镜救援必须可达。r6 把单镜按钮挂在 `videoUrl` 上,而死片永远没有
 *        url,于是唯一的路是「Make all videos」——两镜一起报价,余额只够救那一镜时整包
 *        确认是灰的。能力在服务端存在(regenShotVideoCard 只要求这一镜有首帧),界面上不可达。
 *
 * 红/绿:本文件只 import 卡面本身,不 import 任何 r7 新增的导出 —— 所以它能原样跑在 r6 的
 * head(4ded10a4)上并如实变红,红的是断言,不是模块解析。
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coworkGenerate: vi.fn(),
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
  setStoryboardContinuity: vi.fn(),
}));

vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));
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
  setStoryboardContinuity: mocks.setStoryboardContinuity,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

/** Push the clock forward and let every promise the timers woke up settle. */
async function tick(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await Promise.resolve(); });
}

function findButton(dom: HTMLElement, startsWith: string): HTMLButtonElement | undefined {
  return Array.from(dom.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(startsWith),
  );
}

async function clickByText(dom: HTMLElement, startsWith: string): Promise<void> {
  const button = findButton(dom, startsWith);
  expect(button, `no button starting with "${startsWith}"`).toBeTruthy();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
}

/** Everything the card renders, whitespace-normalised, for plain-language assertions. */
function text(dom: HTMLElement): string {
  return (dom.textContent ?? "").replace(/\s+/g, " ");
}

const FRAME_TICK = 3000; // FRAME_SYNC_INTERVAL_MS
const FRAME_CAP = 40; // FRAME_SYNC_MAX_TRIES
const SLOW_TICK = 60000; // the second gear r7 adds

// ---------------------------------------------------------------------------
// P1-A —— 「到顶」不等于「放弃」
// ---------------------------------------------------------------------------
describe("#782 r7 (判官 r6 P1-A) 迟到的付费帧自己落地,不必重开页面", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0", // 花过钱了:子卡在,图还没到
  };
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  /** 引擎还没交货 / 已经交货,两种 sync 答复。切换 `landed` 就等于「引擎这一刻交货了」。 */
  function stubSync(state: { landed: boolean }) {
    mocks.syncStoryboardMedia.mockImplementation(async () =>
      state.landed
        ? {
            payload: { ...payload, shots: [{ ...shot, firstFrameGenerationId: "gen_0" }] },
            frames: { s0: "/media/gen_0.png" },
            videos: {},
            liveFrameShotIds: [],
            deadVideoShotIds: [],
          }
        : {
            payload,
            frames: {},
            videos: {},
            liveFrameShotIds: ["s0"], // 服务端:这条作业还活着
            deadVideoShotIds: [],
          },
    );
  }

  it("轮询到顶 → 引擎晚一步交货 → 帧自动落地(同一次挂载,零用户操作)", async () => {
    const state = { landed: false };
    stubSync(state);

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );

    // 拍 1:挂载那一次 reconcile。服务端说作业还活着 → 进入快轮。
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);
    expect(text(dom)).toContain("Generating first frame");

    // 拍 2:快轮 40 次全部用完(约两分钟),引擎一直没交货。
    for (let i = 0; i < FRAME_CAP; i++) await tick(FRAME_TICK);
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1 + FRAME_CAP);

    // 拍 3:到顶之后确实降了频 —— 再走一个快轮周期,一次都不问。
    await tick(FRAME_TICK);
    expect(
      mocks.syncStoryboardMedia,
      "到顶之后还在按快轮的节奏问 —— 降频没生效",
    ).toHaveBeenCalledTimes(1 + FRAME_CAP);

    // 拍 4:引擎这一刻交货了(付了钱的产出已经在库里,服务端权威回退保证它可达)。
    state.landed = true;

    // 拍 5:慢轮到点再问一次 —— 这一问就是 r6 缺的那条路径。
    await tick(SLOW_TICK);
    expect(
      mocks.syncStoryboardMedia,
      "到顶就再也不问了:迟到的付费帧只有重开页面才看得见",
    ).toHaveBeenCalledTimes(2 + FRAME_CAP);

    // 拍 6:商家什么都没做、页面也没重开,图自己出现在卡上。
    const img = dom.querySelector("img");
    expect(img, "迟到的帧没有落地 —— 商家付了钱,卡面永远不显示").toBeTruthy();
    expect(img!.getAttribute("src")).toBe("/media/gen_0.png");
    expect(text(dom)).not.toContain("Generating first frame");
  });

  it("帧一落地就真的收工:之后再走十分钟,一次都不再问", async () => {
    const state = { landed: true };
    stubSync(state);

    await mount(createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }));
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);

    await tick(10 * 60 * 1000);
    expect(
      mocks.syncStoryboardMedia,
      "已终局的卡还在轮询 —— 慢轮变成了一个停不下来的定时器",
    ).toHaveBeenCalledTimes(1);
  });

  it("Generate all 遇到「整份都已经花过钱」→ 回去等结果,而不是端出一个 0 积分的确认框", async () => {
    const state = { landed: false };
    // 服务端这一刻的答复:作业不再活着(它已经 DONE,只是那条聊天消息没写成),
    // 所以卡面停了轮询、把入口还给了商家 —— 判官 r6 时序的起点。
    mocks.syncStoryboardMedia.mockImplementation(async () =>
      state.landed
        ? {
            payload: { ...payload, shots: [{ ...shot, firstFrameGenerationId: "gen_0" }] },
            frames: { s0: "/media/gen_0.png" },
            videos: {},
            liveFrameShotIds: [],
            deadVideoShotIds: [],
          }
        : { payload, frames: {}, videos: {}, liveFrameShotIds: [], deadVideoShotIds: [] },
    );
    // 那张子卡已经花过钱 —— 服务端如实报 spent,一分钱都不该再收。
    mocks.prepareStoryboardFirstFrames.mockResolvedValue({
      children: [
        { shotId: "s0", childCardId: "child_0", estimatedCredits: 4, structuredPrompt: "ff-0", entityIds: [], spent: true },
      ],
      totalCredits: 0,
    });

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);

    await clickByText(dom, "Generate all first frames");

    // 不许出现「Generate 0 frames for 0 credits」这种按下去什么都不发生的确认框。
    expect(text(dom), "端出了一个 0 积分的确认框").not.toContain("Generate 0 frames");
    expect(
      findButton(dom, "Confirm — 0"),
      "确认按钮承诺 0 张图 —— 按下去什么都不会发生",
    ).toBeUndefined();
    // 一分钱都没有被花掉:这一次点击本来就只是「再问一次」。
    expect(mocks.coworkGenerate).not.toHaveBeenCalled();

    // 而且卡面回到了等待:引擎交货的那一刻,图自己出现。
    state.landed = true;
    await tick(FRAME_TICK);
    const img = dom.querySelector("img");
    expect(img, "点完 Generate all 之后卡面没有回去等结果 —— 商家走进死路").toBeTruthy();
    expect(img!.getAttribute("src")).toBe("/media/gen_0.png");
  });
});

// ---------------------------------------------------------------------------
// P1-B —— 死掉的片子,单镜救得回来
// ---------------------------------------------------------------------------
describe("#782 r7 (判官 r6 P1-B) 死掉的片子有一个单镜的入口,和整包互不阻塞", () => {
  const dead = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0", // 发起过一次,那一次什么都没交出来
    durationSeconds: 5,
  };
  const fresh = {
    shotId: "s1",
    index: 1,
    title: "Detail",
    firstFramePrompt: "ff-1",
    videoPrompt: "v-1",
    firstFrameCardId: "child_1",
    firstFrameGenerationId: "gen_1",
    durationSeconds: 5,
  };
  const payload = { storyboardTitle: "Raya launch", shots: [dead, fresh] };

  beforeEach(() => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload,
      frames: { s0: "/media/gen_0.png", s1: "/media/gen_1.png" },
      videos: {}, // 死片没有 url,永远不会有
      liveFrameShotIds: [],
      deadVideoShotIds: ["s0"], // 服务端:这条片子这一生结束了
    });
  });

  /** 钱包里恰好 20 积分 = 一条片子的钱。整包要 40。 */
  const ONE_CLIP_BALANCE_USD = 2;

  it("死片渲染单镜重试入口,并说实话(不再把商家推去整包按钮)", async () => {
    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: ONE_CLIP_BALANCE_USD }),
    );

    expect(text(dom)).toContain("That video didn’t go through — you weren’t charged.");
    expect(
      text(dom),
      "还在把商家推去整包按钮 —— 而那个按钮此刻正好是灰的",
    ).not.toContain("Make all videos to try this shot again");
    expect(
      findButton(dom, "Try this video again"),
      "死片没有单镜入口:界面上根本到不了那条服务端已经具备的救援路径",
    ).toBeTruthy();
    // 死片不许再转圈(r5 的资产,一行不退)。
    expect(text(dom)).not.toContain("Generating video…");
  });

  it("余额只够一镜:整包确认是灰的,单镜救援照样点得下去、真的发起", async () => {
    mocks.prepareStoryboardVideos.mockResolvedValue({
      children: [
        { shotId: "s0", childCardId: "vchild_retry", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: false },
        { shotId: "s1", childCardId: "vchild_1", estimatedCredits: 20, structuredPrompt: "v-1", entityIds: [], spent: false },
      ],
      totalCredits: 40,
    });
    mocks.regenShotVideoCard.mockResolvedValue({
      child: { shotId: "s0", childCardId: "vchild_retry", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: false },
    });
    mocks.coworkGenerate.mockResolvedValue({ status: "queued" });

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: ONE_CLIP_BALANCE_USD }),
    );

    // ① 整包这条路:两镜一起报价,钱不够 → 确认被禁用。这是判官描述的那堵墙。
    await clickByText(dom, "Make all videos");
    const packConfirm = findButton(dom, "Confirm — 2 clips");
    expect(packConfirm, "整包确认按钮不见了").toBeTruthy();
    expect(packConfirm!.disabled, "余额够两镜?这条时序的前提就不成立了").toBe(true);
    await clickByText(dom, "Cancel");

    // ② 单镜这条路:同一张卡上,只为这一镜报价,点得下去。
    await clickByText(dom, "Try this video again");
    expect(mocks.regenShotVideoCard).toHaveBeenCalledWith({ cardId: "sb_1", shotId: "s0" });
    expect(text(dom)).toContain("Make this video — 20 credits?");

    const oneShotConfirm = findButton(dom, "Confirm — make video");
    expect(oneShotConfirm, "单镜确认按钮不见了").toBeTruthy();
    expect(
      oneShotConfirm!.disabled,
      "整包买不起就把单镜救援也一起锁死 —— 两条路必须互不阻塞",
    ).toBe(false);

    await act(async () => { oneShotConfirm!.click(); });
    await act(async () => { await Promise.resolve(); });

    // 花的是那张**新铸的**子卡(新的幂等域),而不是那条死作业。
    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.coworkGenerate.mock.calls[0][0]).toMatchObject({ cardId: "vchild_retry" });

    // ③ 发起之后卡面不许还在说「那条片子没成功」——它正在被重做。
    expect(text(dom)).toContain("Making video…");
    expect(
      text(dom),
      "一边说没成功、一边正在重做 —— 卡面自相矛盾",
    ).not.toContain("didn’t go through");
  });

  it("已经有片子的镜头,措辞仍是「替换」(r5/r6 既有行为逐字不变)", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload: { ...payload, shots: [{ ...dead, videoGenerationId: "vgen_0" }, fresh] },
      frames: { s0: "/media/gen_0.png", s1: "/media/gen_1.png" },
      videos: { s0: "/media/vgen_0.mp4" },
      liveFrameShotIds: [],
      deadVideoShotIds: [],
    });
    mocks.regenShotVideoCard.mockResolvedValue({
      child: { shotId: "s0", childCardId: "vchild_new", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: false },
    });

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );

    expect(findButton(dom, "Remake video"), "已有片子的镜头丢了重出按钮").toBeTruthy();
    await clickByText(dom, "Remake video");
    expect(text(dom)).toContain("Replace this video — 20 credits?");
    expect(findButton(dom, "Confirm — replace")).toBeTruthy();
  });
});
