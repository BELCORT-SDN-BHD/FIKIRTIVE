// @vitest-environment jsdom
/**
 * 接线盘点 L2 —— 素材详情面板上三处「写入失败没有反馈」与一处「本机偏好没说明」。
 *
 * 验收编号:**FRONT-A12**(冻结表:「任何写入失败都有错误反馈,不出现『假成功』」)。
 * FRONT-A5「收藏后刷新仍收藏」那一半的真验证在 `asset-actions.test.ts` 的 `setFavorite`
 * 一族(落库、租户、返回形状),本文件不重复,只钉住**失败那一半**:服务端说不行的时候,
 * 商家在屏幕上看得见。
 *
 * 修前四处现象(main 2da07be4):
 *   ① 收藏失败只 `applyLocal(!next)` 悄悄回滚 —— 观感是「点了又弹回来」,不知道被拒了;
 *   ② Copy link 的 catch 里写着 silently ignore clipboard errors,失败一个字不说;
 *      而且复制出去的是 `/files/…` 站内相对路径 —— 登录墙后面、没有域名,贴到别处打不开;
 *   ③ 删除丢弃 `deleteGeneration` 的返回值,服务端 `{error}` 时面板照关 —— 商家以为删掉了;
 *   ④ 变体缩略图的选择只写 localStorage(`otto:pick:<id>`),界面上没说这是本机偏好。
 *
 * 真组件 + 真 React;只有服务端动作是假件。断言的是**屏幕上的字**,不是源码里的标识符。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGeneration: vi.fn(),
  getActiveGenModels: vi.fn(),
  startGen: vi.fn(),
  startAssetGen: vi.fn(),
  getGenJob: vi.fn(),
  setFavorite: vi.fn(),
  saveCroppedGeneration: vi.fn(),
  deleteGeneration: vi.fn(),
  getPublicMediaLink: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/lib/asset-actions", () => ({
  getGeneration: mocks.getGeneration,
  setFavorite: mocks.setFavorite,
  saveCroppedGeneration: mocks.saveCroppedGeneration,
}));
vi.mock("@/lib/actions", () => ({ deleteGeneration: mocks.deleteGeneration }));
vi.mock("@/lib/media-link-actions", () => ({ getPublicMediaLink: mocks.getPublicMediaLink }));
vi.mock("@/lib/gen-actions", () => ({
  startGen: mocks.startGen,
  startAssetGen: mocks.startAssetGen,
  getGenJob: mocks.getGenJob,
  getActiveGenModels: mocks.getActiveGenModels,
}));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: () => null }));
vi.mock("@/components/MentionInput", () => ({
  MentionInput: () => createElement("textarea", { "data-testid": "edit-input" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: DetailPanel } = await import("@/components/asset/DetailPanel");
const { PICK_SCOPE_NOTE } = await import("@/lib/result-pick");

const MERCHANT_PROMPT = "a poster for the weekend sale";

type Variant = { id: string; url: string; favorite: boolean; finalPrompt: string | null };

const one: Variant[] = [{ id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: null }];
const two: Variant[] = [
  { id: "g1", url: "https://cdn.test/g1.png", favorite: false, finalPrompt: null },
  { id: "g2", url: "https://cdn.test/g2.png", favorite: false, finalPrompt: null },
];

const generation = (variants: Variant[]) => ({
  id: variants[0]!.id,
  projectId: "p1",
  url: variants[0]!.url,
  urls: variants.map((v) => v.url),
  variants,
  kind: "image" as const,
  prompt: MERCHANT_PROMPT,
  finalPrompt: null,
  sentPrompt: null,
  favorite: false,
  sourceGenerationId: null,
  imageAspect: "1:1",
  routeReason: null,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let closed = 0;

// jsdom 没有 navigator.clipboard。`configurable: true` 是刻意的:整套 apps/web 的 vitest 跑在
// 同一个 globalThis 上(见 result-pick.test.ts 里那段说明),不可配置的属性会永久钉住,后面
// 几百个文件都摘不掉。文件结束时删回去。
const hadClipboard = "clipboard" in navigator;
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: mocks.writeText },
  configurable: true,
  writable: true,
});
afterAll(() => {
  if (!hadClipboard) delete (navigator as { clipboard?: unknown }).clipboard;
});

beforeEach(() => {
  window.localStorage.clear();
  closed = 0;
  mocks.getActiveGenModels.mockResolvedValue({
    image: "capability-image-1",
    video: "capability-video-1",
    imageCredits: 8,
    videoCredits: 80,
    videoDefaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9", fps: 0, audio: true },
    videoAspectRatios: ["16:9", "9:16", "1:1"],
    videoDurations: [5],
    videoResolutions: ["720p"],
    videoI2vDefaultAspect: "adaptive",
    videoCreditsBySpec: { "720p:5": 11 },
    imageAspectRatios: ["1:1", "9:16", "16:9"],
    imageDefaultAspect: "1:1",
  });
  mocks.startAssetGen.mockResolvedValue({ id: "job-1", disposition: "fresh" });
  mocks.getGenJob.mockResolvedValue({ status: "DONE", generationIds: [] });
  mocks.writeText.mockResolvedValue(undefined);
  mocks.getPublicMediaLink.mockResolvedValue({ path: "/api/media/pub/signed-token", expiresInMinutes: 10 });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderPanel(variants: Variant[] = one): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(variants));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1", projectId: "p1", onClose: () => { closed += 1; }, entities: [],
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** Sheet 与 Dialog 都挂在 document.body 上,面板内容不在 React 挂载节点里。 */
function surface(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  expect(found, "资产详情 Sheet 应该已经打开").not.toBeNull();
  return found!;
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
}

function buttonNamed(scope: HTMLElement, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  expect(found, `应该有一个写着「${label}」的按钮`).toBeDefined();
  return found!;
}

/** 屏幕上所有 role="alert" 的框里写着的字 —— 商家真正读到的错误。 */
function alertsText(): string {
  return [...document.body.querySelectorAll('[role="alert"]')].map((n) => n.textContent ?? "").join(" | ");
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await act(async () => { await Promise.resolve(); });
}

describe("FRONT-A12 ① 收藏写入失败", () => {
  it("FRONT-A12 收藏被服务端拒绝:服务端那句话出现在屏幕上,心形回到未收藏", async () => {
    mocks.setFavorite.mockResolvedValue({ error: "Not found." });
    await renderPanel();

    await click(buttonNamed(surface(), "Save"));

    // 服务端原话,不是这一层编的新句子。
    expect(alertsText()).toContain("Not found.");
    expect(alertsText()).toContain("Couldn't update Saved");
    // 状态也要正确:乐观那一下必须收回去,按钮回到 "Save"。
    expect(buttonNamed(surface(), "Save")).toBeDefined();
    expect([...surface().querySelectorAll("button")].some((b) => b.textContent?.trim() === "Saved")).toBe(false);
  });

  it("FRONT-A12 收藏成功:不弹错误,按钮变成 Saved(成功不冒充、失败不沉默)", async () => {
    mocks.setFavorite.mockResolvedValue({ favorite: true });
    await renderPanel();

    await click(buttonNamed(surface(), "Save"));

    expect(alertsText()).toBe("");
    expect(buttonNamed(surface(), "Saved")).toBeDefined();
  });
});

describe("FRONT-A12 ② Copy link", () => {
  it("FRONT-A12 复制的是签名公共地址(绝对 URL),不是登录墙后面的 /files 相对路径", async () => {
    await renderPanel();

    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.getPublicMediaLink).toHaveBeenCalledWith("g1");
    const copied = mocks.writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("/api/media/pub/signed-token");
    expect(copied.startsWith("http")).toBe(true);
    expect(copied).not.toContain("/files/");
    // 一条会过期的链子,过期时长必须说出口 —— 否则「Copied!」就是另一种假成功。
    expect(surface().textContent).toContain("open the asset for 10 minutes");
  });

  it("FRONT-A12 铸链被服务端拒绝:说得出为什么,而且不冒充已复制", async () => {
    mocks.getPublicMediaLink.mockResolvedValue({ error: "Sharing links aren't configured in this environment yet." });
    await renderPanel();

    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(alertsText()).toContain("Couldn't copy the link");
    expect(alertsText()).toContain("Sharing links aren't configured in this environment yet.");
    expect(surface().textContent).not.toContain("Copied!");
  });

  it("FRONT-A12 先成功再失败:上一轮的「Copied!」必须撤掉,不与错误同屏", async () => {
    await renderPanel();

    // 第一次:真的复制成功了,屏幕上有「Copied!」和那句时长。
    await click(buttonNamed(surface(), "Copy link"));
    expect(surface().textContent).toContain("Copied!");
    expect(surface().textContent).toContain("open the asset for 10 minutes");

    // 第二次:同一颗键、同一个 6 秒窗口内失败。旧的成功提示留着的话,屏幕上会同时写着
    // 「已复制」和「复制不了」—— 商家有理由相信前者。
    // 成功之后这颗键自己写着「Copied!」(不是 "Copy link"),第二次按的就是它。
    mocks.getPublicMediaLink.mockResolvedValue({ error: "Not found." });
    await click(buttonNamed(surface(), "Copied!"));

    expect(alertsText()).toContain("Couldn't copy the link");
    expect(surface().textContent).not.toContain("Copied!");
    expect(surface().textContent).not.toContain("open the asset for 10 minutes");
  });

  it("FRONT-A12 连按两次复制:第二次的提示不被上一轮的 6 秒计时器提前抹掉", async () => {
    // 复制完贴给一个人,再复制给第二个人 —— 很自然的动作。旧写法每次成功都起一颗裸
    // `setTimeout`,谁也不撤谁:第一颗在第二次提示刚出来时到点,把「Copied!」和那句时长
    // 一起抹掉(最短只剩几毫秒),而 6 秒这个数字本来就是为了让那句时长读得完。
    await renderPanel();
    // 只假造 setTimeout / clearTimeout:这个组件到处用 queueMicrotask,连它一起假造会卡住渲染。
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await click(buttonNamed(surface(), "Copy link"));
      expect(surface().textContent).toContain("Copied!");

      await act(async () => { vi.advanceTimersByTime(5_900); });
      await click(buttonNamed(surface(), "Copied!"));
      // 第一颗计时器的到点时刻(6000)已过;没撤掉的话,这一刻提示就没了。
      await act(async () => { vi.advanceTimersByTime(200); });

      expect(surface().textContent).toContain("Copied!");
      expect(surface().textContent).toContain("open the asset for 10 minutes");

      // 新那颗照样到点收工 —— 不是把提示改成永久的。
      await act(async () => { vi.advanceTimersByTime(6_000); });
      expect(surface().textContent).not.toContain("Copied!");
    } finally {
      vi.useRealTimers();
    }
  });

  it("FRONT-A12 剪贴板被浏览器拒:不再静默吞掉,屏幕上说清楚什么都没复制成", async () => {
    mocks.writeText.mockRejectedValue(new Error("NotAllowedError"));
    await renderPanel();

    await click(buttonNamed(surface(), "Copy link"));

    expect(alertsText()).toContain("Couldn't copy the link");
    expect(alertsText()).toContain("blocked clipboard access");
    expect(surface().textContent).not.toContain("Copied!");
  });
});

describe("FRONT-A12 ③ 删除写入失败", () => {
  it("FRONT-A12 删除被服务端拒绝:确认框不关、错误可见、面板没关,Delete 还能再按", async () => {
    mocks.deleteGeneration.mockResolvedValue({ error: "Generation not found." });
    await renderPanel();

    await click(buttonNamed(surface(), "Delete"));
    const box = dialog();
    expect(box, "点 Delete 应该先弹确认框").not.toBeNull();

    await click(buttonNamed(box!, "Delete"));

    expect(dialog(), "服务端拒绝之后确认框必须还在").not.toBeNull();
    expect(alertsText()).toContain("Couldn't delete this asset");
    expect(alertsText()).toContain("Generation not found.");
    expect(closed, "面板不许关 —— 关了就跟删成功一模一样").toBe(0);
    // 重试:框里的 Delete 还在,再按一次会再发一次请求。
    await click(buttonNamed(dialog()!, "Delete"));
    expect(mocks.deleteGeneration).toHaveBeenCalledTimes(2);
  });

  it("FRONT-A12 删除成功才关面板", async () => {
    mocks.deleteGeneration.mockResolvedValue({ ok: true });
    await renderPanel();

    await click(buttonNamed(surface(), "Delete"));
    await click(buttonNamed(dialog()!, "Delete"));

    expect(closed).toBe(1);
    expect(alertsText()).toBe("");
  });
});

describe("FRONT-A12 ④ 变体选择只存在这台浏览器上", () => {
  it("FRONT-A12 多变体时,缩略图下方写明这一格只存在这台浏览器上", async () => {
    await renderPanel(two);

    expect(surface().textContent).toContain(PICK_SCOPE_NOTE);
    // 措辞不得暗示跨设备同步 —— 那正是「浏览器临时状态冒充持久化」。
    expect(PICK_SCOPE_NOTE).toContain("this browser only");
    expect(PICK_SCOPE_NOTE.toLowerCase()).not.toContain("sync");
    expect(PICK_SCOPE_NOTE.toLowerCase()).not.toContain("account");
  });

  it("FRONT-A12 换一张变体:上一张留下的错误当场作废,不冒充新这张的状态", async () => {
    mocks.setFavorite.mockResolvedValue({ error: "Not found." });
    await renderPanel(two);

    // 第一张收藏失败,错误上屏。
    await click(buttonNamed(surface(), "Save"));
    expect(alertsText()).toContain("Not found.");

    // 换第二张 —— 收藏/复制都按**选中的那一张**的 id 走,所以旧错误说的是上一张的事。
    const thumbs = [...surface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await click(thumbs[1]!);

    expect(alertsText()).toBe("");
  });

  it("FRONT-A12 只有一张图时不出现这句话(没有可选的东西就不解释存法)", async () => {
    await renderPanel(one);

    expect(surface().textContent).not.toContain(PICK_SCOPE_NOTE);
  });
});
