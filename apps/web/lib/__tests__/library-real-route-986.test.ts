// @vitest-environment jsdom
/**
 * library-real-route —— #986 / W2-1:Library 变真路由(规格书 `docs/specs/wave2-shell.md` §4.3)。
 *
 * 这一票之前 `/library` 是一段 redirect shim,商家站在素材库上刷新一次页面就被甩回聊天壳。
 * 换壳的第一个目标(§1.1 G1)原话就是这一句的反面:「在 Library 上刷新页面,回来还在
 * Library」。所以这份围栏钉的是**商家看得见的四件事**,不是内部函数长什么样:
 *
 *   ① `/library` 与 `/library/editor` 各有一个真的路由文件,而且 `/library` 里没有
 *      redirect —— 「有门没页」和「门后面还是一次跳转」都要红;地址逐字来自 `SHELL_ROUTES`,
 *      这份文件里一个路径字面量都不许自己写(规格书 §1.3)。
 *      (R3-F10 起,`/library` 是 `page.tsx`、`/library/editor` 是 `route.ts` ——
 *      停放旧地址改用 Route Handler 才答得出真的 307,理由在 `lib/parked-route-redirect.ts`。)
 *   ② 两页真的画得出来:真 React、真组件、真 effect,断言落在屏幕上的字上。
 *   ③ **Stack A 纪律**(§6.3):导航权威 `MERCHANT_NAV` 一个字没动,旧壳照旧 —— 商家点导轨
 *      仍然走 `/otto?view=library`,只有输 URL 才到得了新页。旧壳有任何行为变化都要红。
 *   ④ 两处手搓弹窗换成 `components/ui/dialog` 之后,焦点陷阱与 Escape 真的到位 ——
 *      这两样正是手搓那一版**完全没有**的东西,所以断言的是行为,不是 import 了什么。
 *
 * 变异自查(逐一实做,做完全部还原,红→绿):
 *   - 把 `app/library/page.tsx` 换回 `redirect("/otto?view=library")` ⇒ ①「不是 shim」红;
 *   - 删掉 `app/library/editor/route.ts` ⇒ ①「每条新地址都有门」红;
 *   - 把 AddAssetDialog 的 `<Dialog>` 换回手搓 `fixed inset-0 role="dialog"` ⇒ ④ 的 Escape、
 *     焦点陷阱、无手搓遮罩三条一起红;
 *   - 把 `MERCHANT_NAV` 里 Library 那一格的 href 改成 `/library` ⇒ ③ Stack A 红;
 *   - 判官 P2-1 那一发(它抓到的正是下面这条断言曾经是摆设):给 DialogContent 加一句
 *     `onEscapeKeyDown={(e) => e.preventDefault()}` 压制 Escape ——
 *       · 事件不带 `cancelable` 时:**20/20 全绿**,压制被放过去了(实测复现);
 *       · 事件带上 `cancelable: true` 之后:同一个变异当场红。
 *     所以这条断言的可信度不在「有没有 dispatch」,而在事件本身取不取消得掉。
 */
import fs from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MERCHANT_NAV_REDIRECTS, SHELL_ROUTES } from "@fikirtive/core/navigation";
import type { AdJobItem } from "@/lib/data";
import { expectFocusInside } from "./focus-trap-wait";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");
/** 注释里的路径是历史,不是事实 —— 判定前先剥掉(与 edit-desk-two-surfaces 同一个做法)。 */
const codeOf = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** 一条新地址 → 它的路由文件。地址来自 SHELL_ROUTES,这里不抄第二份。 */
const routeFileFor = (href: string) => path.join("app", href.replace(/^\//, ""), "page.tsx");

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getEntities: vi.fn(),
  getMyAds: vi.fn(),
  getMyAdJobs: vi.fn(),
  getRecentGenerationThumbs: vi.fn(),
  getProjects: vi.fn(),
  listBrandRecords: vi.fn(),
  saveBrandRecord: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
  updateEntity: vi.fn(),
  softDeleteEntity: vi.fn(),
  createEntity: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
  getGenerationHistory: vi.fn(),
  getLibraryElements: vi.fn(),
  getEditDesk: vi.fn(),
  redirect: vi.fn((url: string) => {
    // next/navigation 的 redirect() 靠抛异常中断渲染 —— 假件也必须抛,否则被测代码会
    // 继续往下跑,而生产里它不会。
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// 租户围栏收尾片（#464）：/library 现在从这个模块拿 `resolveUserPrincipal` 建帧;单测 mock
// 掉了整个 `@/lib/auth-guard`，补上 #464 B1 既有的共享 stub（其它切片同款用法）。
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mocks.requireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/data", () => ({
  getEntities: mocks.getEntities,
  getMyAds: mocks.getMyAds,
  getMyAdJobs: mocks.getMyAdJobs,
  getRecentGenerationThumbs: mocks.getRecentGenerationThumbs,
  getProjects: mocks.getProjects,
}));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (row: unknown) => row }));
vi.mock("@/lib/brand-record-actions", () => ({
  listBrandRecords: mocks.listBrandRecords,
  saveBrandRecord: mocks.saveBrandRecord,
}));
vi.mock("@/lib/actions", () => ({
  getOrCreateDefaultProject: mocks.getOrCreateDefaultProject,
  updateEntity: mocks.updateEntity,
  softDeleteEntity: mocks.softDeleteEntity,
  createEntity: mocks.createEntity,
  startCaption: vi.fn(),
  getCaptionJob: vi.fn(),
  getRenderJobs: vi.fn(),
}));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
// 前端基线段②:`/library` 改画已批准的 Library pattern,它的三个读之一是 Elements。
vi.mock("@/lib/library-elements", () => ({ getLibraryElements: mocks.getLibraryElements }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));
vi.mock("@/lib/edit-desk-actions", () => ({
  getEditDesk: mocks.getEditDesk,
  joinClipsIntoCut: vi.fn(),
  setCutMusic: vi.fn(),
  clearCutMusic: vi.fn(),
  addCaptionsToClip: vi.fn(),
  clearCutCaptions: vi.fn(),
  exportSavedCut: vi.fn(),
}));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
// 与 #942 同一个理由:资产详情面不是这份围栏在测的东西,它会把整条花费/详情路径拖进来。
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: LibraryPage } = await import("@/app/library/page");
// R3-F10:`/library/editor` 从 `page.tsx` + `redirect()` 改成 Route Handler。头上的
// `app/library/loading.tsx` 是下面 `/library` 那张真页面要的骨架,挪不走;而在那层 Suspense
// 边界下面,`redirect()` 只答得出 HTTP 200 + 一屏骨架(实测在 `lib/parked-route-redirect.ts`)。
const { GET: LibraryEditorRoute } = await import("@/app/library/editor/route");
const { OttoStuff } = await import("@/components/otto/OttoStuff");
const { AddAssetDialog } = await import("@/components/otto/stuff/AddAssetDialog");

/**
 * 一次测试里可能挂载**不止一次**(例如同一页在「没有失败任务」与「有失败任务」两种数据下
 * 各画一次),所以挂载点要逐个记下来、逐个拆掉。
 *
 * 这不是洁癖:本仓的 vitest 让同一个 jsdom `document` 跨文件活着,而 Radix 的弹窗走
 * Portal 挂在 `document.body` 上。漏掉一个没拆的 root,它的弹窗就会留在 body 里,被**后面
 * 那些文件**的 `document.querySelector('[role="dialog"]')` 捡到 —— 实测正是这样:这份文件
 * 单跑全绿,进了全量套件却把 library-empty-states / library-guardrails-934 / refgen-topup-exit
 * 三份一起弄红。所以这里拆干净,再把 body 收一次尾。
 */
const mounted: { root: Root; container: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "shop@test.my", ownerId: "own_1" });
  mocks.getEntities.mockResolvedValue([]);
  mocks.getMyAds.mockResolvedValue([]);
  mocks.getMyAdJobs.mockResolvedValue([]);
  mocks.getRecentGenerationThumbs.mockResolvedValue([]);
  mocks.listBrandRecords.mockResolvedValue([]);
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  mocks.getLibraryElements.mockResolvedValue([]);
  mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "prj_default" });
  mocks.getProjects.mockResolvedValue([{ id: "prj_1", name: "Raya", pinnedAt: null }]);
  mocks.getEditDesk.mockResolvedValue({
    media: [{ src: "clip-a", kind: "video", seconds: 4, label: "Opening shot" }],
    cut: { clips: [], seconds: 0, captionCount: 0, music: null },
    unreadable: false,
  });
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  // Portal 挂在 body 上,不在挂载点里 —— 拆完 root 之后再收一次尾,下一份文件拿到的是
  // 一个干净的 document。
  document.body.replaceChildren();
});

/** 返回 `document.body`:Radix 的弹窗走 Portal,不在挂载点那一支里。 */
async function mount(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return document.body;
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

const FAILED_JOB: AdJobItem = {
  id: "job_1",
  projectId: "prj_1",
  threadId: "thr_1",
  kind: "image",
  status: "failed",
  prompt: "A plate of laksa on a rattan table",
  createdAt: new Date("2026-08-18T02:00:00.000Z").toISOString(),
  error: "The model refused this one.",
};

/* ── ① 门后面真的有页,而且不是又一次跳转 ────────────────────────────────────── */

describe("Library 是真路由,不是 redirect shim", () => {
  // R3-F10:「有门没页」钉的是**门在不在**,不是那扇门长成 `page.tsx` 还是 `route.ts`。
  // `/library` 是真页面,所以它必须是 `page.tsx`;`/library/editor` 是停放旧地址,改成
  // Route Handler 才答得出真的 307(理由在 `lib/parked-route-redirect.ts`),所以它是
  // `route.ts`。两边都逐字点名,不用「随便哪个都行」把判据放松掉。
  it.each([
    ["library", SHELL_ROUTES.library, "page.tsx"],
    ["edit", SHELL_ROUTES.edit, "route.ts"],
  ])("%s(%s)有自己的 %s —— 不许「有门没页」", (_key, href, file) => {
    const relative = path.join("app", href.replace(/^\//, ""), file);
    expect(fs.existsSync(path.join(WEB_ROOT, relative)), `${href} 没有路由文件`).toBe(true);
  });

  it("`/library` 里除了登录守卫没有别的 redirect —— shim 真的撤了", () => {
    const source = codeOf(routeFileFor(SHELL_ROUTES.library));
    // 送去登录页那一条不是 shim,是守卫;除它以外一条跳转都不许有。
    const jumps = [...source.matchAll(/\bredirect\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(jumps, "这一页还在把商家甩去别处").toEqual(["/login"]);
    expect(source).toContain("requireOwner");
  });

  it("导航权威里不再把 `/library` 当成一条收敛掉的旧路由", () => {
    const stale = MERCHANT_NAV_REDIRECTS.filter((row) => row.from === SHELL_ROUTES.library);
    expect(stale, "这张表要求每条 from 都有一个真的 redirect 文件 —— 留着这一行就是要求 shim 回来").toEqual([]);
  });

  it("剪辑台那扇门的地址取自权威常量,不在路由文件里手写第二份", () => {
    const source = codeOf(path.join("app", SHELL_ROUTES.edit.replace(/^\//, ""), "route.ts"));
    expect(source).toContain("SHELL_ROUTES");
    expect(source, "路由文件里硬写了自己的地址").not.toContain(`"${SHELL_ROUTES.edit}"`);
  });

  it("`/library` 的加载态走 ui/skeleton,不手搓(规格书 §5.6)", () => {
    const relative = path.join("app", SHELL_ROUTES.library.replace(/^\//, ""), "loading.tsx");
    expect(fs.existsSync(path.join(WEB_ROOT, relative)), `${SHELL_ROUTES.library} 没有加载态`).toBe(true);
    const source = codeOf(relative);
    expect(source, `${relative} 没走 ui/skeleton`).toContain("@/components/ui/skeleton");
    expect(source, `${relative} 又手搓了一份骨架`).not.toContain("animate-pulse");
  });

  /**
   * R3-F10 —— 剪辑台那一层的骨架被**删掉**,而且必须保持删掉。
   *
   * 「每一页都要有加载态」是对**真页面**说的。`/library/editor` 自 W2-11 起一个像素都不画,
   * 它只做一件事:把人送回 Create。给它留一份 `loading.tsx` 不是多一层体贴 —— 那层
   * Suspense 边界正是把这条旧地址的 307 压成 HTTP 200 + 一屏骨架的原因(本机实测,
   * `lib/parked-route-redirect.ts`)。所以这一条把「不许再长回来」也钉住:谁把它加回去,
   * 这条红,而不是等 e2e 起完服务器才发现商家又在看一屏不属于任何人的剪辑台骨架。
   */
  it("R3-F10:停放的剪辑台没有、也不许再有 loading.tsx —— 它没有内容可等", () => {
    const relative = path.join("app", SHELL_ROUTES.edit.replace(/^\//, ""), "loading.tsx");
    expect(
      fs.existsSync(path.join(WEB_ROOT, relative)),
      `${relative} 又回来了 —— 它会把这条旧地址的 307 压回 200 + 骨架`,
    ).toBe(false);
  });
});

/* ── ② 两页真的画得出来 ─────────────────────────────────────────────────────── */

describe("两页真的画得出来(真 React,真组件)", () => {
  it("`/library` 画的是素材库本身,不是一个空壳", async () => {
    const dom = await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));

    expect(dom.querySelector("h1")?.textContent).toBe("Library");
    // 前端基线段②:副标题改由已批准的 Library pattern 提供(旧壳那句
    // 「Everything you and Otto have made or saved across every project.」随 OttoStuff 一起退场)。
    expect(dom.textContent).toContain("Find, organize and reuse everything you create.");
    // 三个读都在,而且身份只来自服务端 principal —— 页面不往下传 ownerId。
    expect(mocks.getGenerationHistory).toHaveBeenCalled();
    expect(mocks.getLibraryElements).toHaveBeenCalled();
    expect(mocks.getProjects).toHaveBeenCalledWith("own_1");
  });

  it("`/library` 不自己组装列表 —— 读取与展示仍然分家(行为围栏)", () => {
    const page = codeOf(routeFileFor(SHELL_ROUTES.library));
    expect(page, "页面自己动手组装列表了 —— 路由只负责取数与守卫").not.toContain("buildStuffItems");
    expect(page, "页面自己开了一条 prisma 查询,绕过了 owner-gated 的读").not.toContain("prisma.");
  });

  it("没登录的人到不了 Library —— 守卫在,而且送去登录页", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(LibraryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("`/library/editor` 是旧书签入口,直接回到 Create(R3-F10:一条真的 307)", () => {
    const res = LibraryEditorRoute();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(SHELL_ROUTES.create);
    expect(mocks.getEditDesk).not.toHaveBeenCalled();
  });

  // W2-11(换壳切换总票)删掉了这条原来所在的「Stack A:旧壳零行为变化」describe —— 那个
  // 名字本身描述的是「新旧路由并存」那段过渡期,旧壳(`OttoView.tsx`/`OttoApp.tsx`)随本票
  // 删除,过渡期结束。这条断言本身仍然成立,搬进这里(它测的是**这一页**,不是新旧对照)。
  // 前端基线段②起,这条断言不再指向 `/library`(那一页改画已批准的 Library pattern,
  // 上面没有聊天,也没有失败任务卡)。它测的一直是 `OttoStuff` 自己的行为——按 handler
  // 在不在决定画不画那两颗「跳进聊天」的键——所以直接挂它,断言一字未改。
  // 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
  it("聊天不在这一页上,「跳进聊天」的两颗键就不出现", async () => {
    const dom = await mount(
      createElement(OttoStuff, { entities: [], ads: [], adJobs: [FAILED_JOB], records: [], history: [] }),
    );

    expect(dom.textContent, "失败的那一条仍然要说话").toContain("Didn't go through");
    expect(buttonWithText(dom, "Open conversation"), "一颗按下去什么都不发生的键").toBeFalsy();
    expect(buttonWithText(dom, "Retry with Otto")).toBeFalsy();
    // 「Hide」不依赖聊天,它照旧在 —— 免得上面两条其实是「整排键都没画出来」。
    expect(buttonWithText(dom, "Hide")).toBeTruthy();
  });
});

/* ── ④ 手搓弹窗换掉之后,焦点与键盘真的到位 ───────────────────────────────── */

describe("两处手搓弹窗换成 ui/dialog(规格书 §4.3)", () => {
  const HAND_ROLLED = /className="fixed inset-0[^"]*"[\s\S]{0,200}?role="dialog"/;

  it.each([
    "components/otto/stuff/AddAssetDialog.tsx",
    "components/otto/OttoStuff.tsx",
  ])("%s 里没有手搓的 `fixed inset-0 … role=\"dialog\"` 遮罩", (relative) => {
    const source = codeOf(relative);
    expect(source, "手搓弹窗又回来了").not.toMatch(HAND_ROLLED);
    expect(source).toContain("@/components/ui/dialog");
  });

  it("Add to Library:按 Escape 真的关得掉(手搓那一版根本不认这个键)", async () => {
    const onClose = vi.fn();
    await mount(createElement(AddAssetDialog, { open: true, onClose, onDone: vi.fn() }));

    expect(document.querySelector('[role="dialog"]'), "弹窗没开").toBeTruthy();
    await act(async () => {
      // `cancelable: true` 不是装饰(判官 P2-1):不可取消的事件上 preventDefault 是空操作,
      // 于是**任何压制 Escape 的改动**(例如给 DialogContent 加一个 onEscapeKeyDown 拦截)
      // 都还是关得掉弹窗 —— 这条断言就活成了摆设。判官已实证:补上之后同一个压制变异当场红。
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    expect(onClose, "按了 Escape,弹窗当没听见").toHaveBeenCalled();
  });

  it("Add to Library:焦点被带进弹窗里,Tab 走不出去(手搓那一版没有焦点陷阱)", async () => {
    await mount(createElement(AddAssetDialog, { open: true, onClose: vi.fn(), onDone: vi.fn() }));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // 焦点在弹窗里 —— 这是「陷阱建起来了」最直接的一条证据。
    await expectFocusInside(dialog!);
    // 弹窗以外的一切对辅助技术隐藏,所以读屏与 Tab 都出不去。
    const outside = Array.from(document.body.children).filter((el) => !el.contains(dialog!));
    expect(outside.length).toBeGreaterThan(0);
    for (const el of outside) {
      expect(el.getAttribute("aria-hidden"), `${el.tagName} 没有被挡在弹窗外`).toBe("true");
    }
  });

  it("Set as product image:同样认 Escape,而且屏幕上的字一句没少", async () => {
    // OttoStuff 挂载后总会重取一次历史并**替换**传进来的那一份,所以货要放在这个假件里。
    mocks.getGenerationHistory.mockResolvedValue({
      items: [{ id: "gen_1", projectId: "prj_1", assetId: "ast_1", url: "https://cdn.test/1.png", kind: "image", prompt: "laksa" }],
      nextCursor: null,
      hasMore: false,
    });
    const dom = await mount(
      createElement(OttoStuff, { entities: [], ads: [], adJobs: [], records: [], history: [] }),
    );

    const actionMenu = dom.querySelector<HTMLButtonElement>('button[aria-label^="Actions for "]');
    expect(actionMenu, "找不到素材操作菜单").toBeTruthy();
    await act(async () => {
      actionMenu!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const setAsProduct = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === "Set as product image",
    );
    expect(setAsProduct, "找不到「设为产品图」那颗键").toBeTruthy();
    await act(async () => setAsProduct!.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "弹窗没开").toBeTruthy();
    expect(dialog!.textContent).toContain("Set as product image");
    expect(dialog!.textContent).toContain("Pick which product this image belongs to.");
    await expectFocusInside(dialog!);

    await act(async () => {
      // 同上(判官 P2-1):少了 cancelable,这条 Escape 断言压制不倒。
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"]'), "按了 Escape 弹窗还在").toBeFalsy();
  });
});
