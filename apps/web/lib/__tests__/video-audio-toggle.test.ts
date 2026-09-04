// @vitest-environment jsdom
/**
 * CREATE-A3 —— 视频声音开关,从界面到付费请求。
 *
 * 规格(docs/specs/creation-engine.md 验收表 CREATE-A3):
 *   「商家在视频规格选择器关掉声音开关后生成 ⇒ 交付视频无 AI 配音配乐
 *    (`generate_audio=false` 实发可查);界面明示声音开关不影响报价」
 *
 * 这个文件守的是**前半段的界面到请求这一截**:开关拨掉 ⇒ 付费请求里 `audio: false`;
 * 开关没碰过 ⇒ 与本格出现之前一模一样(服务端默认档);开关怎么拨,屏幕上那个价与请求里
 * 那个价都一格不动。后半段(`audio:false` ⇒ 供应商请求体 `generate_audio:false`)在
 * `packages/generation/src/byteplus-audio.test.ts`,两段接起来才是「实发可查」。
 *
 * 为什么报价那条断言值得单写:声音是全场唯一一个**不改价**的规格格子,而它长得和旁边
 * 三个会改价的格子一模一样。文案上我们对商家承诺了「Sound doesn't change the price」——
 * 承诺要有机器守着,否则哪天报价公式多认一个键,商家就是被一句我们自己写的话骗了。
 *
 * 真组件 + 真 React;只有服务端动作是假件,所以一个积分都花不出去(与
 * asset-detail-image-shape.test.ts 同一套做法)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGeneration: vi.fn(),
  getActiveGenModels: vi.fn(),
  startGen: vi.fn(),
  startAssetGen: vi.fn(),
  getGenJob: vi.fn(),
  setFavorite: vi.fn(),
  saveCroppedGeneration: vi.fn(),
  deleteGeneration: vi.fn(),
}));

vi.mock("@/lib/asset-actions", () => ({
  getGeneration: mocks.getGeneration,
  setFavorite: mocks.setFavorite,
  saveCroppedGeneration: mocks.saveCroppedGeneration,
}));
vi.mock("@/lib/actions", () => ({ deleteGeneration: mocks.deleteGeneration }));
vi.mock("@/lib/gen-actions", () => ({
  startGen: mocks.startGen,
  startAssetGen: mocks.startAssetGen,
  getGenJob: mocks.getGenJob,
  getActiveGenModels: mocks.getActiveGenModels,
}));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({ onChange }: { onChange?: (t: string, ids: string[]) => void }) =>
    createElement("textarea", {
      "data-testid": "edit-input",
      onChange: (e: { target: { value: string } }) => onChange?.(e.target.value, []),
    }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: DetailPanel } = await import("@/components/asset/DetailPanel");
const { VIDEO_AUDIO_PRICE_NOTE } = await import("@/components/gen/VideoSpecPicker");

/** 服务端解析的报价契约(与 asset-detail-image-shape.test.ts 同一份形状)。 */
const MODELS = {
  image: "capability-image-1",
  video: "capability-video-1",
  imageCredits: 8,
  videoCredits: 80,
  // 服务端默认档:声音**开**。这就是「未设 ⇒ 与本格出现之前一模一样」的那个真值。
  videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
  videoAspectRatios: ["16:9", "9:16", "1:1", "adaptive"],
  videoDurations: [5, 12],
  videoResolutions: ["720p", "480p"],
  videoI2vDefaultAspect: "adaptive",
  // 按档价目表 —— 键只有「清晰度:秒数」两维,声音根本不在键里。
  videoCreditsBySpec: { "720p:5": 11, "720p:12": 27, "480p:5": 6, "480p:12": 14 },
  imageAspectRatios: ["1:1", "9:16"],
  imageDefaultAspect: "1:1",
};

const generation = () => ({
  id: "g1",
  projectId: "p1",
  url: "https://cdn.test/g1.png",
  urls: ["https://cdn.test/g1.png"],
  variants: [{ id: "g1", url: "https://cdn.test/g1.png", favorite: false }],
  kind: "image",
  prompt: "a poster for the weekend sale",
  favorite: false,
  sourceGenerationId: null,
  imageAspect: "1:1",
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.getActiveGenModels.mockResolvedValue(MODELS);
  mocks.getGeneration.mockResolvedValue(generation());
  mocks.startAssetGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.getGenJob.mockResolvedValue({ status: "DONE", generationIds: [] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderPanel(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1",
      projectId: "p1",
      onClose: () => {},
      entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/**
 * 资产详情面板的**渲染根**。
 *
 * 前端基线①(纯合并段):新壳把资产详情换成了标准 Sheet 外壳(`components/ui/sheet`),
 * 它走 Portal 挂在 `document.body` 上,**不在**挂载点那一支里 —— 所以主干这份测试原来的
 * `container!.querySelector(...)` 在新壳上永远是空的(同一份文件里 asset-detail-receipt
 * 的其余用例早就改用了这个取法)。断言一条没动,只是查询的根跟着面板搬了家。
 */
function detailSurface(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  expect(found, "资产详情 Sheet 应该已经打开").not.toBeNull();
  return found!;
}

/** 声音开关本身。找的是可访问名字,不是某个 class —— 换皮不该让这条断言失明。 */
function soundToggle(): HTMLElement {
  const found = detailSurface().querySelector<HTMLElement>('[role="switch"][aria-label="Sound"]');
  expect(found, "视频规格选择器上应该有一个声音开关").not.toBeNull();
  return found!;
}

async function toggleSound(): Promise<void> {
  await act(async () => { soundToggle().click(); });
  await act(async () => { await Promise.resolve(); });
}

/** 行动栏上那颗按钮 —— 它把要收的价写在自己脸上,所以它就是「屏幕上那个价」。 */
function animateButton(): HTMLButtonElement {
  const found = [...detailSurface().querySelectorAll("button")]
    .find((b) => b.textContent?.trim().startsWith("Animate"));
  expect(found, "行动栏上应该有「Animate」").toBeDefined();
  return found!;
}

async function pressAnimate(): Promise<void> {
  expect(mocks.startAssetGen, "还没按就已经花钱了").not.toHaveBeenCalled();
  await act(async () => { animateButton().click(); });
  await act(async () => { await Promise.resolve(); });
}

function assetGenArg(): Record<string, unknown> {
  expect(mocks.startAssetGen).toHaveBeenCalled();
  return mocks.startAssetGen.mock.calls[0]![0] as Record<string, unknown>;
}

describe("CREATE-A3:视频声音开关", () => {
  it("CREATE-A3:开关默认开,而且界面上写明它不影响报价", async () => {
    await renderPanel();
    expect(soundToggle().getAttribute("aria-checked")).toBe("true");
    expect(VIDEO_AUDIO_PRICE_NOTE).toBe("Sound doesn't change the price");
    // 「界面明示」= 屏幕上真的有这句话,不是只藏在悬浮态里。
    expect(detailSurface().textContent).toContain(VIDEO_AUDIO_PRICE_NOTE);
  });

  it("CREATE-A3:商家关掉声音后生成 ⇒ 付费请求带 audio:false", async () => {
    await renderPanel();
    await toggleSound();
    expect(soundToggle().getAttribute("aria-checked")).toBe("false");
    await pressAnimate();
    expect(assetGenArg()).toMatchObject({ kind: "video", audio: false });
  });

  it("CREATE-A3:没碰过开关 ⇒ 照服务端默认档交付(声音开),本格出现前后一模一样", async () => {
    await renderPanel();
    await pressAnimate();
    expect(assetGenArg()).toMatchObject({ kind: "video", audio: true });
  });

  it("CREATE-A3:拨开关时报价数字一格不动 —— 按钮上的价与请求里的价都不变", async () => {
    await renderPanel();
    const before = animateButton().textContent;
    expect(before, "按钮必须把它要收的价写在脸上").toMatch(/\d+ credits?/);

    await toggleSound();
    expect(animateButton().textContent, "关掉声音不该改动屏幕上那个价").toBe(before);

    // 再拨回来也一样 —— 不是「碰巧两次相等」,是这一格根本不进价目表的键。
    await toggleSound();
    expect(animateButton().textContent).toBe(before);

    // 而且真发出去的那个价也是同一个数(11 = 720p:5,默认档)。
    await toggleSound();
    await pressAnimate();
    const arg = assetGenArg();
    expect(arg.audio).toBe(false);
    expect(arg.expectedCredits).toBe(11);
    expect(arg.durationSeconds).toBe(5);
    expect(arg.resolution).toBe("720p");
  });

  it("CREATE-A3:声音与会改价的那三格互不干扰 —— 改时长照样改价,声音仍是关的", async () => {
    await renderPanel();
    await toggleSound();
    const length = detailSurface().querySelector('[aria-label="Length of the video"]') as HTMLSelectElement;
    await act(async () => {
      length.value = "12";
      length.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await pressAnimate();
    const arg = assetGenArg();
    expect(arg.audio).toBe(false);
    expect(arg.durationSeconds).toBe(12);
    expect(arg.expectedCredits).toBe(27);
  });
});

/**
 * CREATE-A3 的**围栏**:声音开关只许出现在「拨了真的算数」的面上。
 *
 * 判官 r1 P0(2026-09-02)抓到的正是反面:这一格一开始无条件渲染在每一个
 * `VideoSpecPicker` 上,而画布那两条视频路(`FlowCanvas.tsx` 的 Animate 弹窗与 t2v 弹窗)
 * 提交时把 `audio` 整个丢掉 —— `clampVideoSpec` 只重建 seconds/resolution/aspectRatio,
 * `useCanvasGen.ts` 的请求体也只展开那三格。后果不是「开关无效」这么轻:
 * 拨动它会改掉 `FlowCanvas` 的 material JSON ⇒ actionId 换身份 ⇒ 服务端判 fresh ⇒
 * 「关掉声音重做一次」再付一次全价,拿回一条一样的、仍带 AI 配音的片子,全程零提示。
 *
 * 所以这里钉两条:
 *   ① 没自报 `audioToggle` 的调用点,屏幕上根本没有这一格(默认关,新入口不会误开);
 *   ② 画布那两处 picker 自报了 `audioToggle`,**当且仅当**画布的提交路真的把 audio 发出去
 *      ——「显示开关」与「发得出去」写在同一条断言里,漏一边就红(§8.2 批 II 2026-09-04
 *      收口,触发＝Codex QA-CRE-001;行为级证据在 canvas-video-audio-submit.test.ts)。
 */
describe("CREATE-A3 围栏:没接线的面上不许出现声音开关", () => {
  it("CREATE-A3:调用点不自报 audioToggle ⇒ 规格选择器上没有声音这一格", async () => {
    const { VideoSpecPicker } = await import("@/components/gen/VideoSpecPicker");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(VideoSpecPicker, {
        value: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
        menu: { durations: [5, 12], resolutions: ["720p", "480p"], aspectRatios: ["16:9"] },
        onChange: () => {},
      }));
    });
    // 三格会改价的照常在 —— 拿掉的只有声音那一格,不是整个选择器。
    expect(host.querySelector('[aria-label="Length of the video"]')).not.toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="Sound"]'), "没接线的面上不该有声音开关").toBeNull();
    expect(host.textContent).not.toContain(VIDEO_AUDIO_PRICE_NOTE);
    await act(async () => r.unmount());
    host.remove();
  });

  it("CREATE-A3:画布显示声音开关,当且仅当画布的提交路真的把 audio 发出去", () => {
    // jsdom 下 import.meta.url 是 http: —— 只能走 cwd(vitest 的根就是 apps/web,
    // 与 canvas-click-semantics.test.ts 读 globals.css 同一套)。
    const read = (rel: string) => readFileSync(join(process.cwd(), "components", "canvas", rel), "utf8");
    const canvasUi = read("FlowCanvas.tsx");
    const canvasSubmit = read("useCanvasGen.ts");
    const clamp = readFileSync(join(process.cwd(), "lib", "video-spec.ts"), "utf8");
    // 三段接线缺一不可,而且它们必须**一起**成立:clamp 保住 audio、两处付费请求体带上
    // audio、画布两个弹窗才许自报 audioToggle。任何一段被回退,这条就红。
    const submitSends = (canvasSubmit.match(/audio: spec\.audio/g) ?? []).length;
    const clampKeeps = /typeof spec\?\.audio === "boolean"/.test(clamp);
    const uiShows = (canvasUi.match(/audioToggle/g) ?? []).length;
    expect(clampKeeps, "clampVideoSpec 必须保留 audio,否则开关在提交前被静默抹掉").toBe(true);
    expect(submitSends, "useCanvasGen 的 animate 与 t2v 两处请求体都要带 audio").toBe(2);
    expect(uiShows, "画布 Animate 与 t2v 两个弹窗都要自报 audioToggle").toBe(2);
  });
});
