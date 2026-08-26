// @vitest-environment jsdom
/**
 * r22-library-beta-sanitise.test.ts —— beta 清扫在 Library 这一面的行为契约
 * (审计 P2-3 / P2-5 / P2-20,2026-08-26)。
 *
 * 三件事,三种病:
 *
 *   ① **P2-3 Download**:按下去只得到一句「下载还没接上」。诚实,但商家按之前不知道自己
 *      要按到一句道歉,而下载是创作交付的最后一公里 —— 摆着它等于在成品旁边挂一扇打不开
 *      的门。beta 期不摆出来。**只藏不删**:`download()` 与两处控件一行没删,藏在
 *      `LIBRARY_DOWNLOAD_ENABLED` 后面,所以这里除了「屏幕上没有」,还钉「源码里还在」——
 *      少了后半条,下一个人会把它当死代码清掉,通道接上时得重写一遍。
 *
 *   ② **P2-5 生产网格星标**:此前只弹一句「星标还没接到生产 Library」,而且带着
 *      `aria-pressed={item.favorite}` —— 按下去 aria 状态不动,读屏软件读出一个**假的按下
 *      态**,比没有这颗键更糟。而「还没接上」这个前提本身是错的:`setFavorite` 早就在,
 *      owner 作用域在服务端,同一颗星在 `components/asset/DetailPanel.tsx` 上已经这么写回
 *      去了。所以这里是**修活**,不是藏:钉「真的调了那个 action」「aria 跟着翻」「写不进
 *      去时翻回原样并说一句」三条。
 *
 *   ③ **P2-20 详情层两条同 href 的链接**:「Made in Raya launch」与「Open in Canvas」按下去
 *      到同一块板。重复的入口不是多一条路,是多一次「这两颗有什么不一样」的犹豫。合并成带
 *      项目名那一条 —— 它多说了一件对方不知道的事,而丢掉的那半件(说得出自己开的是
 *      Canvas)补进了可及名字。
 *
 * 变异自查(逐条实做,做完还原,红 → 绿):
 *   · `LIBRARY_DOWNLOAD_ENABLED` 翻成 `true` ⇒ ①-a、①-b 两条红;
 *   · `toggleStar` 里把 `await setFavorite(...)` 那一行删掉(只翻本地)⇒ ②-a 红;
 *   · `toggleStar` 的失败支里把回滚那一行删掉 ⇒ ②-c 红;
 *   · `LibraryDetailLayer` 把 `Open in Canvas` 那条 `<Link>` 加回动作排 ⇒ ③-a 红;
 *   · 合并那条链接的 `aria-label` 删掉 ⇒ ③-b 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, installToastEnvironment, latestToast, settleToasts, toastTexts, withToaster } from "./__helpers__/toast-probe";

installToastEnvironment();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/library",
}));

/** 服务端动作在 jsdom 里没有服务端 —— 换成替身,断言看的是「这一颗真的去调了它」。 */
const actions = vi.hoisted(() => ({ setFavorite: vi.fn(), getGenerationHistory: vi.fn() }));
vi.mock("@/lib/asset-actions", () => ({ setFavorite: actions.setFavorite }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: actions.getGenerationHistory }));

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { LibraryWorkroom, LIBRARY_DOWNLOAD_ENABLED } = await import("@/components/library/LibraryWorkroom");
const { R22LibraryView } = await import("@/components/library/R22LibraryView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  actions.setFavorite.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  clearToasts();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

async function mount(element: Parameters<typeof withToaster>[0]): Promise<void> {
  await act(async () => { root!.render(withToaster(element)); });
}

async function click(node: Element | null | undefined): Promise<void> {
  expect(node, "要按的那颗键不在屏幕上").toBeTruthy();
  await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

function source(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

/** 弹层走 Portal,挂在 `document.body` 上。 */
function layer(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>(".r22-lib-layer");
  if (!node) throw new Error("详情层没开");
  return node;
}

function libraryItem(id: string, prompt: string, favorite: boolean) {
  return {
    id,
    projectId: `project-${id}`,
    assetId: `asset-${id}`,
    url: `/media/${id}.jpg`,
    kind: "image" as const,
    prompt,
    favorite,
    createdAt: "2026-08-20T02:00:00.000Z",
  };
}

/* ── ① P2-3:Download 这一期不摆出来 ────────────────────────────────────────── */

describe("① Download 藏在开关后面", () => {
  it("①-a 单图详情的动作排里没有 Download,也没有那句道歉", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    await click(container!.querySelector('button[aria-label="Open Raya table setting"]'));

    const acts = [...layer().querySelectorAll(".r22-lib-layer-acts button")].map((node) => node.textContent?.trim());
    expect(acts, "详情层又把 Download 摆回来了").not.toContain("Download");
    expect(acts.length, "动作排空了或者多出一颗没人认得的键").toBe(3);
    // 藏干净 = 屏幕上连那句道歉的影子都没有(它此前是按下去才出现的,所以这里也按一遍剩下的)。
    expect(document.body.textContent).not.toContain("Downloads are not switched on");
  });

  it("①-b 批量条里也没有 Download —— 两处一起藏,不是只藏看得见的那一处", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    await click(container!.querySelector('[role="checkbox"][aria-label="Select Raya table setting"]'));

    const bulk = container!.querySelector(".r22-lib-bulk");
    expect(bulk, "批量条没出来").toBeTruthy();
    const labels = [...bulk!.querySelectorAll("button")].map((node) => node.textContent?.trim());
    expect(labels).not.toContain("Download");
    expect(labels).toContain("Star");
  });

  it("①-c 只藏不删:开关、`download()` 与两处控件都还在源码里", () => {
    expect(LIBRARY_DOWNLOAD_ENABLED, "beta 期这个开关必须是关着的").toBe(false);
    const workroom = source("components/library/LibraryWorkroom.tsx");
    expect(workroom, "`download()` 被当死代码清掉了 —— 通道接上时得重写一遍").toContain("function download()");
    expect(workroom, "批量条那颗 Download 没了,不是藏").toContain(">Download</Button>");
    expect(workroom, "详情层那一路没有走同一个开关").toContain("LIBRARY_DOWNLOAD_ENABLED ? download : null");
    expect(source("components/library/LibraryDetailLayer.tsx"), "详情层那颗 Download 没了,不是藏").toContain("Download</Button>");
  });
});

/* ── ② P2-5:生产网格的星标真的写回库 ──────────────────────────────────────── */

describe("② 生产网格的星标", () => {
  it("②-a 按下去真的去写库,aria 按下态跟着翻", async () => {
    actions.setFavorite.mockResolvedValue({ favorite: true });
    await mount(createElement(R22LibraryView, { initialItems: [libraryItem("gen-1", "A pandan candle", false)] }));

    const star = container!.querySelector<HTMLButtonElement>(".r22-library-star")!;
    expect(star.getAttribute("aria-pressed")).toBe("false");

    await click(star);

    expect(actions.setFavorite, "那一颗根本没去写库").toHaveBeenCalledWith("gen-1", true);
    expect(container!.querySelector(".r22-library-star")!.getAttribute("aria-pressed"), "读屏软件仍然读到一个假的按下态").toBe("true");
    await settleToasts();
    expect(toastTexts(), "写成了还要多说一句").toHaveLength(0);
  });

  it("②-b 星标计数与 Starred 那一格跟着走 —— 屏上那个数不是另算的", async () => {
    actions.setFavorite.mockResolvedValue({ favorite: true });
    await mount(createElement(R22LibraryView, { initialItems: [libraryItem("gen-1", "A pandan candle", false)] }));

    expect(container!.querySelector('[data-r22-library-count="star"]')!.textContent).toBe("0");
    await click(container!.querySelector(".r22-library-star"));
    expect(container!.querySelector('[data-r22-library-count="star"]')!.textContent).toBe("1");
  });

  it("②-c 写不进去的时候星翻回原样,并且说一句实话", async () => {
    actions.setFavorite.mockResolvedValue({ error: "Not found." });
    await mount(createElement(R22LibraryView, { initialItems: [libraryItem("gen-1", "A pandan candle", false)] }));

    await click(container!.querySelector(".r22-library-star"));

    expect(
      container!.querySelector(".r22-library-star")!.getAttribute("aria-pressed"),
      "库里没存,屏幕上却留着一颗翻了面的星",
    ).toBe("false");
    await settleToasts();
    expect(latestToast()).toContain("could not be saved");
    expect(latestToast()).toContain("Not found.");
  });
});

/* ── ③ P2-20:通往那块板的路只剩一条 ──────────────────────────────────────── */

describe("③ 详情层的回链", () => {
  it("③-a 同一块板只有一条链接,带着项目名", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    await click(container!.querySelector('button[aria-label="Open Raya table setting"]'));

    const links = [...layer().querySelectorAll<HTMLAnchorElement>("a[href]")];
    expect(links, "详情层又画出了第二条通往同一块板的链接").toHaveLength(1);
    expect(links[0]!.textContent).toContain("Made in Raya launch");
    expect(links[0]!.getAttribute("href")).toContain("project=fixture-raya");
  });

  it("③-b 合并之后那一条仍然说得出自己开的是哪扇门", async () => {
    await mount(createElement(LibraryWorkroom, { restore: false }));
    await click(container!.querySelector('button[aria-label="Open Raya table setting"]'));

    const link = layer().querySelector<HTMLAnchorElement>("a[data-r22-lib-open]")!;
    expect(link, "合并把去处这件事一起丢了").toBeTruthy();
    expect(link.getAttribute("aria-label")).toBe("Open Raya launch in Canvas");
  });
});
