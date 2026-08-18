// @vitest-environment jsdom
/**
 * #994 (W2-7) — 面板这层壳,真的渲染出来。
 *
 * 规格:`docs/specs/wave2-shell.md` §3、§7.1「Otto 面板」块。
 *
 * 这个文件盯的是三件在纯函数层看不见的事:
 *
 *  ① **Dock, don't cover**(G2,§3.5 ①)。这是整份规格里唯一一条「不许有」的机器判定:
 *     面板开着的时候,主内容不许被遮罩盖住、不许被 `pointer-events: none` 关掉、
 *     面板本身不许是 `position: fixed` —— 它是主内容的**兄弟**,靠排版把主内容挤窄。
 *     那一句验收(「主内容被挤窄但仍然能点」)在这里是一次真的 click。
 *
 *  ② **首帧不跳**(§3.3)。服务端不知道 localStorage,所以首帧一律默认值、`transition: none`;
 *     挂载后才套用存值,并打上 `data-otto-panel-hydrated`。
 *
 *  ③ **Cmd/Ctrl + J 与 Expand**(§3.1)。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OttoPanelShell, type OttoPanelShellProps } from "@/components/otto/panel/OttoPanelShell";
import { OTTO_PANEL_STORAGE_KEY } from "@/components/otto/panel/panel-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 1440, height: 900 };
/** clamp(360px, 25vw, 560px) at 1440 */
const DEFAULT_WIDTH = 360;
/** min(960px, 60vw) at 1440 */
const EXPANDED_WIDTH = 864;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VIEWPORT.width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEWPORT.height, writable: true, configurable: true });
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function shell(props: Partial<OttoPanelShellProps> = {}, main?: ReactElement) {
  return createElement(OttoPanelShell, {
    ...props,
    children: main ?? createElement("div", { "data-main-content": "" }, "Page content"),
  });
}

function panelOf(el: HTMLElement): HTMLElement {
  const panel = el.querySelector<HTMLElement>("[data-otto-panel]");
  if (!panel) throw new Error("panel not rendered");
  return panel;
}

describe("Dock, don't cover (§3.5 ①,G2)", () => {
  it("puts the panel beside the main content, not on top of it", async () => {
    const el = await render(shell());
    const main = el.querySelector<HTMLElement>("[data-otto-panel-main]")!;
    const panel = panelOf(el);

    expect(main.contains(panel)).toBe(false);
    expect(main.parentElement).toBe(panel.parentElement);
    // 停靠形态没有任何定位:它就是排版里的一格,所以主内容是被挤窄的,不是被盖住的。
    expect(panel.style.position).toBe("");
    expect(panel.getAttribute("data-otto-panel-mode")).toBe("docked");
    expect(panel.style.width).toBe(`${DEFAULT_WIDTH}px`);
  });

  it("renders no scrim and never switches the page off", async () => {
    const el = await render(shell());
    const main = el.querySelector<HTMLElement>("[data-otto-panel-main]")!;

    // 遮罩的三种长相,一次全否掉。(装饰性 SVG 自己的 aria-hidden 不算 —— 只看主内容这条链。)
    expect(el.querySelector("[data-otto-panel-shell]")!.innerHTML).not.toContain("pointer-events: none");
    expect(el.querySelector(".fixed.inset-0")).toBeNull();
    expect(main.closest('[aria-hidden="true"]')).toBeNull();
    expect(main.getAttribute("inert")).toBeNull();
    expect(main.style.pointerEvents).toBe("");
  });

  it("leaves the main content clickable while the panel is open", async () => {
    const onClick = vi.fn();
    const el = await render(
      shell({}, createElement("button", { type: "button", "data-main-content": "", onClick }, "Open canvas")),
    );

    expect(panelOf(el)).toBeTruthy();
    await act(async () => {
      el.querySelector<HTMLButtonElement>("[data-main-content]")!.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("首帧默认值,挂载后才套存值 (§3.3)", () => {
  it("renders the default width with transitions off on the server", () => {
    const markup = renderToStaticMarkup(shell());

    expect(markup).toContain("data-otto-panel-mode=\"docked\"");
    expect(markup).not.toContain("data-otto-panel-hydrated");
    expect(markup).toContain("transition:none");
    expect(markup).toContain(`width:${DEFAULT_WIDTH}px`);
  });

  it("marks itself hydrated and applies the stored width after mount", async () => {
    window.localStorage.setItem(
      OTTO_PANEL_STORAGE_KEY,
      JSON.stringify({ mode: "docked", open: true, width: 500, launcher: { edge: "left", y: 0.5 } }),
    );

    const panel = panelOf(await render(shell()));

    expect(panel.hasAttribute("data-otto-panel-hydrated")).toBe(true);
    expect(panel.style.width).toBe("500px");
    expect(panel.style.transition).toContain("200ms");
  });

  it("falls back to defaults — and does not throw — on a corrupt stored value", async () => {
    window.localStorage.setItem(OTTO_PANEL_STORAGE_KEY, "{ this is not json");

    const panel = panelOf(await render(shell()));

    expect(panel.style.width).toBe(`${DEFAULT_WIDTH}px`);
  });

  it("writes the geometry back to the spec's key", async () => {
    const el = await render(shell());

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click();
    });

    expect(JSON.parse(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY)!).open).toBe(false);
  });
});

describe("Cmd/Ctrl + J 开合 (§3.1)", () => {
  async function press(modifier: "metaKey" | "ctrlKey") {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", [modifier]: true, bubbles: true }));
    });
  }

  it("closes the panel down to the launcher and opens it again", async () => {
    const el = await render(shell());
    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();

    await press("metaKey");
    expect(el.querySelector("[data-otto-panel]")).toBeNull();
    expect(document.querySelector("[data-otto-launcher]")).not.toBeNull();

    await press("metaKey");
    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
    expect(document.querySelector("[data-otto-launcher]")).toBeNull();
  });

  it("works on Ctrl for the merchants who are not on a Mac", async () => {
    const el = await render(shell());

    await press("ctrlKey");

    expect(el.querySelector("[data-otto-panel]")).toBeNull();
  });

  it("ignores a bare J so typing in a message never closes the panel", async () => {
    const el = await render(shell());

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });
});

describe("Expand (§3.1 min(960px, 60vw))", () => {
  it("pushes the width out and back again", async () => {
    const el = await render(shell());
    const expand = () => el.querySelector<HTMLButtonElement>('[aria-label="Expand Otto"], [aria-label="Collapse Otto"]')!;

    expect(panelOf(el).style.width).toBe(`${DEFAULT_WIDTH}px`);

    await act(async () => expand().click());
    expect(panelOf(el).style.width).toBe(`${EXPANDED_WIDTH}px`);
    expect(expand().getAttribute("aria-pressed")).toBe("true");

    await act(async () => expand().click());
    expect(panelOf(el).style.width).toBe(`${DEFAULT_WIDTH}px`);
  });

  it("is not remembered — reopening comes back at the merchant's own width", async () => {
    const el = await render(shell());

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Expand Otto"]')!.click());
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Close Otto"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-otto-launcher]")!.click());

    expect(panelOf(el).style.width).toBe(`${DEFAULT_WIDTH}px`);
    expect(JSON.parse(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY)!).width).toBe(DEFAULT_WIDTH);
  });
});

describe("头部与插槽 (§3.4)", () => {
  it("only shows the history and new-chat buttons when something is wired to them", async () => {
    const bare = await render(shell());
    expect(bare.querySelector('[aria-label="Conversation history"]')).toBeNull();
    expect(bare.querySelector('[aria-label="New chat"]')).toBeNull();

    await act(async () => root?.unmount());
    container?.remove();

    const wired = await render(shell({ onOpenHistory: vi.fn(), onNewChat: vi.fn() }));
    expect(wired.querySelector('[aria-label="Conversation history"]')).not.toBeNull();
    expect(wired.querySelector('[aria-label="New chat"]')).not.toBeNull();
  });

  it("says what the chat costs only where there is a composer to spend it", async () => {
    const bare = await render(shell());
    expect(bare.textContent).not.toContain("Chatting with Otto costs credits");

    await act(async () => root?.unmount());
    container?.remove();

    const composed = await render(shell({ panelFooter: createElement("div", null, "composer") }));
    expect(composed.textContent).toContain("Chatting with Otto costs credits");
  });

  it("shows the page-context chip when one is handed in", async () => {
    const el = await render(shell({ contextChip: { label: "Raya promo" } }));

    expect(el.querySelector("[data-otto-panel-context]")!.textContent).toContain("On this page: Raya promo");
  });

  it("offers a keyboard route to the resize handle", async () => {
    const el = await render(shell());
    const handle = el.querySelector<HTMLElement>("[data-otto-panel-resize]")!;

    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-label")).toBe("Resize Otto panel");
    expect(handle.tabIndex).toBe(0);
  });
});

describe("拖动语义,走真的指针事件 (§3.2)", () => {
  /** jsdom 不一定带 PointerEvent 构造器;React 只看事件的 type 与坐标,MouseEvent 够用。 */
  function pointer(type: string, x: number, y: number): MouseEvent {
    return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  }

  it("dragging the header detaches the panel, and dragging it back to the right edge re-docks it", async () => {
    const el = await render(shell());

    await act(async () => {
      el.querySelector("[data-otto-panel-header]")!.dispatchEvent(pointer("pointerdown", 1000, 40));
    });
    await act(async () => {
      window.dispatchEvent(pointer("pointermove", 700, 300));
    });

    const floating = panelOf(el);
    expect(floating.getAttribute("data-otto-panel-mode")).toBe("floating");
    expect(floating.style.position).toBe("fixed");
    // 脱离本身要落在吸附带之外,否则一松手就弹回去。
    expect(document.querySelector("[data-otto-panel-dock-hint]")).toBeNull();
    // 浮动了也不遮:主内容还在它自己的位置上,没有遮罩盖上来。
    expect(el.querySelector("[data-otto-panel-main]")!.getAttribute("inert")).toBeNull();

    // 拖到右缘 40px 处(48px 带内,但没有贴到边)松手 → 吸回停靠。
    // 用 40 这个字面量而不是 DOCK_SNAP_PX:贴到边任何阈值都会吸,那样就验不出阈值。
    await act(async () => {
      window.dispatchEvent(pointer("pointermove", 732, 300));
    });
    expect(panelOf(el).style.left).toBe(`${VIEWPORT.width - DEFAULT_WIDTH - 40}px`);
    expect(document.querySelector("[data-otto-panel-dock-hint]")).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(pointer("pointerup", 732, 300));
    });

    expect(panelOf(el).getAttribute("data-otto-panel-mode")).toBe("docked");
    expect(document.querySelector("[data-otto-panel-dock-hint]")).toBeNull();
    // 吸回来的是商家原来那个宽度,不是浮动窗的宽度。
    expect(panelOf(el).style.width).toBe(`${DEFAULT_WIDTH}px`);
  });

  it("a small header twitch is not a detach", async () => {
    const el = await render(shell());

    await act(async () => {
      el.querySelector("[data-otto-panel-header]")!.dispatchEvent(pointer("pointerdown", 1000, 40));
    });
    await act(async () => {
      window.dispatchEvent(pointer("pointermove", 1002, 41));
    });

    expect(panelOf(el).getAttribute("data-otto-panel-mode")).toBe("docked");
  });

  it("dragging the left edge changes the width and clamps at 320", async () => {
    const el = await render(shell());

    await act(async () => {
      el.querySelector("[data-otto-panel-resize]")!.dispatchEvent(pointer("pointerdown", 1080, 400));
    });
    await act(async () => {
      window.dispatchEvent(pointer("pointermove", 940, 400));
    });
    expect(panelOf(el).style.width).toBe("500px");

    await act(async () => {
      window.dispatchEvent(pointer("pointermove", 1430, 400));
    });
    expect(panelOf(el).style.width).toBe("320px");

    await act(async () => {
      window.dispatchEvent(pointer("pointerup", 1430, 400));
    });
    expect(JSON.parse(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY)!).width).toBe(320);
  });

  it("pulls the floating window back into view when the viewport shrinks under it", async () => {
    window.localStorage.setItem(
      OTTO_PANEL_STORAGE_KEY,
      JSON.stringify({ mode: "floating", open: true, width: 420, float: { x: 900, y: 200, w: 420, h: 640 } }),
    );
    const el = await render(shell());
    expect(panelOf(el).style.left).toBe("900px");

    Object.defineProperty(window, "innerWidth", { value: 900, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    const panel = panelOf(el);
    expect(parseInt(panel.style.left, 10) + parseInt(panel.style.width, 10)).toBeLessThanOrEqual(900);
    expect(parseInt(panel.style.top, 10) + parseInt(panel.style.height, 10)).toBeLessThanOrEqual(600);
  });
});

describe("launcher (§3.2)", () => {
  it("opens the panel on click and draws on the stored edge", async () => {
    window.localStorage.setItem(
      OTTO_PANEL_STORAGE_KEY,
      JSON.stringify({ mode: "docked", open: false, width: 420, launcher: { edge: "left", y: 0 } }),
    );

    const el = await render(shell());
    const launcher = document.querySelector<HTMLElement>("[data-otto-launcher]")!;

    expect(launcher.getAttribute("data-otto-launcher-edge")).toBe("left");
    expect(launcher.style.left).toBe("24px");
    expect(launcher.style.top).toBe("24px");

    await act(async () => launcher.click());

    expect(el.querySelector("[data-otto-panel]")).not.toBeNull();
  });
});
