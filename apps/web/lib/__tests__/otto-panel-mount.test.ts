// @vitest-environment jsdom
/**
 * #994(W2-7)挂载项 —— 面板真的挂进了商家壳,而且挂对了地方。
 *
 * 规格:`docs/specs/wave2-shell.md` §3、§9.2(W2-7 行)。
 *
 * PR #1002 把面板这一族组件建好并单独验过(`otto-panel*.test.ts` 80 条)。这个文件盯的是
 * 那 80 条**看不见**的四件事,每一件都只有在「挂进真的壳」之后才成立或不成立:
 *
 *  ① **挤而不盖,在真的壳里**(G2,§3.5 ①)。上一票证明的是组件自己不盖;这里证明的是
 *     `MerchantShellContent` 把它放在了主内容的**兄弟**位上 —— 没有遮罩、没有
 *     `pointer-events: none`、面板不是 `position: fixed`,商家照样点得到底下那一页。
 *
 *  ② **一屏只有一个 Otto**。旧的整屏 Otto 壳(`/otto`)退场是 W2-11 的活;在那之前,
 *     同一屏上不许再停一块面板。
 *
 *  ③ **入口从「跳转」变成「开面板」**。原来是 `immersive-shell.tsx` 里一颗
 *     `<Link href="/otto">`,点一下把商家带走;现在是一颗 launcher,点一下就地开面板。
 *     这里用「它是一颗 button、不是一条链接」+「点下去面板真的出现」来钉。
 *
 *  ④ **快捷键与存档在壳里仍然成立**:`Cmd/Ctrl+J` 开合、`Cmd/Ctrl+Shift+J` 让给
 *     开发者工具、损坏的存档退回默认值而不是把整个商家壳炸掉。
 *
 * 面板体里那段会话是**真的**那一套(`OttoFrontDoor` / `OttoChatStream`),不是为面板
 * 另写的第二套聊天 —— 最后一组断言钉的就是这一条。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANVAS_HREF, CREATE_NAV_HREF, OTTO_ASSISTANT } from "@fikirtive/core/navigation";
import { expectDockedStaysInFlow } from "./otto-panel-dock-contract";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/campaign"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));

/** 面板体的取数。真实现要 Postgres;这里只需要证明「面板拿到什么就画什么」。 */
const loadOttoPanelSeed = vi.fn();
vi.mock("@/lib/otto-panel-seed", () => ({ loadOttoPanelSeed: () => loadOttoPanelSeed() }));

/** 会话那一侧的服务端动作 —— 这个文件一次都不会走到它们,挡住是为了不把 Prisma 拖进来。 */
vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
// 面板体是 `React.lazy` 分包的(判官 r1 P3-6)。先把那个模块取进 registry,`React.lazy`
// 的 promise 才会在一两拍内落地 —— 否则等的就是模块解析本身,拍数变成机器速度的函数。
await import("@/components/otto/panel/OttoPanelConversation");
const { ottoPanelMountsOn } = await import("@/components/otto/panel/panel-surface");
const { OTTO_PANEL_STORAGE_KEY } = await import("@/components/otto/panel/panel-state");
const { ottoGreeting } = await import("@/lib/otto-greeting");

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const VIEWPORT = { width: 1440, height: 900 };
/** clamp(360px, 25vw, 560px) at 1440 */
const DEFAULT_WIDTH = 360;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEWPORT.width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEWPORT.height, writable: true, configurable: true });
  window.localStorage.clear();
  loadOttoPanelSeed.mockResolvedValue({ error: "seed not wired in this test" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

/**
 * 面板体是 `next/dynamic` 懒加载的(判官 r1 P3-6),所以它要多等一拍:先是 import() 那个
 * promise,再是 Suspense 提交,再是里面自己那次取数。等到 body 有内容、或者两拍都过去了
 * 为止 —— 固定 sleep 会在慢机器上飘,这里等的是条件本身。
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await settle();
  return container;
}

/** 真的商家壳,只把签退动作换成一个不做事的函数。 */
function shell(pathname: string, page?: ReactElement) {
  return createElement(
    MerchantShellContent,
    { pathname, signOutAction: async () => {} },
    page ?? createElement("div", { "data-page": "" }, "Campaign workbench"),
  );
}

describe("哪些面挂面板 (§3.2 末段)", () => {
  it("默认每一面都挂 —— Otto 就在商家正在看的那一页旁边", () => {
    for (const surface of ["/campaign", "/billing", "/profile", CREATE_NAV_HREF, "/campaign/abc?tab=plan"]) {
      expect(ottoPanelMountsOn(surface), surface).toBe(true);
    }
  });

  it("这一面自己已经有一个 Otto 就不挂第二个", () => {
    // 旧的整屏 Otto 壳,和它底下的每一条子路由。
    expect(ottoPanelMountsOn(OTTO_ASSISTANT.href)).toBe(false);
    expect(ottoPanelMountsOn("/otto?view=library")).toBe(false);
    expect(ottoPanelMountsOn("/otto/anything")).toBe(false);
    // 画布页自带真输入框(#609 原来那条 hideOttoButton,判断搬了家,理由没变)。
    expect(ottoPanelMountsOn(CANVAS_HREF)).toBe(false);
  });

  it("只按整段路径比,不按前缀字符串比", () => {
    // 「/ottoman」不是 Otto 的任何一页,不许被顺手一起豁免掉。
    expect(ottoPanelMountsOn("/ottoman")).toBe(true);
  });
});

describe("挤而不盖,在真的商家壳里 (G2,§3.5 ①)", () => {
  it("面板是主内容的兄弟,不是压在它上面的一层", async () => {
    const el = await mount(shell("/campaign"));
    const panel = el.querySelector<HTMLElement>("[data-otto-panel]")!;
    const main = el.querySelector<HTMLElement>("[data-otto-panel-main]")!;

    expect(panel).not.toBeNull();
    expect(main.contains(panel)).toBe(false);
    expect(main.parentElement).toBe(panel.parentElement);
    expect(panel.getAttribute("data-otto-panel-mode")).toBe("docked");
    expect(panel.style.width).toBe(`${DEFAULT_WIDTH}px`);
    expect(el.querySelector("[data-page]")).not.toBeNull();
    expectDockedStaysInFlow(panel);
  });

  it("没有遮罩,主内容也没有被关掉", async () => {
    const el = await mount(shell("/campaign"));
    const shellRow = el.querySelector<HTMLElement>("[data-otto-panel-shell]")!;
    const main = el.querySelector<HTMLElement>("[data-otto-panel-main]")!;

    expect(shellRow.innerHTML).not.toContain("pointer-events: none");
    expect(shellRow.querySelector(".fixed.inset-0")).toBeNull();
    expect(main.closest('[aria-hidden="true"]')).toBeNull();
    expect(main.getAttribute("inert")).toBeNull();
    expect(main.style.pointerEvents).toBe("");
  });

  it("面板开着的时候,底下那一页照样点得到", async () => {
    const onClick = vi.fn();
    const el = await mount(
      shell("/campaign", createElement("button", { type: "button", "data-page": "", onClick }, "Approve")),
    );

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-page]")!.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * 判官 r1 P3-7 —— 这是本票一个核心判断,之前只有代码注释在守它。
 *
 * 面板挂在 `MerchantShellContent` 的内容列里,而不是 `app/layout.tsx` 的最外层:最外层还包着
 * `/login`、`/signup`、`/reset-password` 这些**根本没有商家**的面。三件事一起钉:
 * 面板不画、launcher 不画、而且**一条查询都不发** —— 最后这条最要紧,一个没登录的人
 * 打开登录页不该在后台触发一次 `requireOwner` + 五条读。
 */
describe("没有商家的面,一点 Otto 都不挂", () => {
  const NON_MERCHANT = ["/login", "/signup", "/reset-password", "/forgot-password", "/verify-email", "/admin", "/legal", "/privacy"] as const;

  for (const surface of NON_MERCHANT) {
    it(`${surface}:没有面板、没有 launcher、没有取数`, async () => {
      const el = await mount(shell(surface));

      expect(el.querySelector("[data-otto-panel]")).toBeNull();
      expect(document.querySelector("[data-otto-launcher]")).toBeNull();
      expect(loadOttoPanelSeed).not.toHaveBeenCalled();
      // 页面自己照常渲染 —— 不挂面板不等于不渲染。
      expect(el.querySelector("[data-page]")).not.toBeNull();
    });
  }

  it("商家面上确实会取数 —— 上面那条零调用不是因为取数根本没接上", async () => {
    loadOttoPanelSeed.mockResolvedValue({
      projectId: "prj_1", entities: [], threads: [], activeThreadId: null, balanceUsd: 0, userName: "Aisyah",
    });

    await mount(shell("/campaign"));

    expect(loadOttoPanelSeed).toHaveBeenCalled();
  });
});

describe("一屏只有一个 Otto", () => {
  it("旧的整屏 Otto 壳上不再停第二块面板", async () => {
    const el = await mount(shell(OTTO_ASSISTANT.href));

    expect(el.querySelector("[data-otto-panel]")).toBeNull();
    expect(document.querySelector("[data-otto-launcher]")).toBeNull();
    // 页面本身照常渲染 —— 不挂面板不等于不渲染。
    expect(el.querySelector("[data-page]")).not.toBeNull();
  });

  it("画布页也不停 —— 那一页自己有输入框", async () => {
    const el = await mount(shell(CANVAS_HREF));

    expect(el.querySelector("[data-otto-panel]")).toBeNull();
    expect(el.querySelector("[data-page]")).not.toBeNull();
  });
});

describe("入口:从「跳转」变成「开面板」(§3.2)", () => {
  it("收起后是一颗 launcher —— 一颗按钮,不是一条链接", async () => {
    const el = await mount(shell("/campaign"));

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });

    const launcher = document.querySelector<HTMLElement>("[data-otto-launcher]")!;
    expect(launcher).not.toBeNull();
    expect(launcher.tagName).toBe("BUTTON");
    expect(launcher.getAttribute("href")).toBeNull();
    // 它自己里面也没有一条链接 —— 「点了被带走」这件事在这颗控件上不存在。
    // (导轨顶上那条品牌链接仍指向 `/otto`,那是导航,不是这颗入口;它随 W2-11 改。)
    expect(launcher.querySelector("a")).toBeNull();
  });

  it("点它开的是面板,商家留在原地", async () => {
    const el = await mount(shell("/campaign"));

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });
    expect(el.querySelector("[data-otto-panel]")).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-otto-launcher]")!.click();
    });

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
    // 页面没有换 —— 商家还在刚才那一页上。
    expect(el.querySelector("[data-page]")).not.toBeNull();
  });
});

describe("快捷键与存档,在壳里 (§3.1、§3.3)", () => {
  async function press(el: HTMLElement, init: KeyboardEventInit) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, ...init }));
    });
    return el;
  }

  it("Cmd/Ctrl + J 开合", async () => {
    const el = await mount(shell("/campaign"));

    await press(el, { metaKey: true });
    expect(el.querySelector("[data-otto-panel]")).toBeNull();

    await press(el, { ctrlKey: true });
    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });

  it("Cmd/Ctrl + Shift + J 让给开发者工具", async () => {
    const el = await mount(shell("/campaign"));

    await press(el, { metaKey: true, shiftKey: true });

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });

  it("存档坏了退回默认值,不是把整个商家壳炸掉", async () => {
    window.localStorage.setItem(OTTO_PANEL_STORAGE_KEY, "{ not json at all");

    const el = await mount(shell("/campaign"));

    expect(el.querySelector<HTMLElement>("[data-otto-panel]")!.style.width).toBe(`${DEFAULT_WIDTH}px`);
    expect(el.querySelector("[data-page]")).not.toBeNull();
  });
});

describe("窄屏过渡守卫(判官 P2-2,W2-11 删移动层时一并清)", () => {
  /** 视窗改小之后重挂 —— 面板读的是挂载那一刻的 `window.innerWidth`。 */
  async function mountAt(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
    return mount(shell("/campaign"));
  }

  it("375px 的手机上默认不开 —— 320px 的面板会把整屏吃掉", async () => {
    const el = await mountAt(375, 812);

    expect(el.querySelector("[data-otto-panel]")).toBeNull();
    // 页面拿回整个宽度,而 Otto 仍然够得着:launcher 还在。
    expect(el.querySelector("[data-page]")).not.toBeNull();
    expect(document.querySelector("[data-otto-launcher]")).not.toBeNull();
  });

  it("只压默认,不压能力:窄屏上按 launcher 照样开得起来", async () => {
    const el = await mountAt(375, 812);

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-otto-launcher]")!.click();
    });

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });

  it("桌面宽度不受影响 —— 默认仍然是开的(Q3-A)", async () => {
    const el = await mountAt(VIEWPORT.width, VIEWPORT.height);

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });
});

describe("层级表:模态框永远在最上面", () => {
  /** 从一段 class 串里读出 `z-[NN]` / `z-NN`。 */
  function zOf(source: string): number[] {
    return [...source.matchAll(/\bz-\[?(\d+)\]?\b/g)].map((m) => Number(m[1]));
  }

  /**
   * 对照物**曾经**是壳内那两处手搓的 `fixed inset-0 z-50` 模态框,不是 `ui/dialog`
   * (判官 r1 P3-3)—— 但 #1010(W2-1,2026-08-19)已经把它们两个都收编进 `ui/dialog`
   * 了(先于原先设想的 W2-12)。判官 r1 P3-3 那句话现在描述的正是它们自己:两处都已经
   * 走 Radix Portal 挂到 `<body>`,不再分享商家壳 `app/layout.tsx` 那个
   * `relative z-10` 的层叠上下文 —— 面板的 z 值再高也够不到它们,保证已经从「数字比较」
   * 升级成「结构性隔离」。
   *
   * 这里仍然留一段数字比较,对照物换成 `ui/dialog.tsx` 自己的遮罩层:一是保留「面板必须
   * 让着模态框」这条契约本身的机器判定(不是只靠代码注释口头承诺),二是防回归——如果
   * 有人把 `ui/dialog` 的 z 值调到面板之下,这条测试要能测出来。另外补一条「这两个文件
   * 确实从 `ui/dialog` 取组件」,防止有人偷偷改回手搓遮罩而不动这条测试引用的文件名。
   */
  const MODAL_SURFACES = [
    "components/otto/OttoStuff.tsx",
    "components/otto/stuff/AddAssetDialog.tsx",
  ] as const;

  it("导轨 < 面板/launcher < 模态框(现走 ui/dialog)—— 面板不许盖住一个模态框", async () => {
    const el = await mount(shell("/campaign"));
    const panelZ = zOf(el.querySelector("[data-otto-panel]")!.className);

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });
    const launcherZ = zOf(document.querySelector("[data-otto-launcher]")!.className);

    // 两处商家面上的模态框都必须走共享的 ui/dialog —— 不许有人偷偷换回自己那层手搓遮罩
    // 却不动这条测试引用的文件。
    for (const file of MODAL_SURFACES) {
      const source = readFileSync(resolve(WEB_ROOT, file), "utf8");
      expect(source, `${file} 应当从 ui/dialog 取模态框(不是自己手搓一个)`).toMatch(
        /from ["']@\/components\/ui\/dialog["']/,
      );
    }

    // z 值从 ui/dialog 自己的遮罩层读,不在这里抄第二份。
    const dialogSource = readFileSync(resolve(WEB_ROOT, "components/ui/dialog.tsx"), "utf8");
    const modalScrims = [...dialogSource.matchAll(/fixed inset-0 z-\[?(\d+)\]?/g)].map((m) => Number(m[1]));
    expect(modalScrims.length, "components/ui/dialog.tsx 里应当有那层遮罩").toBeGreaterThan(0);
    const modalZ = Math.min(...modalScrims);
    const railZ = Math.max(...zOf(readFileSync(resolve(WEB_ROOT, "components/global-navigation.tsx"), "utf8")));

    expect(panelZ.length + launcherZ.length).toBeGreaterThan(0);
    for (const z of [...panelZ, ...launcherZ]) {
      expect(z, `panel/launcher z=${z} vs ui/dialog 遮罩 z=${modalZ}`).toBeLessThan(modalZ);
      expect(z, `panel/launcher z=${z} vs 导轨 z=${railZ}`).toBeGreaterThan(railZ);
    }
  });
});

/**
 * 收口移植(main P3-6,W2-8 状态搬家之后跟着搬)—— 原来这道优化只在注释里声称,没有一条
 * 断言会在有人悄悄把它改回静态 import 时变红。这里补上机器判定:结构上核对源文件,而不是
 * 靠渲染计时(渲染层面 vitest 分不清「静态引入」与「已经预热的懒加载」)。
 */
describe("面板体仍然懒加载,children 不受它阻塞 (收口移植,main P3-6)", () => {
  const hostSource = readFileSync(resolve(WEB_ROOT, "components/otto/panel/OttoPanelHost.tsx"), "utf8");

  it("会话体走 React.lazy,不是被合并悄悄改回静态 import", () => {
    expect(hostSource).toMatch(
      /const OttoPanelConversation = React\.lazy\(\s*\(\)\s*=>\s*\n\s*import\("\.\/OttoPanelConversation"\)/,
    );
    // 静态值 import 不该同时存在 —— 那样两份 OttoPanelConversation 会打架,分不了包。
    expect(hostSource).not.toMatch(/^import\s*\{\s*OttoPanelConversation\s*[,}]/m);
  });

  it("children(整页内容)结构上不在懒加载的 Suspense 范围里", () => {
    const suspenseStart = hostSource.indexOf("<React.Suspense");
    const suspenseEnd = hostSource.indexOf("</React.Suspense>");
    expect(suspenseStart, "这个文件应当还有一处 Suspense 包着会话体").toBeGreaterThan(-1);
    expect(suspenseEnd).toBeGreaterThan(suspenseStart);

    const childrenIndex = hostSource.indexOf("{children}");
    expect(childrenIndex, "OttoPanelShell 的 children 应当原样透传").toBeGreaterThan(-1);
    // children 出现的位置必须落在 Suspense 那一段字符区间之外 —— 面板体的分包再慢,
    // 也不许拖着整页内容一起等。
    expect(childrenIndex < suspenseStart || childrenIndex > suspenseEnd).toBe(true);
  });
});

describe("面板体里是真的那套 Otto,不是第二套聊天 (§3.4)", () => {
  it("拿到会话种子就画真的前门(同一句问候语,同一个组件)", async () => {
    loadOttoPanelSeed.mockResolvedValue({
      projectId: "prj_1",
      entities: [],
      threads: [],
      activeThreadId: null,
      balanceUsd: 12,
      userName: "Aisyah",
    });

    const el = await mount(shell("/campaign"));

    // 问候语从 `lib/otto-greeting.ts` 取,不在测试里重抄一遍 —— 抄一遍就变成在核对自己。
    expect(el.querySelector("[data-otto-panel-body]")!.textContent).toContain(ottoGreeting("Aisyah"));
  });

  /**
   * 判官 r1 P3-5 —— 把「取几次」这件事**测出来**,而不是在注释里声称。
   *
   * 跨族判官复核(#1022,W2-8 收口批)[P2]:收口那一版把这条断言改成了「只取一次」,理由是
   * `OttoPanelHost`(种子的持有者)现在无条件挂载,不再随 `OttoPanel` 的开合卸载重建——这个
   * 观察是对的,但结论错了:种子取数不该绑在 `OttoPanelHost` 的挂载上,而该绑在**面板开合**
   * 本身(见该文件顶部注释「取数按面板开合来」)。`OttoPanelHost` 用 `PanelOpenWatcher` 读
   * `useOttoPanelControls().open`,每次从关到开都重新调一次 `loadOttoPanelSeed` —— 「关一次
   * 再开一次」因此仍是 **2** 次,不是 1 次。
   *
   * 为什么不能只取一次然后一直用着不重取:种子里带着 `balanceUsd`,面板会话没有自己的余额
   * 刷新订阅(那是 `subscribeBalanceRefresh` 接上之后的活,仍未接)。商家在 /billing 充了值
   * 回来再打开面板,如果种子只取过一次,`PackCard` / `ResearchCard` 那类可负担性判断会拿着
   * 充值前的旧余额继续算——商家账上明明多了钱,面板却说他付不起。重取的时机选在「开」而
   * 不是轮询或路由切换,是因为「开面板」正是商家下一次要看这个数字的那一刻。
   */
  it("关一次再开一次 = 取两次种子(面板开合驱动重取,不是挂载驱动)", async () => {
    loadOttoPanelSeed.mockResolvedValue({
      projectId: "prj_1", entities: [], threads: [], activeThreadId: null, balanceUsd: 12, userName: "Aisyah",
    });

    const el = await mount(shell("/campaign"));
    expect(loadOttoPanelSeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });
    await settle();
    // 关着的时候不取 —— 关掉不该顺手再发一次请求。
    expect(loadOttoPanelSeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-otto-launcher]")!.click();
    });
    await settle();
    // 重开要再取一次 —— 这就是商家充值后关开面板能看见新余额的那条保证。
    expect(loadOttoPanelSeed).toHaveBeenCalledTimes(2);
  });

  it("取数失败就说实话,不摆一个按了没反应的输入框", async () => {
    loadOttoPanelSeed.mockResolvedValue({ error: "Sign in to chat with Otto." });

    const el = await mount(shell("/campaign"));
    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;

    expect(body.querySelector('[data-otto-panel-conversation="error"]')).not.toBeNull();
    expect(body.textContent).toContain("Sign in to chat with Otto.");
    expect(body.querySelector("textarea")).toBeNull();
  });
});
