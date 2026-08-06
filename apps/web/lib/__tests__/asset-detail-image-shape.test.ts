// @vitest-environment jsdom
/**
 * #643 T2 —— 资产详情页的两条付费图片路（Regenerate / 编辑框），形状从界面到请求体。
 *
 * 这两条路以前**根本不提**形状：商家看着一张竖版图按 Regenerate，拿回一张方图，
 * 而且没有一个地方说过这件事。现在面板上有一格「Image shape」，种子取自这张图当初
 * 交付的形状，屏幕上写的就是请求体里发出去的。
 *
 * 真组件 + 真 React；只有服务端动作是假件，所以一个积分都花不出去。
 */
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

const MENU = ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"];

const generation = (imageAspect: string | null) => ({
  id: "g1",
  projectId: "p1",
  url: "https://cdn.test/g1.png",
  urls: ["https://cdn.test/g1.png"],
  variants: [{ id: "g1", url: "https://cdn.test/g1.png", favorite: false }],
  kind: "image",
  prompt: "a poster for the weekend sale",
  favorite: false,
  sourceGenerationId: null,
  imageAspect,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.getActiveGenModels.mockResolvedValue({
    image: "capability-image-1",
    video: "capability-video-1",
    imageCredits: 8,
    videoCredits: 80,
    videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
    videoAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    // #645 T4：视频规格菜单 + 按档价目表（服务端解析的那一份）。
    videoDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    videoResolutions: ["720p", "480p"],
    videoI2vDefaultAspect: "adaptive",
    videoCreditsBySpec: Object.fromEntries(
      ["720p", "480p"].flatMap((r) =>
        [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((s) =>
          [`${r}:${s}`, Math.ceil((s * (r === "480p" ? 11 : 22)) / 10)] as const),
      ),
    ),
    imageAspectRatios: MENU,
    imageDefaultAspect: "1:1",
  });
  mocks.startGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
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

async function renderPanel(imageAspect: string | null): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(imageAspect));
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

function imageShapePicker(): HTMLSelectElement {
  const found = container!.querySelector<HTMLSelectElement>('select[aria-label="Image shape of the image"]');
  expect(found, "面板上应该有一个图片形状选择器").not.toBeNull();
  return found!;
}

function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
}

/** 走一次确认对话框：先按面板上的按钮，再按对话框里的确认按钮。 */
async function confirmAction(trigger: string, confirmLabel: string): Promise<void> {
  await act(async () => { buttonsLabelled(trigger)[0]!.click(); });
  await act(async () => { await Promise.resolve(); });
  // 只在对话框里找确认按钮：面板上那个按钮的名字可能与确认按钮相同（Regenerate），
  // 在整篇文档里找会先命中面板那个，于是「确认」变成了又一次打开对话框。
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog, "应该弹出确认对话框").not.toBeNull();
  const confirm = [...dialog!.querySelectorAll("button")].filter((b) => b.textContent?.trim() === confirmLabel);
  expect(confirm[0], `应该出现「${confirmLabel}」确认按钮`).toBeDefined();
  await act(async () => { confirm[0]!.click(); });
  await act(async () => { await Promise.resolve(); });
}

function startGenArg(): Record<string, unknown> {
  expect(mocks.startGen).toHaveBeenCalled();
  return mocks.startGen.mock.calls[0]![0] as Record<string, unknown>;
}

describe("资产详情：图片形状(#643 T2)", () => {
  it("菜单是服务端给的那份，选中的是这张图**当初交付的**形状", async () => {
    await renderPanel("9:16");
    const picker = imageShapePicker();
    expect([...picker.options].map((o) => o.value)).toEqual(MENU);
    expect(picker.value).toBe("9:16");
  });

  it("老图（没有形状记录）⇒ 显示默认方图 —— 那正是它当年真的形状", async () => {
    await renderPanel(null);
    expect(imageShapePicker().value).toBe("1:1");
  });

  it("Regenerate 带的是屏幕上那一格 —— 重做一张不会悄悄换掉形状", async () => {
    await renderPanel("9:16");
    await confirmAction("Regenerate", "Regenerate");
    expect(startGenArg()).toMatchObject({ kind: "image", aspectRatio: "9:16" });
  });

  it("商家在面板上换了形状 ⇒ Regenerate 交付换的那一格", async () => {
    await renderPanel("9:16");
    await act(async () => {
      const picker = imageShapePicker();
      picker.value = "21:9";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await confirmAction("Regenerate", "Regenerate");
    expect(startGenArg()).toMatchObject({ aspectRatio: "21:9" });
  });

  it("编辑框(Edit)同样带着屏幕上那一格，并且仍然挂着底图", async () => {
    await renderPanel("4:3");
    const input = container!.querySelector<HTMLTextAreaElement>('[data-testid="edit-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, "make the mug red");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await confirmAction("Send", "Generate edit");
    expect(startGenArg()).toMatchObject({
      kind: "image",
      aspectRatio: "4:3",
      sourceGenerationId: "g1",
    });
  });

  it("两个形状控件不会被认错：图片一个、视频一个，各说各的名字", async () => {
    await renderPanel("1:1");
    const labels = [...container!.querySelectorAll("span")].map((s) => s.textContent);
    expect(labels).toContain("Image shape");
    // #645 T4：视频那一组现在是完整规格（长度/清晰度/形状），所以标题是 Video spec。
    expect(labels).toContain("Video spec");
    // 视频形状那一格仍然只喂 Animate —— 它的菜单是视频侧的，不是图片侧的。
    const videoShape = container!.querySelector('[aria-label="Shape of the video"]');
    expect(videoShape).not.toBeNull();
    expect(videoShape!.textContent).toBe("16:99:161:14:33:421:9Adaptive");
    // adaptive 在卡面上如实叫 Adaptive —— 绝不冒充某个具体比例。
    expect(videoShape!.textContent).not.toContain("adaptive");
  });

  it("#645 T4：Animate 的形状默认 Adaptive（有首帧 ⇒ 引擎跟着首帧走，不替商家改画幅）", async () => {
    await renderPanel("1:1");
    const videoShape = container!.querySelector('[aria-label="Shape of the video"]') as HTMLSelectElement | null;
    expect(videoShape).not.toBeNull();
    expect(videoShape!.value).toBe("adaptive");
    // 长度/清晰度默认与今日一致。
    expect((container!.querySelector('[aria-label="Length of the video"]') as HTMLSelectElement).value).toBe("5");
    expect((container!.querySelector('[aria-label="Quality of the video"]') as HTMLSelectElement).value).toBe("720p");
  });
});

// ---------------------------------------------------------------------------
// #645 T4(判官 r1 P0-2)—— 详情页把「屏幕上那个价」绑进付费请求
// ---------------------------------------------------------------------------
//
// 详情页会先把价格显示出来,再按那个价扣钱。中间隔着一次网络往返和一个可能开了很久
// 的面板。价格若在这期间改了(商家在同一个面板里把片子从 5 秒改成 12 秒也算),商家就是
// 「按旧价签字、按新价扣款」。修法与 Canvas / Otto 同源:面板把展示的那个价随请求带上,
// 服务端算出来不符即拒。
describe("#645 T4:资产详情的付费请求带着屏幕上那个价", () => {
  function assetGenArg(): Record<string, unknown> {
    expect(mocks.startAssetGen).toHaveBeenCalled();
    return mocks.startAssetGen.mock.calls[0]![0] as Record<string, unknown>;
  }

  /** 面板上的付费动作是两步:先按行动栏那个按钮开确认框,再在框里确认。两步都点。 */
  async function confirmAction(label: string): Promise<void> {
    const findAll = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((b) => (b.textContent ?? "").trim() === label);
    const rail = findAll();
    expect(rail.length, `行动栏上应该有「${label}」`).toBeGreaterThan(0);
    await act(async () => { rail[0]!.click(); });
    await act(async () => { await Promise.resolve(); });
    // 确认框里那个同名按钮 —— 它才是真正花钱的那一下。
    const after = findAll();
    const confirm = after[after.length - 1]!;
    await act(async () => { confirm.click(); });
    await act(async () => { await Promise.resolve(); });
  }

  it("Animate 带上面板显示的视频价(而不是让服务端自己决定收多少)", async () => {
    await renderPanel("1:1");
    await confirmAction("Animate");
    const arg = assetGenArg();
    expect(arg.kind).toBe("video");
    // 面板显示的是默认档 720p/5s = 11 credits,带出去的必须是同一个数。
    expect(arg.expectedCredits).toBe(11);
  });

  it("商家在面板里把片子改成 12 秒 ⇒ 带出去的价跟着变成 27,不是旧的 11", async () => {
    await renderPanel("1:1");
    const length = container!.querySelector('[aria-label="Length of the video"]') as HTMLSelectElement;
    await act(async () => {
      length.value = "12";
      length.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await confirmAction("Animate");
    const arg = assetGenArg();
    expect(arg.durationSeconds).toBe(12);
    expect(arg.expectedCredits).toBe(27);
  });

  it("Regenerate 同样带着面板显示的图片价", async () => {
    await renderPanel("1:1");
    await confirmAction("Regenerate");
    const arg = assetGenArg();
    expect(arg.kind).toBe("image");
    expect(arg.expectedCredits).toBe(8);
  });

  it("付费路径不再走没有价格绑定的 startGen", async () => {
    await renderPanel("1:1");
    await confirmAction("Animate");
    expect(mocks.startGen).not.toHaveBeenCalled();
  });
});
