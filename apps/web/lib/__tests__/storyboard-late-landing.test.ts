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

// #782 r11(判官 r10)—— sync 现在回的是**每镜头两格的权威状态**。测试里照着服务端会算出
// 什么去写,不再拼那三格有损信号。
type Status =
  | { kind: "absent" }
  | { kind: "queued" }
  | { kind: "generating" }
  | { kind: "done"; generationId: string; url?: string }
  | { kind: "dead" };
type Ref = { generationId: string; url?: string };

function slot(status: Status, previous?: Ref) {
  return previous ? { status, previous } : { status };
}
const absent = { status: { kind: "absent" as const } };
function done(generationId: string, url?: string) {
  return { status: url ? { kind: "done" as const, generationId, url } : { kind: "done" as const, generationId } };
}

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
            shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: absent }],
          }
        : {
            payload,
            // 服务端:这条作业还活着
            shots: [{ shotId: "s0", frame: slot({ kind: "generating" }), video: absent }],
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
            shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: absent }],
          }
        : // 作业已经 DONE、却什么产出都指不出来(那条聊天消息没写成)—— 服务端如实说「这一格
          // 没有东西」,而不是把它说成还在跑。
          { payload, shots: [{ shotId: "s0", frame: absent, video: absent }] },
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
      shots: [
        // 服务端:这条片子这一生结束了(死片没有产出,永远不会有)
        { shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: slot({ kind: "dead" }) },
        { shotId: "s1", frame: done("gen_1", "/media/gen_1.png"), video: absent },
      ],
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
    // r11:确认之后卡面显示什么,来自**服务端下一句话** —— 花钱调用一返回,那条作业就在库里,
    // startPolling 立刻问一次。这里如实模拟:发起后 sync 改口说「在跑」。
    const started = { yes: false };
    mocks.coworkGenerate.mockImplementation(async () => {
      started.yes = true;
      return { id: "job_retry" };
    });
    mocks.syncStoryboardMedia.mockImplementation(async () => ({
      payload,
      shots: [
        { shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: started.yes ? slot({ kind: "queued" }) : slot({ kind: "dead" }) },
        { shotId: "s1", frame: done("gen_1", "/media/gen_1.png"), video: absent },
      ],
    }));

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
    // (r11 措辞收敛成两句:没有旧产出 = "Generating video…",有旧产出 = "Replacing video…"。)
    expect(text(dom)).toContain("Generating video…");
    expect(
      text(dom),
      "一边说没成功、一边正在重做 —— 卡面自相矛盾",
    ).not.toContain("didn’t go through");
  });

  it("已经有片子的镜头,措辞仍是「替换」(r5/r6 既有行为逐字不变)", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload: { ...payload, shots: [{ ...dead, videoGenerationId: "vgen_0" }, fresh] },
      shots: [
        { shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_0", "/media/vgen_0.mp4") },
        { shotId: "s1", frame: done("gen_1", "/media/gen_1.png"), video: absent },
      ],
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

// ---------------------------------------------------------------------------
// #782 r9(判官 r8)—— 卡面状态收敛成一条纯推导之后,**每一个终态**都要么有内容、
// 要么有一个商家自己走得出去的入口。判官 r8 的三个真渲染探针原样变成用例。
//
// 本段同样只 import 卡面本身(零 r9 新导出),所以它在 r8 的 head(0f85dcea)上如实变红:
// 红的是断言,不是模块解析。
// ---------------------------------------------------------------------------

const VIDEO_TICK = 5000; // VIDEO_SYNC_INTERVAL_MS
const VIDEO_CAP = 120; // VIDEO_SYNC_MAX_TRIES
const SLOW_CAP = 30; // SLOW_SYNC_MAX_TRIES

describe("#782 r9 (判官 r8 P1-①) 慢轮打满之后,不许还在说「视频生成中」", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0", // 花过钱了:片子在跑,一直没结果也一直没被判死
    durationSeconds: 5,
  };
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  beforeEach(() => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload,
      // 服务端从不判它死 —— 卡面永远等得到「还在跑」这个答案
      shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: slot({ kind: "generating" }) }],
    });
  });

  it("151 次之后定时器停了 → 视频不许再转,必须说不再自动查询并留一个手动入口", async () => {
    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );

    // 挂载 1 次 + 快轮 120 次 + 慢轮 30 次 = 151 次,正是判官探针里的那个数。
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);
    expect(text(dom)).toContain("Generating video…");
    for (let i = 0; i < VIDEO_CAP; i++) await tick(VIDEO_TICK);
    for (let i = 0; i < SLOW_CAP; i++) await tick(SLOW_TICK);
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1 + VIDEO_CAP + SLOW_CAP);

    // 定时器确实停了(判官探针 activeTimers=0):再走十分钟,一次都不问。
    await tick(10 * 60 * 1000);
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1 + VIDEO_CAP + SLOW_CAP);

    // 不再问 → 不许再说生成中(判官探针 generatingVideo=true 的那一格)。
    expect(
      text(dom),
      "已经不问了,卡面还在说视频生成中 —— 一个永远不会更新的 spinner",
    ).not.toContain("Generating video…");
    // 而且必须说清楚为什么,并给出自己再查一次的入口。
    expect(text(dom)).toContain("stopped checking");
    const refresh = findButton(dom, "Check for updates");
    expect(refresh, "停了自动查询却没有手动入口 —— 商家彻底走不出去").toBeTruthy();

    // 那个入口真的会再问一次(复用同一条 sync,不是装饰)。
    await act(async () => { refresh!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(2 + VIDEO_CAP + SLOW_CAP);
  });
});

describe("#782 r9 (判官 r8 P1-②) 已经落地的视频,重开页面必须看得见", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0",
    videoGenerationId: "vgen_0", // 已经出片了,商家付过钱
    durationSeconds: 5,
  };
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  it("payload 有 videoGenerationId、本地还没装载 → 挂载就去装载,播放器出现", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload,
      shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_0", "/media/vgen_0.mp4") }],
    });

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );

    expect(
      mocks.syncStoryboardMedia,
      "已落地的媒体一次都不去装载 —— 商家付了钱,重开页面什么都看不到",
    ).toHaveBeenCalledTimes(1);
    const video = dom.querySelector("video");
    expect(video, "已落地的视频没有渲染播放器").toBeTruthy();
    expect(video!.getAttribute("src")).toBe("/media/vgen_0.mp4");
    const img = dom.querySelector("img");
    expect(img, "已落地的首帧也没有渲染").toBeTruthy();
    // 有内容就该有下一步:重出入口回来了。
    expect(findButton(dom, "Remake video"), "已落地的视频没有重出入口").toBeTruthy();
    expect(findButton(dom, "Regenerate frame"), "已落地的首帧没有重出入口").toBeTruthy();
  });
});

describe("#782 r9 (判官 r8 P2) 空的 prepare 结果不许变成一个 0 张图的死确认框", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0", // 子卡在,图还没写回来
  };
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  it("并发落帧使 prepare 返回空 children → 回去等结果,不端出 Generate 0", async () => {
    const state = { landed: false };
    mocks.syncStoryboardMedia.mockImplementation(async () =>
      state.landed
        ? {
            payload: { ...payload, shots: [{ ...shot, firstFrameGenerationId: "gen_0" }] },
            shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: absent }],
          }
        : { payload, shots: [{ shotId: "s0", frame: absent, video: absent }] },
    );
    // 服务端这一刻认为没有任何镜头需要铸新的首帧子卡(那一张刚刚落地)。
    mocks.prepareStoryboardFirstFrames.mockResolvedValue({ children: [], totalCredits: 0 });

    const dom = await mount(
      createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
    );
    await clickByText(dom, "Generate all first frames");

    expect(text(dom), "端出了一个 0 张图的确认框").not.toContain("Generate 0 ");
    expect(findButton(dom, "Confirm — 0"), "确认按钮承诺 0 张图 —— 按下去什么都不会发生").toBeUndefined();
    expect(mocks.coworkGenerate).not.toHaveBeenCalled();

    // 而且回到了等待:帧一落地就自己出现。
    state.landed = true;
    await tick(FRAME_TICK);
    expect(dom.querySelector("img"), "点完之后卡面没有回去等结果").toBeTruthy();
  });
});

describe("#782 r9 铁律:每个终态要么有内容,要么有救援入口", () => {
  const base = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    durationSeconds: 5,
  };

  /** 一个终态一行:卡面上必须找得到「内容」或者「入口」,不存在第三种结局。 */
  const cases: {
    name: string;
    shot: Record<string, unknown>;
    sync: { frame: ReturnType<typeof slot>; video: ReturnType<typeof slot> };
    expect: (dom: HTMLElement) => void;
  }[] = [
    {
      name: "video landed → 播放器(内容)",
      shot: { ...base, videoCardId: "vchild_0", videoGenerationId: "vgen_0" },
      sync: { frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_0", "/media/vgen_0.mp4") },
      expect: (dom) => expect(dom.querySelector("video")).toBeTruthy(),
    },
    {
      name: "video dead → 单镜重试(入口)",
      shot: { ...base, videoCardId: "vchild_0" },
      sync: { frame: done("gen_0", "/media/gen_0.png"), video: slot({ kind: "dead" }) },
      expect: (dom) => expect(findButton(dom, "Try this video again")).toBeTruthy(),
    },
    {
      name: "video 有 generationId 却装载不出来 → 手动刷新(入口)",
      shot: { ...base, videoCardId: "vchild_0", videoGenerationId: "vgen_0" },
      sync: { frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_0") },
      expect: (dom) => expect(findButton(dom, "Check for updates")).toBeTruthy(),
    },
    {
      name: "frame 有 generationId 却装载不出来 → 手动刷新(入口)",
      shot: { ...base, videoCardId: "vchild_0", videoGenerationId: "vgen_0" },
      sync: { frame: done("gen_0"), video: done("vgen_0", "/media/vgen_0.mp4") },
      expect: (dom) => expect(findButton(dom, "Check for updates")).toBeTruthy(),
    },
    {
      name: "video absent(准备卡从未启动)→ 整包入口在,且不假装在跑",
      shot: { ...base, videoCardId: "vchild_0" },
      sync: { frame: done("gen_0", "/media/gen_0.png"), video: absent },
      expect: (dom) => {
        expect(findButton(dom, "Make all videos")).toBeTruthy();
        expect(text(dom)).not.toContain("Generating video…");
      },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const payload = { storyboardTitle: "Raya launch", shots: [c.shot] };
      mocks.syncStoryboardMedia.mockResolvedValue({
        payload,
        shots: [{ shotId: "s0", frame: c.sync.frame, video: c.sync.video }],
      });
      const dom = await mount(
        createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }),
      );
      c.expect(dom);
    });
  }
});

// ---------------------------------------------------------------------------
// #782 r11(判官 r10)—— 三条时序 + 一条钱路,全部真渲染 + 真时钟。
//
// 这四个用例的 sync 桩**同时**返回 r10 的老形状(frames/videos/liveFrameShotIds/
// deadVideoShotIds)和 r11 的权威状态,所以它们在 r10 的 head 上能原样跑起来 —— 卡面按它
// 自己的逻辑消费老形状,红在**断言**上,不是红在模块解析或缺字段崩溃上。
// ---------------------------------------------------------------------------

describe("#782 r11 (判官 r10 P1) 重出的片子:慢轮不许把它丢掉,迟到也要自己落地", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0",
    videoGenerationId: "vgen_0", // 已经有一条片子
    durationSeconds: 5,
  };
  const OLD_URL = "/media/vgen_0.mp4";
  const NEW_URL = "/media/vgen_1.mp4";

  /** 三拍:旧片在 → 新作业在途(旧片仍属于商家)→ 新片落地。 */
  function stub(state: { phase: "old" | "replacing" | "landed" }) {
    mocks.syncStoryboardMedia.mockImplementation(async () => {
      if (state.phase === "old") {
        return {
          payload,
          shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_0", OLD_URL) }],
          // —— r10 老形状(让这条用例能在 r10 的 head 上跑起来)——
          frames: { s0: "/media/gen_0.png" },
          videos: { s0: OLD_URL },
          liveFrameShotIds: [],
          deadVideoShotIds: [],
        };
      }
      if (state.phase === "replacing") {
        const replacing = { ...payload, shots: [{ ...shot, videoCardId: "vchild_new" }] };
        return {
          payload: replacing,
          shots: [
            {
              shotId: "s0",
              frame: done("gen_0", "/media/gen_0.png"),
              // 状态说的是**新作业**,previous 说旧片还在 —— 判官 r10 P1 缺的正是这两个事实。
              video: slot({ kind: "generating" }, { generationId: "vgen_0", url: OLD_URL }),
            },
          ],
          frames: { s0: "/media/gen_0.png" },
          videos: { s0: OLD_URL },
          liveFrameShotIds: [],
          deadVideoShotIds: [],
        };
      }
      const landed = { ...payload, shots: [{ ...shot, videoCardId: "vchild_new", videoGenerationId: "vgen_1" }] };
      return {
        payload: landed,
        shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: done("vgen_1", NEW_URL) }],
        frames: { s0: "/media/gen_0.png" },
        videos: { s0: NEW_URL },
        liveFrameShotIds: [],
        deadVideoShotIds: [],
      };
    });
  }
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  it("确认重出 → 快轮 120 打满 → 慢轮接手 → 迟到的新片自己落地,全程只收一次钱", async () => {
    const state: { phase: "old" | "replacing" | "landed" } = { phase: "old" };
    stub(state);
    mocks.regenShotVideoCard.mockResolvedValue({
      child: { shotId: "s0", childCardId: "vchild_new", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: false },
    });
    mocks.coworkGenerate.mockImplementation(async () => {
      state.phase = "replacing"; // 钱花出去了,作业进了库 —— 服务端从这一刻开始这么回答
      return { id: "job_new" };
    });

    const dom = await mount(createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }));
    expect(dom.querySelector("video")!.getAttribute("src")).toBe(OLD_URL);

    // ① 确认重出(唯一一次付费)。
    await clickByText(dom, "Remake video");
    await clickByText(dom, "Confirm — replace");
    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(1);

    // ② 旧片继续显示,卡面说清楚正在替换 —— 而且**没有第二次付费的入口**。
    expect(dom.querySelector("video")!.getAttribute("src"), "替换在途时把商家的旧片藏了").toBe(OLD_URL);
    expect(text(dom)).toContain("Replacing video…");
    expect(findButton(dom, "Remake video"), "替换还在跑就把重出按钮放回来 —— 同一次替换可以被收两次钱").toBeUndefined();
    expect(text(dom)).not.toContain("This will spend real credits");

    const afterConfirm = mocks.syncStoryboardMedia.mock.calls.length;

    // ③ 快轮 120 次全部用完(十分钟),新片一直没到。
    for (let i = 0; i < VIDEO_CAP; i++) await tick(VIDEO_TICK);
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(afterConfirm + VIDEO_CAP);

    // ④ 到顶之后确实降了频(再走一个快轮周期,一次都不问)。
    await tick(VIDEO_TICK);
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(afterConfirm + VIDEO_CAP);

    // ⑤ 慢轮到点还在问 —— r10 在这里直接收工,迟到的付费替换从此不可达。
    await tick(SLOW_TICK);
    expect(
      mocks.syncStoryboardMedia,
      "快轮转慢轮时把重出这件事丢了 —— 迟到的付费替换永远不会显示",
    ).toHaveBeenCalledTimes(afterConfirm + VIDEO_CAP + 1);

    // ⑥ 引擎这一刻交货,商家什么都没做,新片自己换上去。
    state.phase = "landed";
    await tick(SLOW_TICK);
    expect(dom.querySelector("video")!.getAttribute("src"), "迟到的替换没有落地").toBe(NEW_URL);
    expect(text(dom)).not.toContain("Replacing video…");
    expect(findButton(dom, "Remake video"), "落地之后重出入口该回来了").toBeTruthy();
    // 全程只花过一次钱。
    expect(mocks.coworkGenerate).toHaveBeenCalledTimes(1);
  });

  it("陈旧的一屏上再点一次重出:服务端端回在途那一张 → 不开确认框、不再花钱、回去等结果", async () => {
    // 商家这一屏还显示着旧片(另一个标签页刚刚发起过替换,这一屏还不知道)。
    const state: { phase: "old" | "replacing" | "landed" } = { phase: "old" };
    stub(state);
    // 服务端守卫(isUnconsumedInFlight)的答复:在途那一张,spent —— 不铸新卡。
    mocks.regenShotVideoCard.mockImplementation(async () => {
      state.phase = "replacing"; // 服务端从这一刻起如实回答:那条作业在跑
      return {
        child: { shotId: "s0", childCardId: "vchild_new", estimatedCredits: 20, structuredPrompt: "v-0", entityIds: [], spent: true },
      };
    });

    const dom = await mount(createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }));
    await clickByText(dom, "Remake video");

    expect(mocks.regenShotVideoCard).toHaveBeenCalledTimes(1);
    expect(
      text(dom),
      "同一次替换已经付过钱了,卡面还端出一个「这会花掉真实积分」的确认框",
    ).not.toContain("This will spend real credits");
    expect(findButton(dom, "Confirm — replace"), "在途的替换不该有第二个确认按钮").toBeUndefined();
    expect(mocks.coworkGenerate, "同一次替换被收了第二次钱").not.toHaveBeenCalled();
    // 而且卡面回到了等待:旧片仍在,一句话说清楚正在替换。
    expect(dom.querySelector("video")!.getAttribute("src")).toBe(OLD_URL);
    expect(text(dom)).toContain("Replacing video…");
  });
});

describe("#782 r11 (判官 r10 P2) 准备卡取消后重开页面:诚实的「什么都没在跑」", () => {
  const shot = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0", // 准备过一次视频,商家按了 Cancel —— 一分钱没花,作业从未存在
    durationSeconds: 5,
  };
  const payload = { storyboardTitle: "Raya launch", shots: [shot] };

  it("服务端说这张子卡从来没有作业 → 不转假 spinner、不空转轮询,整包入口在", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload,
      shots: [{ shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: absent }],
      // —— r10 老形状:它没有「作业缺席」这个词,只能报「没被判死」,于是卡面推成生成中 ——
      frames: { s0: "/media/gen_0.png" },
      videos: {},
      liveFrameShotIds: [],
      deadVideoShotIds: [],
    });

    const dom = await mount(createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }));

    expect(
      text(dom),
      "什么都没在跑,卡面却说正在生成 —— 一个凭空的进度条",
    ).not.toContain("Generating video…");
    expect(findButton(dom, "Make all videos"), "诚实的空态必须配一个入口").toBeTruthy();

    // 而且不许空转轮询:挂载问过一次之后,十分钟内一次都不再问。
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);
    await tick(10 * 60 * 1000);
    expect(mocks.syncStoryboardMedia, "对着一个不存在的作业轮询").toHaveBeenCalledTimes(1);
  });
});

describe("#782 r11 (判官 r10 P2) 不再自动查询,也不许忘记服务端已经确证的死片", () => {
  const running = {
    shotId: "s0",
    index: 0,
    title: "Hero",
    firstFramePrompt: "ff-0",
    videoPrompt: "v-0",
    firstFrameCardId: "child_0",
    firstFrameGenerationId: "gen_0",
    videoCardId: "vchild_0", // 一直在跑,永远不落地 —— 它会把整卡的轮询额度耗尽
    durationSeconds: 5,
  };
  const deadShot = {
    shotId: "s1",
    index: 1,
    title: "Detail",
    firstFramePrompt: "ff-1",
    videoPrompt: "v-1",
    firstFrameCardId: "child_1",
    firstFrameGenerationId: "gen_1",
    videoCardId: "vchild_1", // 服务端确证:这条片子这一生结束了
    durationSeconds: 5,
  };
  const payload = { storyboardTitle: "Raya launch", shots: [running, deadShot] };

  it("A 耗尽额度进 exhausted,B 的死片仍然说实话、单镜救援按钮还在", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue({
      payload,
      shots: [
        { shotId: "s0", frame: done("gen_0", "/media/gen_0.png"), video: slot({ kind: "generating" }) },
        { shotId: "s1", frame: done("gen_1", "/media/gen_1.png"), video: slot({ kind: "dead" }) },
      ],
      // —— r10 老形状 ——
      frames: { s0: "/media/gen_0.png", s1: "/media/gen_1.png" },
      videos: {},
      liveFrameShotIds: [],
      deadVideoShotIds: ["s1"],
    });

    const dom = await mount(createElement(StoryboardCard, { cardId: "sb_1", payload, balanceUsd: 10 }));
    // 挂载即进入观察窗(A 有活作业),单镜按钮按既有规矩在观察期间收起;但事实照说不误。
    expect(text(dom)).toContain("That video didn’t go through — you weren’t charged.");

    // 把整卡的额度耗尽:快轮 120 + 慢轮 30。
    for (let i = 0; i < VIDEO_CAP; i++) await tick(VIDEO_TICK);
    for (let i = 0; i < SLOW_CAP; i++) await tick(SLOW_TICK);

    // A:不再自动查询 —— 诚实降级 + 通用入口。
    expect(text(dom)).toContain("stopped checking");
    expect(findButton(dom, "Check for updates")).toBeTruthy();
    // B:服务端已经确证的事实不许被相位覆盖(判官 r10 P2 的判定次序)。
    expect(text(dom), "已经确证死了的片子被相位改写成「不知道」").toContain(
      "That video didn’t go through — you weren’t charged.",
    );
    expect(
      findButton(dom, "Try this video again"),
      "不再自动查询就把死片的单镜救援按钮也一起藏了 —— 那条路服务端一直都在",
    ).toBeTruthy();
  });
});
