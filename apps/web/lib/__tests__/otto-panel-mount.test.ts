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

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
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
    // 停靠形态不脱离文档流 —— 它占宽度,所以主内容是被挤窄的。
    expect(panel.style.position).toBe("");
    expect(panel.getAttribute("data-otto-panel-mode")).toBe("docked");
    expect(panel.style.width).toBe(`${DEFAULT_WIDTH}px`);
    expect(el.querySelector("[data-page]")).not.toBeNull();
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

describe("层级表:模态框永远在最上面", () => {
  /** 从一段 class 串里读出 `z-[NN]` / `z-NN`。 */
  function zOf(source: string): number[] {
    return [...source.matchAll(/\bz-\[?(\d+)\]?\b/g)].map((m) => Number(m[1]));
  }

  it("导轨 < 面板/launcher < dialog —— 面板不许盖住任何一个模态框", async () => {
    const el = await mount(shell("/campaign"));
    const panelZ = zOf(el.querySelector("[data-otto-panel]")!.className);

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });
    const launcherZ = zOf(document.querySelector("[data-otto-launcher]")!.className);

    // 两个对照值都从它们自己的文件里读,不在这里抄第二份。
    const dialogZ = Math.min(...zOf(readFileSync(resolve(WEB_ROOT, "components/ui/dialog.tsx"), "utf8")));
    const railZ = Math.max(...zOf(readFileSync(resolve(WEB_ROOT, "components/global-navigation.tsx"), "utf8")));

    for (const z of [...panelZ, ...launcherZ]) {
      expect(z, `panel/launcher z=${z} vs dialog z=${dialogZ}`).toBeLessThan(dialogZ);
      expect(z, `panel/launcher z=${z} vs rail z=${railZ}`).toBeGreaterThan(railZ);
    }
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

  it("取数失败就说实话,不摆一个按了没反应的输入框", async () => {
    loadOttoPanelSeed.mockResolvedValue({ error: "Sign in to chat with Otto." });

    const el = await mount(shell("/campaign"));
    const body = el.querySelector<HTMLElement>("[data-otto-panel-body]")!;

    expect(body.querySelector('[data-otto-panel-conversation="error"]')).not.toBeNull();
    expect(body.textContent).toContain("Sign in to chat with Otto.");
    expect(body.querySelector("textarea")).toBeNull();
  });
});
