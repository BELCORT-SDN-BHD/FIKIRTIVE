// @vitest-environment jsdom
/**
 * otto-view-follows-url.test.ts — the Workspace links moved the address bar and nothing else.
 *
 * 病灶:全局导轨里 Library / Video editor / Brand & products / Templates / Discover /
 * Schedule / Analytics 七格都是 <Link href="/otto?view=…">(packages/core/src/navigation.ts)。
 * 点下去是一次软导航:地址栏换了、服务端也重渲染了,可只要 app/otto/page.tsx 的 key 没变
 * (同一个项目、同一条会话),React 就不会重挂 OttoApp —— 而 `view` 是 useState 的初值,
 * 一辈子只算一次;唯一在听 URL 的是 popstate,而软导航从不触发 popstate。
 * 于是商家点一格,URL 变了,屏幕原地不动。
 *
 * 修法:URL → state 单向跟随,且只在 URL 自己那个 view 变化时采纳一次。
 *
 * 这里断言的是行为,不是实现:挂一个真的 OttoApp,按 Next 软导航的样子换 URL + 换
 * searchParams 快照(不重挂),再看屏幕上画的是哪一格。最后一组是反向保险 —— OttoApp 自己
 * 用 raw history.pushState 改视图(为了不把正在跑的对话流重挂),路由随后把这次 push 回声
 * 回来时,不许把刚设好的状态又推回去。
 */
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OttoAppProps, OttoViewKey } from "@/components/otto/OttoApp";

// The router snapshot Next hands the tree. A navigation replaces it with a fresh one.
const { nav } = vi.hoisted(() => ({ nav: { search: new URLSearchParams() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => nav.search,
}));

vi.mock("@/lib/actions", () => ({
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  autoTitleProjectIfDefault: vi.fn(),
  setProjectPinned: vi.fn(),
}));
vi.mock("@/lib/account-actions", () => ({
  getMyAccount: vi.fn().mockResolvedValue({ error: "not mocked in this test" }),
}));
vi.mock("@/lib/otto-client-actions", () => ({
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/components/otto/OttoNav", () => ({ OttoNav: () => null }));
vi.mock("@/components/otto/OttoPromptDialog", () => ({
  OttoConfirmDialog: () => null,
  OttoRenameDialog: () => null,
}));

// The screen. It reports which view OttoApp handed it, and lends out the same callback the
// real nav rail presses (OttoApp's handleViewChange) so an INTERNAL change can be driven too.
const { screen } = vi.hoisted(() => ({
  screen: { onViewChange: null as null | ((view: string) => void) },
}));
vi.mock("@/components/otto/OttoView", async () => {
  const { createElement: h } = await import("react");
  return {
    OttoView: ({ view, onViewChange }: { view: string; onViewChange: (view: string) => void }) => {
      screen.onViewChange = onViewChange;
      return h("div", { "data-testid": "otto-view", "data-view": view });
    },
  };
});

const { OttoApp } = await import("@/components/otto/OttoApp");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let rerender: (() => void) | null = null;

beforeEach(() => {
  // The "otto" view polls thread activity on an interval; it is not what this file is about.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activity: [] }) }));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  rerender = null;
  screen.onViewChange = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function baseProps(over: Partial<OttoAppProps> = {}): OttoAppProps {
  return {
    projectId: "proj_1",
    projects: [{ id: "proj_1", name: "Test project" }],
    activeProjectId: "proj_1",
    sidebarThreads: [],
    initialActiveThreadId: null,
    entities: [],
    threads: [],
    balanceUsd: 0,
    userName: "founder",
    memory: [],
    records: [],
    ads: [],
    adJobs: [],
    account: null,
    analytics: { state: "notConnected" },
    ...over,
  } as OttoAppProps;
}

/** Mounts OttoApp at `url` under a parent that can re-render it without remounting it —
 *  which is exactly the situation the bug lives in (page key unchanged → same instance). */
async function mountAt(url: string, over: Partial<OttoAppProps> = {}): Promise<HTMLDivElement> {
  window.history.replaceState(null, "", url);
  nav.search = new URLSearchParams(new URL(url, window.location.origin).search);

  function Harness(): ReactElement {
    const [, bump] = useState(0);
    rerender = () => bump((n) => n + 1);
    return createElement(OttoApp, baseProps(over));
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(Harness)));
  return container;
}

/** A <Link> press: the address bar moves and the router hands the tree a fresh searchParams
 *  snapshot, with this component left mounted. No popstate — pushed links never fire one. */
async function pressLink(url: string) {
  window.history.pushState(null, "", url);
  nav.search = new URLSearchParams(new URL(url, window.location.origin).search);
  await act(async () => rerender!());
}

/** Next mirrors a raw history.pushState into the router a beat later (app-router patches
 *  pushState and dispatches ACTION_RESTORE). This is that echo arriving. */
async function routerEcho() {
  nav.search = new URLSearchParams(window.location.search);
  await act(async () => rerender!());
}

function shownView(dom: HTMLElement): string | null {
  return dom.querySelector('[data-testid="otto-view"]')!.getAttribute("data-view");
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

describe("Otto's view follows the URL through a soft navigation", () => {
  it("opens on the view the address bar names", async () => {
    const dom = await mountAt("/otto?project=proj_1&view=library", { initialView: "library" });

    expect(shownView(dom)).toBe("library");
  });

  it("MOVES THE SCREEN when a Workspace link is pressed — not only the address bar", async () => {
    const dom = await mountAt("/otto?project=proj_1");
    expect(shownView(dom)).toBe("otto");

    await pressLink("/otto?view=library");

    expect(currentUrl()).toBe("/otto?view=library");
    expect(shownView(dom)).toBe("library"); // the regression: this stayed "otto"
  });

  it("keeps following on every later press, not just the first", async () => {
    const dom = await mountAt("/otto?project=proj_1");

    for (const view of ["library", "edit", "memory", "templates", "discover", "schedule", "analytics"]) {
      await pressLink(`/otto?view=${view}`);
      expect(shownView(dom), `pressing ${view} left the screen behind`).toBe(view);
    }
  });

  it("honours the stuff → library alias the rest of the app already honours", async () => {
    const dom = await mountAt("/otto?project=proj_1");

    await pressLink("/otto?view=stuff");

    expect(shownView(dom)).toBe("library");
  });

  it("goes back to the conversation when the link carries no view", async () => {
    const dom = await mountAt("/otto?project=proj_1&view=analytics", { initialView: "analytics" });

    await pressLink("/otto?project=proj_1");

    expect(shownView(dom)).toBe("otto");
  });
});

describe("following the URL does not fight Otto's own view changes", () => {
  it("does not revert a view Otto set itself when the router echoes that same push", async () => {
    // OttoApp changes view by setting state and then writing the URL with raw
    // history.pushState (no Next navigation — that would remount the chat stream mid-turn).
    // The router learns about that push afterwards; when it does, nothing may move.
    const dom = await mountAt("/otto?project=proj_1");
    await pressLink("/otto?view=library");
    expect(shownView(dom)).toBe("library");

    await act(async () => screen.onViewChange!("templates" satisfies OttoViewKey));
    expect(shownView(dom)).toBe("templates");
    expect(currentUrl()).toBe("/otto?project=proj_1&view=templates");

    await routerEcho();

    expect(shownView(dom)).toBe("templates");
  });

  it("still adopts the next link press after one of its own changes", async () => {
    // The half that a naive guard breaks: having ignored the echo, it must not also ignore
    // the merchant's next press — that is the original dead-navigation bug again.
    const dom = await mountAt("/otto?project=proj_1");
    await pressLink("/otto?view=library");
    await act(async () => screen.onViewChange!("otto" satisfies OttoViewKey));
    await routerEcho();
    expect(shownView(dom)).toBe("otto");

    await pressLink("/otto?view=library");

    expect(shownView(dom)).toBe("library");
  });
});
