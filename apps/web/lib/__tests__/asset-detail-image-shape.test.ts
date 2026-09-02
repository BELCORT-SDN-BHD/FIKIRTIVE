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
import { expectFocusInside } from "./focus-trap-wait";

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
// The stand-in must carry EVERY entrance the real composer has. #896 r2 P2: this mock used
// to wire only `onChange`, so the real MentionInput's Shift/Cmd/Ctrl+Enter submit
// (MentionInput.tsx's editorProps.handleKeyDown → onSubmit) was invisible to every test here
// — and that invisible entrance was exactly the one that could spend without a price on screen.
vi.mock("@/components/MentionInput", () => ({
  MentionInput: ({
    onChange,
    onSubmit,
    disabled,
  }: {
    onChange?: (t: string, ids: string[]) => void;
    onSubmit?: () => void;
    disabled?: boolean;
  }) =>
    createElement("textarea", {
      "data-testid": "edit-input",
      disabled,
      onChange: (e: { target: { value: string } }) => onChange?.(e.target.value, []),
      onKeyDown: (e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
        if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) onSubmit?.();
      },
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

/** The server-resolved quote contract the panel prices everything from. */
const MODELS = {
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
};

beforeEach(() => {
  mocks.getActiveGenModels.mockResolvedValue(MODELS);
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

async function renderPanel(imageAspect: string | null, onClose: () => void = () => {}): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(imageAspect));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1",
      projectId: "p1",
      onClose,
      entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** Sheet content is portalled to document.body, outside the React mount node. */
function detailSurface(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  expect(found, "资产详情 Sheet 应该已经打开").not.toBeNull();
  return found!;
}

function imageShapePicker(): HTMLSelectElement {
  const found = detailSurface().querySelector<HTMLSelectElement>('select[aria-label="Image shape of the image"]');
  expect(found, "面板上应该有一个图片形状选择器").not.toBeNull();
  return found!;
}

/** 按钮上现在带着价（「Regenerate · 8 credits」），所以按前缀找。 */
function buttonsLabelled(text: string): HTMLButtonElement[] {
  return [...detailSurface().querySelectorAll("button")].filter((b) => b.textContent?.trim().startsWith(text) ?? false);
}

/** #896（Founder 2026-08-13）：详情面板的付费动作对齐画布 —— 按钮自己带价，**按下去就是批准**，
 *  中间没有确认弹窗。这个助手就是那条语义：一击,而且这一击之前不许有任何付费调用。 */
async function pressPaidAction(label: string): Promise<void> {
  const button = buttonsLabelled(label)[0];
  expect(button, `行动栏上应该有「${label}」`).toBeDefined();
  expect(button!.textContent, `「${label}」必须把它要收的价写在按钮上`).toMatch(/\d+ credits?/);
  expect(mocks.startAssetGen, "还没按就已经花钱了").not.toHaveBeenCalled();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector('[data-slot="dialog-content"]'), "付费动作不该再弹确认框").toBeNull();
}

function startGenArg(): Record<string, unknown> {
  // #645 T4(判官 r1 P0-2):详情页的付费路改走带价格绑定的 startAssetGen。
  // 这几条断言看的仍然是**形状**,与绑定无关 —— 只是读的那个替身换了名字。
  expect(mocks.startAssetGen).toHaveBeenCalled();
  return mocks.startAssetGen.mock.calls[0]![0] as Record<string, unknown>;
}

describe("资产详情使用标准 Sheet 外壳", () => {
  it("有可读标题、焦点陷阱，并把背景挡在读屏与 Tab 之外", async () => {
    await renderPanel("1:1");

    const sheet = detailSurface();
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.textContent).toContain("Asset details");
    await expectFocusInside(sheet, "打开后焦点没有进入 inspector");
    expect(container!.getAttribute("aria-hidden"), "背景仍暴露给读屏").toBe("true");
  });

  it("Escape 关闭 inspector，并走父组件唯一的 onClose", async () => {
    const onClose = vi.fn();
    await renderPanel("1:1", onClose);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("裁剪中第一次 Escape 只退出裁剪，不把整个 inspector 一起关掉", async () => {
    const onClose = vi.fn();
    await renderPanel("1:1", onClose);
    const crop = buttonsLabelled("Crop")[0];
    expect(crop).toBeDefined();

    await act(async () => crop!.click());
    expect(detailSurface().querySelector(".cv-detail-crop")).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(detailSurface().querySelector(".cv-detail-crop")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

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
    await pressPaidAction("Regenerate");
    expect(startGenArg()).toMatchObject({ kind: "image", aspectRatio: "9:16" });
  });

  it("商家在面板上换了形状 ⇒ Regenerate 交付换的那一格", async () => {
    await renderPanel("9:16");
    await act(async () => {
      const picker = imageShapePicker();
      picker.value = "21:9";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await pressPaidAction("Regenerate");
    expect(startGenArg()).toMatchObject({ aspectRatio: "21:9" });
  });

  it("编辑框(Edit)同样带着屏幕上那一格，并且仍然挂着底图", async () => {
    await renderPanel("4:3");
    const input = detailSurface().querySelector<HTMLTextAreaElement>('[data-testid="edit-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, "make the mug red");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressPaidAction("Generate edit");
    expect(startGenArg()).toMatchObject({
      kind: "image",
      aspectRatio: "4:3",
      sourceGenerationId: "g1",
    });
  });

  it("两个形状控件不会被认错：图片一个、视频一个，各说各的名字", async () => {
    await renderPanel("1:1");
    const labels = [...detailSurface().querySelectorAll("span")].map((s) => s.textContent);
    expect(labels).toContain("Image shape");
    // #645 T4：视频那一组现在是完整规格（长度/清晰度/形状），所以标题是 Video spec。
    expect(labels).toContain("Video spec");
    // 视频形状那一格仍然只喂 Animate —— 它的菜单是视频侧的，不是图片侧的。
    const videoShape = detailSurface().querySelector('[aria-label="Shape of the video"]');
    expect(videoShape).not.toBeNull();
    expect(videoShape!.textContent).toBe("16:99:161:14:33:421:9Adaptive");
    // adaptive 在卡面上如实叫 Adaptive —— 绝不冒充某个具体比例。
    expect(videoShape!.textContent).not.toContain("adaptive");
  });

  it("#645 T4：Animate 的形状默认 Adaptive（有首帧 ⇒ 引擎跟着首帧走，不替商家改画幅）", async () => {
    await renderPanel("1:1");
    const videoShape = detailSurface().querySelector('[aria-label="Shape of the video"]') as HTMLSelectElement | null;
    expect(videoShape).not.toBeNull();
    expect(videoShape!.value).toBe("adaptive");
    // 长度/清晰度默认与今日一致。
    expect((detailSurface().querySelector('[aria-label="Length of the video"]') as HTMLSelectElement).value).toBe("5");
    expect((detailSurface().querySelector('[aria-label="Quality of the video"]') as HTMLSelectElement).value).toBe("720p");
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

  // #896:付费动作是**一步** —— 行动栏那颗按钮自己带价,按下去就是批准。
  // 「屏幕上那个价 = 请求里那个价」这条绑定因此更直白了:断言读的就是同一颗按钮。

  it("Animate 带上面板显示的视频价(而不是让服务端自己决定收多少)", async () => {
    await renderPanel("1:1");
    await pressPaidAction("Animate");
    const arg = assetGenArg();
    expect(arg.kind).toBe("video");
    // 面板显示的是默认档 720p/5s = 11 credits,带出去的必须是同一个数。
    expect(arg.expectedCredits).toBe(11);
  });

  it("商家在面板里把片子改成 12 秒 ⇒ 带出去的价跟着变成 27,不是旧的 11", async () => {
    await renderPanel("1:1");
    const length = detailSurface().querySelector('[aria-label="Length of the video"]') as HTMLSelectElement;
    await act(async () => {
      length.value = "12";
      length.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await pressPaidAction("Animate");
    const arg = assetGenArg();
    expect(arg.durationSeconds).toBe(12);
    expect(arg.expectedCredits).toBe(27);
  });

  it("Regenerate 同样带着面板显示的图片价", async () => {
    await renderPanel("1:1");
    await pressPaidAction("Regenerate");
    const arg = assetGenArg();
    expect(arg.kind).toBe("image");
    expect(arg.expectedCredits).toBe(8);
  });

  it("付费路径不再走没有价格绑定的 startGen", async () => {
    await renderPanel("1:1");
    await pressPaidAction("Animate");
    expect(mocks.startGen).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #896 r2 P0-a —— 编辑框的快捷键是**第二个入口**,它必须和按钮同一道闸
//
// 编辑框支持 Shift/Cmd/Ctrl+Enter 提交(MentionInput 的 handleKeyDown → onSubmit)。
// 闸只装在按钮的 disabled 上时,这条路是敞开的:报价还没回来,按钮写着「Checking cost…」
// 且是灰的,快捷键却直接进 handleEditSubmit —— 它自己 await 一次 ensureModels() 把报价取
// 回来,然后照发付费请求。商家在屏幕上从没见过那个价,钱已经花掉了。
//
// 关键在于报价**迟到**而不是永远不来:永远不来的话请求本来就发不出去,证明不了什么。
// 下面这个 deferred 就是那段真实的时间差。
// ---------------------------------------------------------------------------
describe("#896 r2 P0-a:报价没到位时,每一种触发方式都花不出钱", () => {
  /** 一个我们说了算什么时候落地的报价 —— 那段网络往返的时间差。 */
  function deferQuote(): (models: unknown) => Promise<void> {
    let land: (v: unknown) => void = () => {};
    mocks.getActiveGenModels.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    return async (models: unknown) => {
      land(models);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
    };
  }

  async function typeEdit(text: string): Promise<HTMLTextAreaElement> {
    const input = detailSurface().querySelector<HTMLTextAreaElement>('[data-testid="edit-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  async function pressSubmitShortcut(
    input: HTMLTextAreaElement,
    modifier: "shiftKey" | "metaKey" | "ctrlKey",
  ): Promise<void> {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", [modifier]: true, bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it.each(["shiftKey", "metaKey", "ctrlKey"] as const)(
    "报价迟到时按 %s+Enter ⇒ 一个积分都花不出去(按钮灰着不算闸)",
    async (modifier) => {
      const landQuote = deferQuote();
      await renderPanel("1:1");

      // 屏幕上此刻没有价可看 —— 按钮如实这么写,而且是关着的。
      const editButton = buttonsLabelled("Checking cost…").at(-1);
      expect(editButton, "报价没到时,编辑按钮应该说它还不知道价").toBeDefined();
      expect(editButton!.disabled).toBe(true);
      expect(
        buttonsLabelled("Checking cost…").every((button) => button.querySelector(".animate-spin")),
        "三个等待报价的付费按钮都应该使用同一个 Spinner",
      ).toBe(true);

      const input = await typeEdit("make the mug red");
      await pressSubmitShortcut(input, modifier);

      // 报价现在才落地。修好之前,这一刻正是那次「无价支付」发出去的时刻。
      await landQuote(MODELS);

      expect(
        mocks.startAssetGen,
        "快捷键绕过了价签:商家没看过价,钱已经花了",
      ).not.toHaveBeenCalled();
      expect(mocks.startGen).not.toHaveBeenCalled();
    },
  );

  it("报价到位之后,同一个快捷键照旧一击成事(闸没有把功能关死)", async () => {
    await renderPanel("1:1");
    const input = await typeEdit("make the mug red");

    // 价已经在按钮上了 —— 这一击就是那次带价的批准。
    const editButton = buttonsLabelled("Generate edit")[0];
    expect(editButton!.textContent).toContain("8 credits");
    expect(editButton!.disabled).toBe(false);

    await pressSubmitShortcut(input, "metaKey");

    expect(mocks.startAssetGen).toHaveBeenCalledTimes(1);
    expect(mocks.startAssetGen.mock.calls[0]![0]).toMatchObject({
      kind: "image",
      expectedCredits: 8,
      sourceGenerationId: "g1",
    });
  });

  it("编辑框是空的 ⇒ 快捷键同样什么都不做(和按钮判的是同一件事)", async () => {
    await renderPanel("1:1");
    const input = detailSurface().querySelector<HTMLTextAreaElement>('[data-testid="edit-input"]')!;
    await pressSubmitShortcut(input, "metaKey");
    expect(mocks.startAssetGen).not.toHaveBeenCalled();
  });
});

describe("资产详情：付费动作的即时反馈与授权内容锁定", () => {
  function deferStart(): {
    land: (result: { id: string; disposition: "fresh" } | { error: string }) => Promise<void>;
  } {
    let resolveStart: (result: { id: string; disposition: "fresh" } | { error: string }) => void = () => {};
    mocks.startAssetGen.mockReturnValue(new Promise((resolve) => { resolveStart = resolve; }));
    return {
      land: async (result) => {
        await act(async () => {
          resolveStart(result);
          await Promise.resolve();
        });
      },
    };
  }

  async function typeEdit(text: string): Promise<HTMLTextAreaElement> {
    const input = detailSurface().querySelector<HTMLTextAreaElement>('[data-testid="edit-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it("Regenerate 一按就转、锁住图片形状，并把服务端失败原因显示出来", async () => {
    const pending = deferStart();
    await renderPanel("9:16");
    const button = buttonsLabelled("Regenerate")[0]!;

    await act(async () => { button.click(); });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Generating…");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(imageShapePicker().disabled).toBe(true);
    expect((detailSurface().querySelector('[aria-label="Length of the video"]') as HTMLSelectElement).disabled).toBe(false);

    await pending.land({ error: "Your balance is too low for this image." });
    expect(detailSurface().textContent).toContain("Couldn't complete this action");
    expect(detailSurface().textContent).toContain("Your balance is too low for this image.");
    expect(button.textContent).toContain("Failed — retry?");
  });

  it("Animate 只锁住这支视频的规格，并显示正在制作", async () => {
    const pending = deferStart();
    await renderPanel("1:1");
    const button = buttonsLabelled("Animate")[0]!;

    await act(async () => { button.click(); });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Animating…");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    for (const label of ["Length", "Quality", "Shape"]) {
      const select = detailSurface().querySelector<HTMLSelectElement>(`[aria-label="${label} of the video"]`)!;
      expect(select.disabled, `${label} 应该在请求中锁住`).toBe(true);
    }
    expect(imageShapePicker().disabled).toBe(false);

    await pending.land({ error: "Video generation is unavailable right now." });
  });

  it("Generate edit 请求中锁住文字与图片形状，按钮明确显示 Editing", async () => {
    const pending = deferStart();
    await renderPanel("4:3");
    const input = await typeEdit("make the mug red");
    const button = buttonsLabelled("Generate edit")[0]!;

    await act(async () => { button.click(); });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Editing…");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(imageShapePicker().disabled).toBe(true);

    await pending.land({ error: "The edit could not be started." });
    expect(detailSurface().textContent).toContain("The edit could not be started.");
    expect(button.textContent).toContain("Failed — try again");
  });
});
