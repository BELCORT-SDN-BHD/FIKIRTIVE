// @vitest-environment jsdom
/**
 * CREATE-A3 —— 画布两条视频路的**提交那一截**:开关拨掉之后,`audio` 有没有一路活到
 * 付费请求体、活到刷新后的重放。
 *
 * 规格(docs/specs/creation-engine.md 验收表 CREATE-A3):
 *   「商家在视频规格选择器关掉声音开关后生成 ⇒ 交付视频无 AI 配音配乐
 *    (`generate_audio=false` 实发可查);界面明示声音开关不影响报价」
 *
 * 阶段一(PR #1133)只接了资产详情 Animate 一条路;画布这两条路当时把 `audio` 整个丢掉,
 * 所以判官裁定画布上不许显示这个开关。Codex 的只读走查(QA-CRE-001,真浏览器,
 * job `01M1MBH5W162TQZ745K4PSN6VP`)证实了这条缺口的实际后果:画布出片框里根本没有声音
 * 那一格,提示词写「完全静音」照样拿回一条带 AAC 音轨的 MP4。
 *
 * 这个文件驱动**真** `useCanvasGen`,只把服务端动作换成假件 —— 断言看的是真的会发给
 * `startCanvasGen` 的那个请求体。链条的其余两段各有自己的守卫:
 *   · 界面这一截(弹窗里有开关、拨了进 spec、报价不动)在 `canvas-video-spec-ui.test.ts`;
 *   · 供应商这一截(`audio:false` ⇒ 请求体 `generate_audio:false`)在
 *     `packages/generation/src/byteplus-audio.test.ts`。
 * 三段接起来才是「实发可查」。一个积分都花不出去:`startCanvasGen` 是 vi.fn()。
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startCanvasGen: vi.fn(),
  getGenJob: vi.fn(),
  getActiveGenModels: vi.fn(),
  createCanvasNode: vi.fn(),
  resolveCanvasNode: vi.fn(),
}));

vi.mock("../gen-actions", () => ({
  startCanvasGen: mocks.startCanvasGen,
  getGenJob: mocks.getGenJob,
  getActiveGenModels: mocks.getActiveGenModels,
}));
vi.mock("../canvas-actions", () => ({
  createCanvasNode: mocks.createCanvasNode,
  resolveCanvasNode: mocks.resolveCanvasNode,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useCanvasGen, loadCanvasActionReceipts } = await import("@/components/canvas/useCanvasGen");
const { canvasActionKey } = await import("../batch-idempotency");

/** 服务端解析的报价契约(与 video-audio-toggle.test.ts 同一份形状)。 */
const MODELS = {
  image: "capability-image-1",
  video: "capability-video-1",
  imageCredits: 8,
  videoCredits: 80,
  // 服务端默认档:声音**开**。
  videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
  videoAspectRatios: ["16:9", "9:16", "1:1", "adaptive"],
  videoDurations: [5, 12],
  videoResolutions: ["720p", "480p"],
  videoI2vDefaultAspect: "adaptive",
  // 按档价目表 —— 键只有「清晰度:秒数」两维,声音根本不在键里。
  videoCreditsBySpec: { "720p:5": 11, "720p:12": 27, "480p:5": 6, "480p:12": 14 },
  imageAspectRatios: ["1:1", "9:16"],
  imageDefaultAspect: "1:1",
  imageFineDetail: null,
  videoElementReferences: true,
};

type Gen = ReturnType<typeof useCanvasGen>;
let api: Gen | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe(): null {
  const gen = useCanvasGen(
    "p1",
    () => {},
    () => {},
    null,
    () => {},
  );
  useEffect(() => { api = gen; });
  api = gen;
  return null;
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Probe)); });
}

beforeEach(async () => {
  sessionStorage.clear();
  mocks.getActiveGenModels.mockResolvedValue(MODELS);
  mocks.startCanvasGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.createCanvasNode.mockResolvedValue({ id: "node-1", x: 0, y: 0, w: 320, h: 320 });
  mocks.resolveCanvasNode.mockResolvedValue({ ok: true });
  mocks.getGenJob.mockResolvedValue({ status: "DONE", urls: [], generationIds: [] });
  await mount();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  api = null;
  vi.clearAllMocks();
});

const POS = { x: 0, y: 0, w: 320, h: 320 };
const SPEC = { seconds: 5, resolution: "720p", aspectRatio: "16:9" } as const;

/** 真的发给服务端的那个请求体。 */
function sentRequest(index = 0): Record<string, unknown> {
  expect(mocks.startCanvasGen).toHaveBeenCalled();
  return mocks.startCanvasGen.mock.calls[index]![0] as Record<string, unknown>;
}

async function runT2v(spec: Record<string, unknown> | undefined, actionId = "act-1"): Promise<void> {
  await act(async () => {
    await api!.generateVideoFromText("a cup steaming", POS, actionId, {}, spec ? { spec: spec as never } : {});
  });
}

async function runAnimate(spec: Record<string, unknown> | undefined, actionId = "act-1"): Promise<void> {
  await act(async () => {
    await api!.animate("gen-src", "node-src", "Animate this image with gentle, natural motion.", POS, actionId, {}, spec ? { spec: spec as never } : {});
  });
}

describe("CREATE-A3:画布 t2v 把声音开关发出去", () => {
  it("CREATE-A3:关掉声音 ⇒ 付费请求体带 audio:false", async () => {
    await runT2v({ ...SPEC, audio: false });
    expect(sentRequest()).toMatchObject({ kind: "video", audio: false, durationSeconds: 5, resolution: "720p" });
  });

  it("CREATE-A3:开着声音 ⇒ 付费请求体带 audio:true(商家明确要了声音)", async () => {
    await runT2v({ ...SPEC, audio: true });
    expect(sentRequest()).toMatchObject({ kind: "video", audio: true });
  });

  it("CREATE-A3:没碰过开关 ⇒ 请求体里一格 audio 都不出现(按服务端默认档交付)", async () => {
    await runT2v({ ...SPEC });
    expect(Object.hasOwn(sentRequest(), "audio"), "没拨过就不该出现这一格").toBe(false);
  });

  it("CREATE-A3:声音不改价 —— 开与关发出去的 expectedCredits 是同一个数", async () => {
    await runT2v({ ...SPEC, audio: false }, "act-off");
    await runT2v({ ...SPEC, audio: true }, "act-on");
    const off = sentRequest(0);
    const on = sentRequest(1);
    expect(off.expectedCredits).toBe(11); // 720p:5 —— 价目表上的那一档
    expect(on.expectedCredits).toBe(off.expectedCredits);
    // 会改价的那三格也一格没被声音带偏。
    for (const key of ["durationSeconds", "resolution", "aspectRatio"] as const) {
      expect(on[key], key).toBe(off[key]);
    }
  });
});

describe("CREATE-A3:画布 Animate(带首帧)把声音开关发出去", () => {
  it("CREATE-A3:关掉声音 ⇒ 付费请求体带 audio:false,首帧那一格照旧", async () => {
    await runAnimate({ seconds: 5, resolution: "720p", aspectRatio: "adaptive", audio: false });
    expect(sentRequest()).toMatchObject({
      kind: "video",
      audio: false,
      sourceGenerationId: "gen-src",
      aspectRatio: "adaptive",
    });
  });

  it("CREATE-A3:没碰过开关 ⇒ 请求体里一格 audio 都不出现", async () => {
    await runAnimate({ seconds: 5, resolution: "720p", aspectRatio: "adaptive" });
    expect(Object.hasOwn(sentRequest(), "audio")).toBe(false);
  });

  it("CREATE-A3:声音不改价 —— Animate 这条路同样", async () => {
    await runAnimate({ seconds: 5, resolution: "720p", aspectRatio: "adaptive", audio: false }, "act-off");
    await runAnimate({ seconds: 5, resolution: "720p", aspectRatio: "adaptive", audio: true }, "act-on");
    expect(sentRequest(0).expectedCredits).toBe(11);
    expect(sentRequest(1).expectedCredits).toBe(11);
  });
});

/**
 * 刷新后重放的必须是**商家当时按下去的那一份**。声音不改价,但它改交付物 —— 一条静音片
 * 与一条带 AI 配音的片子不是同一件东西,所以它与形状、时长同一条规矩进回执。
 */
describe("CREATE-A3:声音进回执 —— 刷新后重放的还是那一条静音片", () => {
  it("CREATE-A3:关掉声音的动作,回执里记着 videoAudio:false", async () => {
    // 请求悬在半空(outcome 未知)⇒ 回执留在 sessionStorage 里,正是刷新后要重放的那一份。
    mocks.startCanvasGen.mockRejectedValue(new Error("network blip"));
    await runT2v({ ...SPEC, audio: false }, "act-kept");
    const receipts = loadCanvasActionReceipts("p1");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ operation: "video", videoAudio: false, videoSeconds: 5 });
  });

  it("CREATE-A3:没碰过开关的动作,回执里没有这一格(重放同样按默认档)", async () => {
    mocks.startCanvasGen.mockRejectedValue(new Error("network blip"));
    await runT2v({ ...SPEC }, "act-kept");
    const receipt = loadCanvasActionReceipts("p1")[0] as Record<string, unknown>;
    expect(Object.hasOwn(receipt, "videoAudio")).toBe(false);
  });
});

/**
 * 幂等键这一条:画布的键由服务端从 actionId 算(`canvasActionKey`),而 actionId 由
 * `FlowCanvas` 的 material JSON 决定 —— spec 整个进材料,所以声音在里面。这里断的是
 * 这条链的下半截:换了动作身份,键就换 ⇒ 「关掉声音重做一次」是**另一次购买**,不是
 * 同一次的重试被吞掉。(上半截「拨声音会换 actionId」在 canvas-video-spec-ui.test.ts。)
 */
describe("CREATE-A3:开与关是两个意图 ⇒ 两个幂等键", () => {
  it("CREATE-A3:声音不同的两次提交,服务端算出来的幂等键不同", async () => {
    await runT2v({ ...SPEC, audio: true }, "canvas-action-sound-on");
    await runT2v({ ...SPEC, audio: false }, "canvas-action-sound-off");
    const on = canvasActionKey("canvas-action-sound-on").key;
    const off = canvasActionKey("canvas-action-sound-off").key;
    expect(off).not.toBe(on);
    // 同一个动作身份重放 ⇒ 同一个键(这才是「重试不再收钱」的那条路)。
    expect(canvasActionKey("canvas-action-sound-off").key).toBe(off);
  });
});
