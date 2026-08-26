// @vitest-environment jsdom
/**
 * r22-beta-help-and-copy-sweep.test.ts —— beta 卫生**终闸收官清扫**(Founder 2026-08-27 批)。
 *
 * 终闸抓到六件「藏门词漏音」,这一份逐件钉住修完之后商家屏幕上的样子:
 *
 *   ① **Help 整扇门进幕后**。那一面 beta 期只有三篇样章(详情页自己写着 "This is a sample
 *      article for this preview."),其中两篇教的是 beta 期进不去的门,页脚还挂着一个被闸起来
 *      的 Settings 节的第二个地址。裁决:整扇门收起来,`/help` 落到一句实话上,两条真出口
 *      (Otto、一个人)留着;`?help=all` 原样开回来。闸在 `components/help/r22-help-beta.ts`。
 *   ② **登录/注册第一屏那句承诺**。原句 "Approved posts land in your schedule at the time you
 *      picked." 一句里承诺了两扇被藏的门。改成 beta V1 真的卖的那件事,honesty 那一半照旧。
 *   ③ **画布真面那颗 ＋**。三项一项都没接,与已删的 Share / Export 同族 —— 整颗收起来;
 *      样例画布那两项是真的,照旧摆着。加参考的路没断:composer 的 `@` 是真的。
 *   ④ **画布 scope 问卷**。"When should the campaign be ready for review?" 换成商家真正被问的
 *      那件事;答案三格与分路条件一个字没动。
 *   ⑤ **Otto IQ 存规则的成功句**。"…before work reaches review." 换成这条规则真正做的事。
 *   ⑥ **全站扫尾**。beta 可达面里最后一处点名被藏门的地方(Preferences → Default home 选单里
 *      的 Approvals)跟着那八节一起进幕后。
 *
 * 变异自检(2026-08-27 逐发实做:改 → 跑红 → 还原):
 *   · `BETA_HELP_DOOR` 改成 `true` ⇒ ①-1 / ①-3 / ①-4 红(门开着、抽屉那条链接回来了、
 *     Otto 卡上那颗回来了);
 *   · `app/help/page.tsx` 里 `if (!doorOpen) return <R22HelpClosed />` 两处删掉其一 ⇒ ①-1 红;
 *   · `helpDoorOpen` 改成永远 `false`(= 开闸失效)⇒ ①-2 红;
 *   · `BETA_CANVAS_ATTACH_MENU` 改成 `true` ⇒ ③-1 红(真画布上那颗 ＋ 回来了);
 *   · `publicPublishLine` 的 off 那半句改回旧句 ⇒ ② 红;
 *   · Settings 那格 `betaScope ? null : <option>Approvals</option>` 去掉三元 ⇒ ⑥ 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImmersiveCanvasRuntimeContext } from "@/components/canvas/NorthstarCanvasWorkspace";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn().mockResolvedValue([]) }));
// 真画布(非样例)那一路挂载后就问价、问形状,而那道 effect 的依赖里带着这两个函数本身 ——
// 每次渲染发一份新的,effect 就会自己把自己叫醒一辈子。所以这份 stub 是**同一份**。
const canvasGen = vi.hoisted(() => ({
  generateImage: async () => undefined,
  quoteCosts: async () => 11,
  imageShapes: async () => ({ options: ["1:1", "9:16"], defaultAspect: "1:1" }),
}));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: () => "canvas-action-test",
  useCanvasGen: () => canvasGen,
}));
vi.mock("@/lib/global-search-actions", () => ({ loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [] }) }));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/lib/meta-actions", () => ({ disconnectMeta: vi.fn() }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: HelpPage } = await import("@/app/help/page");
const { R22HelpClosed } = await import("@/components/help/R22HelpClosed");
const { BETA_HELP_DOOR, helpDoorOpen } = await import("@/components/help/r22-help-beta");
const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
const { R22CanvasSurface } = await import("@/components/canvas/R22CanvasSurface");
const { R22SettingsShell } = await import("@/components/settings/R22SettingsShell");
const { publicPublishLine } = await import("@fikirtive/core/schedule-draft");

const src = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

/** beta 期商家不该在可达面上读到的门名(与 `BETA_HIDDEN_NAV_KEYS` 同一份,含动词形)。 */
const HIDDEN_WORDS = ["approval", "approve", "schedule", "routine", "campaign", "analytics", "connections"];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  try { window.sessionStorage.clear(); } catch { /* 存档被锁住时这一面照样能用 */ }
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function render(element: ReturnType<typeof h>) {
  await act(async () => { root.render(element); });
  await act(async () => { await Promise.resolve(); });
}

// ---------------------------------------------------------------------------
// ① Help 整扇门
// ---------------------------------------------------------------------------
describe("① Help 这扇门 beta 期收着", () => {
  it("①-1 `/help` 不 404,落在一句实话上 —— 一柜子样章一篇都不画", async () => {
    const element = await HelpPage({ searchParams: Promise.resolve({ fixture: "r22" }) });
    await render(element as never);

    const closed = host.querySelector("[data-r22-help-closed]");
    expect(closed, "Help 门关着,`/help` 该落在 R22HelpClosed 上").not.toBeNull();
    expect(host.querySelector("[role='status']"), "这句话要被读屏念出来").not.toBeNull();
    const text = host.textContent ?? "";
    expect(text).toContain("Help articles are not open in this beta");
    expect(text, "样章一篇都不该在").not.toContain("sample article");
    expect(text, "搜索框是那一面的,不该跟过来").not.toContain("Search product help");
    for (const word of HIDDEN_WORDS) {
      expect(text.toLowerCase(), `落地这一面提到了 ${word}`).not.toContain(word);
    }
    // 两条真出口:一个人(邮件),和 Otto。
    expect(host.querySelector<HTMLAnchorElement>("a[href^='mailto:']")?.getAttribute("href")).toContain("mailto:");
    expect(text).toContain("Otto");
  });

  it("①-2 `?help=all` 把整面原样开回来 —— 闸是显式的,不是删掉了", async () => {
    expect(helpDoorOpen("all"), "开闸参数不认了").toBe(true);
    expect(helpDoorOpen(undefined), "没带参数时门该是关着的").toBe(BETA_HELP_DOOR);

    const element = await HelpPage({ searchParams: Promise.resolve({ fixture: "r22", help: "all" }) });
    await render(element as never);
    expect(host.querySelector("[data-r22-help-closed]"), "开了闸还落在兜底上").toBeNull();
    expect(host.textContent ?? "").toContain("Product help");
  });

  it("①-3 Help 抽屉里那条 Help and support 撤下了,Ask Otto 这条真出口留着", async () => {
    await render(h(R22DashboardShell, { location: "/", account: null, signOutAction: async () => {} } as never, h("div")));

    const workspaceTrigger = Array.from(host.querySelectorAll("button")).find((node) => node.className.includes("r22-dashboard-workspace-trigger"))
      ?? Array.from(host.querySelectorAll("button")).find((node) => (node.textContent ?? "").includes("Workspace"));
    expect(workspaceTrigger, "找不到开工作区菜单的那颗键 —— 下面的断言在核对空气").toBeTruthy();
    await act(async () => {
      workspaceTrigger!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      workspaceTrigger!.click();
    });

    const helpButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Help");
    expect(helpButton, "工作区菜单里那颗 Help 不见了").toBeTruthy();
    await act(async () => { helpButton!.click(); });

    const drawer = document.querySelector("[data-r22-help-region]");
    expect(drawer, "Help 抽屉没开").not.toBeNull();
    const labels = Array.from(drawer!.querySelectorAll("button, a")).map((node) => node.textContent ?? "");
    expect(labels.some((label) => label.includes("Ask Otto")), "Ask Otto 这条真出口不该跟着走").toBe(true);
    expect(labels.some((label) => label.includes("Help and support")), "指向 /help 的那条还在").toBe(false);
    expect(drawer!.querySelector("a[href^='/help']"), "抽屉里还有一条通往 /help 的路").toBeNull();
  });

  it("①-4 整个壳里一条通往 /help 的商家链接都不剩(⌘K 也算)", async () => {
    await render(h(R22DashboardShell, { location: "/", account: null, signOutAction: async () => {} } as never, h("div")));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
    expect(document.querySelector("a[href^='/help']"), "壳里还画着一条 /help").toBeNull();
  });

  it("①-5 只藏不删:那一整面与它的路由一行没删,闸翻回来就原样回来", () => {
    const view = src("../../components/help/R22HelpView.tsx");
    expect(view, "整面被删了,不是藏起来").toContain("Search product help");
    expect(view).toContain("Contact support");
    expect(src("../../app/help/page.tsx"), "路由没了,直接输地址会 404").toContain("R22HelpView");
    expect(src("../../components/r22/R22DashboardShell.tsx"), "抽屉那条链接被删了,不是藏起来").toContain("BETA_HELP_DOOR ?");
    expect(src("../../components/help/r22-help-beta.ts"), "闸没有默认关").toContain("export const BETA_HELP_DOOR = false;");
  });
});

// ---------------------------------------------------------------------------
// ② 登录 / 注册第一屏那句承诺
// ---------------------------------------------------------------------------
describe("② 第一屏那句承诺说的是 beta 真给得出的东西", () => {
  it("②-1 承诺创作线,一个被藏门的字都没有,honesty 那一半照旧在", () => {
    const line = publicPublishLine(false);
    expect(line).toContain("images and videos");
    expect(line).toMatch(/not switched on/i);
    for (const word of ["schedule", "approv", "campaign", "routine"]) {
      expect(line.toLowerCase(), `第一屏那句话提到了 ${word}`).not.toContain(word);
    }
    // 开关那一半没被顺手改掉 —— 发布回来的那天,这句话跟着回来。
    expect(publicPublishLine(true)).toMatch(/publishes to the Instagram or Facebook account/);
  });

  it("②-2 两页都只从权威取这句话,自己一个字不留", () => {
    for (const rel of ["../../app/login/page.tsx", "../../app/signup/page.tsx"]) {
      const source = src(rel);
      expect(source, `${rel} 没接上开关`).toContain("publicPublishLine()");
      expect(source, `${rel} 自己抄了一份措辞`).not.toContain("not switched on");
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 画布那颗 ＋
// ---------------------------------------------------------------------------
function canvasContext(visualFixture?: "r22"): ImmersiveCanvasRuntimeContext {
  return {
    projects: [{ id: "fixture-raya", name: "Raya launch" }],
    threads: [],
    activeProjectId: "fixture-raya",
    activeThreadId: null,
    initialBalance: null,
    ...(visualFixture ? { visualFixture } : {}),
  } as ImmersiveCanvasRuntimeContext;
}

describe("③ 真画布上那颗 ＋ 收起来了", () => {
  it("③-1 真画布:没有那颗 ＋,而 composer 的 @ 那条真路照旧在", async () => {
    await render(h(R22CanvasSurface, { runtimeContext: canvasContext(), entities: [] } as never));
    expect(document.querySelector("[aria-label='Attach']"), "真画布上那颗 ＋ 还在,而它开出来的三项一项都没接").toBeNull();
    const composer = document.querySelector<HTMLTextAreaElement>("[aria-label='Describe what to make']");
    expect(composer, "composer 不见了").not.toBeNull();
    expect(composer!.getAttribute("placeholder")).toContain("@ adds references");
  });

  it("③-2 样例画布那两项是真的,照旧摆着 —— 收的是没接上的那一套,不是整件事", async () => {
    await render(h(R22CanvasSurface, { runtimeContext: canvasContext("r22"), entities: [] } as never));
    const plus = document.querySelector("[aria-label='Attach']");
    expect(plus, "样例画布那颗 ＋ 被顺手收掉了").not.toBeNull();
    await act(async () => {
      plus!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      (plus as HTMLElement).click();
    });
    const items = Array.from(document.querySelectorAll("[role='menuitem'], .r22-canvas-attach-menu button")).map((node) => node.textContent?.trim() ?? "");
    expect(items).toContain("From Library");
    expect(items).toContain("Upload an image");
    expect(items, "「敬请期待」那两项不该在样例面上").not.toContain("Paste a link");
  });

  it("③-3 只藏不删:三项与它们那三句提示一行没删,闸默认关", () => {
    const source = src("../../components/canvas/R22CanvasSurface.tsx");
    expect(source, "闸没有默认关").toContain("const BETA_CANVAS_ATTACH_MENU = false;");
    expect(source, "被删了,不是藏起来").toContain("Upload is not connected yet.");
    expect(source).toContain("Link attachment is not connected yet.");
  });
});

// ---------------------------------------------------------------------------
// ④⑤ 两句措辞
// ---------------------------------------------------------------------------
describe("④⑤ 商家读到的两句话不再点名被藏的门", () => {
  it("④ scope 问卷问的是「这件什么时候要做好」,答案三格与分路条件一个字没动", () => {
    const source = src("../../components/canvas/R22CanvasSurface.tsx");
    expect(source).toContain("When do you need this ready?");
    expect(source, "旧问句还在").not.toContain("When should the campaign be ready for review?");
    expect(source, "旧说明还在").not.toContain("sets the review target");
    // 答案三格与分路正则原样 —— 换的只有措辞,不是行为。
    expect(source).toContain("channel|format|schedule|when|deliverable");
    for (const option of ["Tomorrow morning", "Today", "This week"]) expect(source).toContain(option);
  });

  it("⑤ 存下一条风格规则之后,Otto 说的是这条规则真正做的事", () => {
    const source = src("../../components/otto-iq/R22OttoIQView.tsx");
    expect(source).toContain("Otto follows this rule in everything it makes from now on.");
    expect(source, "旧句还在").not.toContain("before work reaches review");
  });
});

// ---------------------------------------------------------------------------
// ⑥ 全站扫尾:Preferences 那个选单
// ---------------------------------------------------------------------------
describe("⑥ beta 可达面上最后一处点名被藏门的地方", () => {
  const DATA = {
    workspaceName: "Batik House",
    displayName: "Nadia",
    email: "nadia@batikhouse.my",
    balance: 1240,
    recent: [],
    accountReadable: true,
    spendCapCredits: 40,
    timezone: "Malaysia Time · GMT+8",
    channels: [],
  };

  it("⑥-1 Preferences → Default home 的选单里没有 Approvals,Home / Canvas 照旧", async () => {
    await render(h(R22SettingsShell, { data: DATA, fixture: true, initialSection: "preferences", betaScope: true } as never));

    const row = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Change default home");
    expect(row, "找不到 Default home 那一行的动作键").toBeTruthy();
    await act(async () => { row!.click(); });

    const select = document.querySelector<HTMLSelectElement>("#default-home");
    expect(select, "Default home 的选单没开").not.toBeNull();
    const options = Array.from(select!.querySelectorAll("option")).map((node) => node.textContent?.trim() ?? "");
    expect(options).toContain("Home");
    expect(options).toContain("Canvas");
    expect(options, "商家可以把首页设成一扇他看不见的门").not.toContain("Approvals");
  });

  it("⑥-2 闸开回来那一格原样回来 —— 只藏不删", async () => {
    await render(h(R22SettingsShell, { data: DATA, fixture: true, initialSection: "preferences", betaScope: false } as never));
    const row = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Change default home");
    await act(async () => { row!.click(); });
    const options = Array.from(document.querySelectorAll("#default-home option")).map((node) => node.textContent?.trim() ?? "");
    expect(options, "闸开着也回不来 = 被删了").toContain("Approvals");
  });
});
