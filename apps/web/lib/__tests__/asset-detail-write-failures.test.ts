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
  getGenerationLineage: vi.fn(),
  getPublicMediaLink: vi.fn(),
  writeText: vi.fn(),
  listCollections: vi.fn(),
  addToCollection: vi.fn(),
  createCollection: vi.fn(),
}));

vi.mock("@/lib/asset-actions", () => ({
  getGeneration: mocks.getGeneration,
  setFavorite: mocks.setFavorite,
  saveCroppedGeneration: mocks.saveCroppedGeneration,
}));
vi.mock("@/lib/actions", () => ({
  deleteGeneration: mocks.deleteGeneration,
  // 血缘节的读(清单 B3 / P1-007)。假件**必须挂上**:漏掉它,面板里那一句
  // `getGenerationLineage(...)` 就是在调 undefined,而错误被 promise 吞掉 ——
  // 一族看起来全绿、其实半个面板没渲染的测试。
  getGenerationLineage: mocks.getGenerationLineage,
}));
vi.mock("@/lib/media-link-actions", () => ({ getPublicMediaLink: mocks.getPublicMediaLink }));
// 「Add to collection」掀的是 Library 网格那个弹层(#1159 的 `CollectionDialogs`),它一打开
// 就向服务端要一次合集列表 —— 假件挂在**动作层**上,弹层本身是真组件。
vi.mock("@/lib/library-collections", () => ({
  listCollections: mocks.listCollections,
  addToCollection: mocks.addToCollection,
  createCollection: mocks.createCollection,
}));
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
const { PUBLIC_MEDIA_TTL_SCOPE_NOTE, readTtlPick, writeTtlPick } = await import("@/lib/media-public-link");

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
/** 假服务端**真签进令牌**的那个时长。屏幕上挑的是另一回事:成功句只许照这个数字写。 */
let serverTtlMs = 10 * 60 * 1000;

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
  mocks.getGenerationLineage.mockResolvedValue({
    canvas: { id: "prj_1", name: "Hari Raya gifting" },
    conversation: { id: "thr_1", title: "Raya window display" },
    references: ["Pandan kaya jar"],
    costCredits: 80,
    status: "Delivered",
    usedIn: [],
  });
  serverTtlMs = 10 * 60 * 1000;
  // 假件**不回显**请求里的 ttl:回显的话,「成功句读服务端的数」与「成功句读屏幕上挑的数」
  // 两种写法在测试里长得一模一样,这一族就证明不了任何事。它回的是 `serverTtlMs` ——
  // 由每条测试自己说「服务端到底签了多久」,成功句必须照它写。
  mocks.getPublicMediaLink.mockImplementation(() =>
    Promise.resolve({ path: "/api/media/pub/signed-token", expiresInMs: serverTtlMs }),
  );
  mocks.listCollections.mockResolvedValue({
    collections: [{
      id: "col_1",
      name: "Raya campaign",
      itemCount: 2,
      updatedAt: "2026-09-05T02:00:00.000Z",
      coverUrl: null,
    }],
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderPanel(variants: Variant[] = one, readOnlyReason?: string): Promise<void> {
  mocks.getGeneration.mockResolvedValue(generation(variants));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DetailPanel, {
      generationId: "g1", projectId: "p1", onClose: () => { closed += 1; }, entities: [], readOnlyReason,
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

/** 原生 select / input 的受控值:React 有值追踪器,直接赋 `.value` 不会触发 onChange。 */
async function setControl(el: HTMLSelectElement | HTMLInputElement, value: string): Promise<void> {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

function control<T extends HTMLElement>(label: string): T {
  const found = surface().querySelector<T>(`[aria-label="${label}"]`);
  expect(found, `应该有一个可及名为「${label}」的控件`).not.toBeNull();
  return found!;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await act(async () => { await Promise.resolve(); });
}

describe("FRONT-A12 ① 收藏写入失败", () => {
  it("FRONT-A12 收藏被服务端拒绝:服务端那句话出现在屏幕上,心形回到未收藏", async () => {
    mocks.setFavorite.mockResolvedValue({ error: "Not found." });
    await renderPanel();

    await click(buttonNamed(surface(), "Add to favorites"));

    // 服务端原话,不是这一层编的新句子。
    expect(alertsText()).toContain("Not found.");
    expect(alertsText()).toContain("Couldn't update favorites");
    // 状态也要正确:乐观那一下必须收回去,按钮回到 "Add to favorites"。
    // 措辞是清单 B3 / P2-017 改的(Save / Saved → Add to favorites / In favorites):
    // 「Save」不说明存到哪里,而它写的就是 Library 的 Favorites 那一格。
    expect(buttonNamed(surface(), "Add to favorites")).toBeDefined();
    expect([...surface().querySelectorAll("button")].some((b) => b.textContent?.trim() === "In favorites")).toBe(false);
  });

  it("FRONT-A12 收藏成功:不弹错误,按钮变成 In favorites(成功不冒充、失败不沉默)", async () => {
    mocks.setFavorite.mockResolvedValue({ favorite: true });
    await renderPanel();

    await click(buttonNamed(surface(), "Add to favorites"));

    expect(alertsText()).toBe("");
    expect(buttonNamed(surface(), "In favorites")).toBeDefined();
  });
});

describe("FRONT-A12 ② Copy link", () => {
  it("FRONT-A12 复制的是签名公共地址(绝对 URL),不是登录墙后面的 /files 相对路径", async () => {
    await renderPanel();

    await click(buttonNamed(surface(), "Copy link"));

    // 没挑时间时下发的就是默认那一档(10 分钟),不是「不带时长」—— 服务端两种都收,
    // 但屏幕上永远挑着一档,发的就该是它。
    expect(mocks.getPublicMediaLink).toHaveBeenCalledWith("g1", 10 * 60 * 1000);
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
  it("FRONT-A12 删除被服务端拒绝:确认框不关、错误可见、面板没关,Move to trash 还能再按", async () => {
    mocks.deleteGeneration.mockResolvedValue({ error: "Generation not found." });
    await renderPanel();

    await click(buttonNamed(surface(), "Move to trash"));
    const box = dialog();
    expect(box, "点 Move to trash 应该先弹确认框").not.toBeNull();

    await click(buttonNamed(box!, "Move to trash"));

    expect(dialog(), "服务端拒绝之后确认框必须还在").not.toBeNull();
    expect(alertsText()).toContain("Couldn't move this asset to trash");
    expect(alertsText()).toContain("Generation not found.");
    expect(closed, "面板不许关 —— 关了就跟删成功一模一样").toBe(0);
    // 重试:框里的 Move to trash 还在,再按一次会再发一次请求。
    await click(buttonNamed(dialog()!, "Move to trash"));
    expect(mocks.deleteGeneration).toHaveBeenCalledTimes(2);
  });

  it("FRONT-A12 删除成功才关面板", async () => {
    mocks.deleteGeneration.mockResolvedValue({ ok: true });
    await renderPanel();

    await click(buttonNamed(surface(), "Move to trash"));
    await click(buttonNamed(dialog()!, "Move to trash"));

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
    await click(buttonNamed(surface(), "Add to favorites"));
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

/**
 * Founder 2026-09-05 裁决:「同意,但是加上可以自由设定时间」。
 *
 * 验收编号仍是 **FRONT-A12**(「任何写入失败都有错误反馈,不出现『假成功』」)—— 冻结表里
 * FRONT-A5 说的是 Library 的搜索/筛选/收藏,与链接有效期无关,挂错编号等于把这一族测试
 * 记在别人的验收条目下(#1210 判官 P2-a)。
 *
 * 挑时长这件事的**真闸在服务端**(`lib/media-link-actions.ts` 再判一次,越界拒绝铸链,
 * 钉子在 `isolation.test.ts` 那几条)。这里钉的是屏幕:挑了什么就把什么发下去,而说出口的
 * 那句时长只许照**服务端真签进令牌的那个数**写 —— 屏幕上写 24 小时而链子活 10 分钟,
 * 是同一族的假成功。
 */
describe("FRONT-A12 ⑤ Copy link 的有效期", () => {
  it("FRONT-A12 选 24 hours 之后复制:发下去的是 24 小时,成功句写的是服务端真签的那个时长", async () => {
    // 服务端这一次签的是 6 小时(与屏幕上挑的 24 小时**故意不同**)。成功句要是读屏幕上
    // 那一格而不是服务端的回话,这条就红 —— 它正是这一族存在的理由。
    serverTtlMs = 6 * 60 * 60 * 1000;
    await renderPanel();

    await setControl(control<HTMLSelectElement>("Link duration"), String(24 * 60 * 60 * 1000));
    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.getPublicMediaLink).toHaveBeenCalledWith("g1", 24 * 60 * 60 * 1000);
    expect(surface().textContent).toContain("open the asset for 6 hours");
    expect(surface().textContent).not.toContain("open the asset for 24 hours");
  });

  it("FRONT-A12 默认仍是 10 minutes,四档预设都挑得到,还有一格 Custom…", async () => {
    await renderPanel();

    const select = control<HTMLSelectElement>("Link duration");
    expect(select.value).toBe(String(10 * 60 * 1000));
    const options = [...select.options].map((o) => o.textContent?.trim());
    expect(options).toEqual(["10 minutes", "1 hour", "24 hours", "7 days", "Custom…"]);
  });

  it("FRONT-A12 自定义 2 hours:发下去的是 2 小时,成功句照服务端签的那个时长写", async () => {
    serverTtlMs = 90 * 60 * 1000;
    await renderPanel();

    await setControl(control<HTMLSelectElement>("Link duration"), "custom");
    await setControl(control<HTMLInputElement>("Custom link duration"), "2");
    await setControl(control<HTMLSelectElement>("Custom link duration unit"), "hours");
    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.getPublicMediaLink).toHaveBeenCalledWith("g1", 2 * 60 * 60 * 1000);
    expect(surface().textContent).toContain("open the asset for 90 minutes");
    expect(surface().textContent).not.toContain("open the asset for 2 hours");
  });

  it("FRONT-A12 挑过的那一档记在这台浏览器上,并且屏幕上说明了这件事", async () => {
    await renderPanel();
    await setControl(control<HTMLSelectElement>("Link duration"), String(60 * 60 * 1000));

    // 存法与那句话同源(lib/media-public-link.ts);措辞不得暗示跨设备同步。
    expect(surface().textContent).toContain(PUBLIC_MEDIA_TTL_SCOPE_NOTE);
    expect(PUBLIC_MEDIA_TTL_SCOPE_NOTE).toContain("this browser only");

    // 重开面板(同一台浏览器)⇒ 回到上次挑的那一档,不是默认档。
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    await renderPanel();
    expect(control<HTMLSelectElement>("Link duration").value).toBe(String(60 * 60 * 1000));
  });

  it("FRONT-A12 自定义值正好等于某个预设(60 分钟):重开面板仍停在 Custom…,不跳回预设档", async () => {
    await renderPanel();

    await setControl(control<HTMLSelectElement>("Link duration"), "custom");
    await setControl(control<HTMLInputElement>("Custom link duration"), "60");
    // 60 minutes 与「1 hour」那一档是同一个毫秒数。只存数字的话,重开面板会跳回预设档 ——
    // 商家会以为自己填的那一格没保住(#1210 判官 P2-e)。
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    await renderPanel();

    expect(control<HTMLSelectElement>("Link duration").value).toBe("custom");
    expect(control<HTMLInputElement>("Custom link duration").value).toBe("1");
    expect(control<HTMLSelectElement>("Custom link duration unit").value).toBe("hours");
  });

  it("FRONT-A12 只开面板不碰那一格:一个字都不往浏览器存储里写;真改了才写", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      await renderPanel();
      // 挂载就写＝把默认档冒充成「商家挑过的偏好」(#1210 判官 P2-d)。
      expect(setItem).not.toHaveBeenCalled();

      await setControl(control<HTMLSelectElement>("Link duration"), String(60 * 60 * 1000));
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it("FRONT-A12 浏览器禁掉站点存储(getItem 直接抛):面板照常打开,按默认 10 minutes 渲染", async () => {
    // 隐私设置关掉站点存储时 localStorage 的每一次读都抛。这一格只是个方便,不能连累
    // 整个素材面板打不开(#1210 判官 P2-c)。
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      await renderPanel();
      expect(surface().textContent).toContain(MERCHANT_PROMPT);
      expect(control<HTMLSelectElement>("Link duration").value).toBe(String(10 * 60 * 1000));
      expect(buttonNamed(surface(), "Copy link")).toBeDefined();
    } finally {
      getItem.mockRestore();
    }
  });

  it("FRONT-A12 自定义 90 天:当场说不行,一条链子都不铸、也不冒充已复制", async () => {
    await renderPanel();

    await setControl(control<HTMLSelectElement>("Link duration"), "custom");
    await setControl(control<HTMLInputElement>("Custom link duration"), "2160"); // 90 天
    await setControl(control<HTMLSelectElement>("Custom link duration unit"), "hours");
    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.getPublicMediaLink).not.toHaveBeenCalled();
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(alertsText()).toContain("Couldn't copy the link");
    expect(alertsText()).toContain("A link can work for at most 30 days.");
    expect(surface().textContent).not.toContain("Copied!");
  });

  it("FRONT-A12 自定义框空着 / 填了看不懂的东西:说得出该填什么,不发请求", async () => {
    await renderPanel();

    await setControl(control<HTMLSelectElement>("Link duration"), "custom");
    await setControl(control<HTMLInputElement>("Custom link duration"), "");
    await click(buttonNamed(surface(), "Copy link"));

    expect(mocks.getPublicMediaLink).not.toHaveBeenCalled();
    expect(alertsText()).toContain("Enter how long the link should work, in whole minutes or hours.");
  });

  it("FRONT-A12 存储写满(setItem 抛 QuotaExceededError):记不住没关系,不许炸到面板上", async () => {
    // 读侧的那一条(getItem 直接抛)已经有钉子,写侧一直没有 —— 判官 #1210 P2-3 实测
    // 「写侧无任何变异可证」。配额满、隐私设置只读、无痕模式,`setItem` 都会直接抛。
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    try {
      // ① 直接打这个函数:它自己吞掉,不往外抛,也没有留下半条记录。
      expect(() => writeTtlPick({ ttlMs: 60 * 60 * 1000, source: "preset" })).not.toThrow();

      // ② 面板上真挑一档:照常挑得动、照常铸得出链子,挑的就是屏幕上那一档。
      await renderPanel();
      await setControl(control<HTMLSelectElement>("Link duration"), String(24 * 60 * 60 * 1000));
      expect(control<HTMLSelectElement>("Link duration").value).toBe(String(24 * 60 * 60 * 1000));

      serverTtlMs = 24 * 60 * 60 * 1000;
      await click(buttonNamed(surface(), "Copy link"));
      expect(mocks.getPublicMediaLink).toHaveBeenCalledWith("g1", 24 * 60 * 60 * 1000);
      expect(surface().textContent).toContain("Copied!");
      // 存不进去就当没挑过 —— 下次开面板回默认档,而不是报错。
      expect(readTtlPick()).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it("FRONT-A12 换一张变体:上一轮的「Copied!」与那句时长当场作废(剪贴板里是上一张的链子)", async () => {
    await renderPanel(two);

    serverTtlMs = 24 * 60 * 60 * 1000;
    await setControl(control<HTMLSelectElement>("Link duration"), String(24 * 60 * 60 * 1000));
    await click(buttonNamed(surface(), "Copy link"));
    expect(surface().textContent).toContain("Copied!");
    expect(surface().textContent).toContain("open the asset for 24 hours");

    const thumbs = [...surface().querySelectorAll("button")].filter((b) => b.querySelector('img[alt^="Variant"]'));
    expect(thumbs.length, "多图时应该有变体缩略图").toBeGreaterThanOrEqual(2);
    await click(thumbs[1]!);

    expect(surface().textContent).not.toContain("Copied!");
    expect(surface().textContent).not.toContain("open the asset for");
    // 挑好的那一档不跟着作废 —— 作废的是「已经复制好了」这个回执。
    expect(control<HTMLSelectElement>("Link duration").value).toBe(String(24 * 60 * 60 * 1000));
  });
});

/**
 * 清单 B3(P2-017)—— 详情面的第二颗「存到哪里」的键:Add to collection。
 *
 * 收藏那一颗是自己的写(`setFavorite`),这一颗不是:它掀开的是 Library 网格用的**同一个**
 * 弹层(`components/library/CollectionDialogs`,#1159 的动作层)。所以这里钉的是「按下去
 * 掀起来的确实是那一个」,而不是这一面又复制了第二份合集实现 —— 复制的那天,两处会开始
 * 对同一个合集说两套话。
 *
 * 变异自查:把 `setCollectionOpen(true)` 去掉 ⇒ 第一条红;把 `disabled={readOnly}` 去掉
 * ⇒ 第二条红。
 */
describe("FRONT-A12 ⑥ Add to collection", () => {
  it("FRONT-A12 按下去掀的是 Library 那个合集弹层,不是这一面自己的第二份", async () => {
    await renderPanel();

    await click(buttonNamed(surface(), "Add to collection"));

    const opened = dialog();
    expect(opened, "按下 Add to collection 之后应该有一个弹层").not.toBeNull();
    expect(opened?.textContent ?? "").toContain("Add to collection");
    // 弹层一打开就向**动作层**要一次合集列表 —— 证明掀起来的是那个真弹层,
    // 而不是一段长得像它的静态壳。
    expect(mocks.listCollections).toHaveBeenCalled();
    expect(opened?.textContent ?? "").toContain("Raya campaign");
  });

  it("FRONT-A12 只读的那一面按不动它 —— 键在,但是灰的,不掀任何弹层", async () => {
    await renderPanel(one, "This asset is read-only.");

    const button = buttonNamed(surface(), "Add to collection");
    expect(button.disabled, "只读时 Add to collection 仍可按").toBe(true);
    await click(button);
    expect(dialog(), "只读时按下去仍掀开了合集弹层").toBeNull();
  });
});

/**
 * 清单 B3(P1-007)—— 血缘节在屏幕上真的画得出来,而且**没有记录时一个字都不说**。
 *
 * 变异自查:把 `lineage &&` 那个条件去掉 ⇒「读不到就整块不出现」红。
 */
describe("FRONT-A14 血缘节:出处、参考、成本、状态、用途", () => {
  it("五格都写在面板上,画布与对话都能点回去", async () => {
    mocks.getGenerationLineage.mockResolvedValue({
      canvas: { id: "prj_1", name: "Hari Raya gifting" },
      conversation: { id: "thr_1", title: "Raya window display" },
      references: ["Pandan kaya jar"],
      costCredits: 80,
      status: "Delivered",
      usedIn: ["Shot 2"],
    });
    await renderPanel();

    const text = surface().textContent ?? "";
    expect(text).toContain("Where this came from");
    expect(text).toContain("Hari Raya gifting");
    expect(text).toContain("Raya window display");
    expect(text).toContain("References used: Pandan kaya jar");
    expect(text).toContain("Cost: 80 credits");
    expect(text).toContain("Status: Delivered");
    expect(text).toContain("Used in: Shot 2");

    const links = [...surface().querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links, "出处画布点不回去").toContain("/create/canvas?project=prj_1");
    expect(links, "出处对话点不回去").toContain("/create/canvas?project=prj_1&thread=thr_1");
  });

  it("没花过钱的那一行说 no credits charged,不写一个假的 0 credits", async () => {
    mocks.getGenerationLineage.mockResolvedValue({
      canvas: { id: "prj_1", name: "Hari Raya gifting" },
      conversation: null,
      references: [],
      costCredits: 0,
      status: "Uploaded by you",
      usedIn: [],
    });
    await renderPanel();
    const text = surface().textContent ?? "";
    expect(text).toContain("Cost: no credits charged");
    // 没有引用、没有去处 ⇒ 那两行整行不出现,不写一句 "None"。
    expect(text).not.toContain("References used");
    expect(text).not.toContain("Used in:");
  });

  it("成本未知(有任务、零账本行)⇒ 那一行不出现,不编一个数", async () => {
    mocks.getGenerationLineage.mockResolvedValue({
      canvas: { id: "prj_1", name: "Hari Raya gifting" },
      conversation: null,
      references: [],
      costCredits: null,
      status: "Delivered",
      usedIn: [],
    });
    await renderPanel();
    expect(surface().textContent ?? "").not.toContain("Cost:");
  });

  it("血缘读不到 ⇒ 整块不渲染,一个字都不说(素材本身照常显示)", async () => {
    mocks.getGenerationLineage.mockResolvedValue({ error: "Not found." });
    await renderPanel();
    const text = surface().textContent ?? "";
    expect(text).not.toContain("Where this came from");
    expect(text).not.toContain("Status:");
    // 素材本身还在 —— 一次追溯读失败不该把这一面拖成错误态。
    expect(text).toContain("Add to favorites");
  });
});
