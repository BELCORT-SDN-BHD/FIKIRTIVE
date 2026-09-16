// @vitest-environment jsdom
/**
 * FRONT-A14（第三轮走查 R3-F09）——「Add connection」弹窗一打开，焦点就落在第一颗
 * `Connect` 上。
 *
 * 商家看到的事：用键盘打开这个弹窗后随手一个 Enter，就直接被送进 Meta 的 OAuth
 * 授权流程 —— 他还没读完「Choose a service…」那句话，人已经在跳转了。弹窗是用来
 * **看清楚再选**的，不是一开就替他按下第一个动作。
 *
 * 根因：`design-system/primitives/dialog.tsx` 的 `DialogContent` 把 children 排在
 * 内建 Close 按钮**前面**，而 Base UI `Dialog.Popup` 的 `initialFocus` 默认值就是
 * 「popup 里第一颗 tabbable」（`@base-ui/react@1.7.0`
 * `dialog/popup/DialogPopup.d.ts:15`）。Library 素材详情打开那一刻是 loading 态、
 * 正文没有可聚焦控件（`components/asset/DetailPanel.tsx:151`），第一颗 tabbable
 * 恰好是 Close，所以它一直是对的；Connections 这个弹窗每一行都带 `Connect`，
 * 第一颗 tabbable 就成了那颗真动作控件。
 *
 * 两条断言一起才算修好：① 打开时焦点留在弹窗内但不压在任何连接动作上；② Escape
 * 关闭后焦点回到「Add connection」入口（既有行为，第三轮走查把它列为 R3-F05 的正
 * 对照，不能因为改 initialFocus 把它弄丢）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectFocusInside } from "./focus-trap-wait";

const mocks = vi.hoisted(() => ({
  getMetaConnection: vi.fn(),
  disconnectMeta: vi.fn(),
  getMetaInsights: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
  getAccountViewData: vi.fn(),
}));

vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: mocks.getMetaConnection,
  disconnectMeta: mocks.disconnectMeta,
  getMetaInsights: mocks.getMetaInsights,
}));
vi.mock("@/lib/otto-client-actions", () => ({
  setAdsAutonomy: mocks.setAdsAutonomy,
  setAdsWritesPaused: mocks.setAdsWritesPaused,
}));
vi.mock("@/lib/account-view-data", () => ({
  getAccountViewData: mocks.getAccountViewData,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: OttoConnections } = await import("@/components/otto/OttoConnections");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

const DISCONNECTED_CHANNELS = [
  { id: "instagram", label: "Instagram", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "needs_reconnect" as const, targets: [], connectUrl: "/api/x/authorize" },
];

async function renderConnections(): Promise<HTMLDivElement> {
  mocks.getAccountViewData.mockResolvedValue({
    settings: {},
    channels: DISCONNECTED_CHANNELS,
    shelf: { packs: [] },
    adsAutonomy: "ASK",
    canPublish: false,
    meta: { connected: false },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoConnections)));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function addConnectionTrigger(dom: HTMLElement): HTMLButtonElement {
  const trigger = Array.from(dom.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Add connection",
  );
  expect(trigger, "Connections 页没有 Add connection 入口").toBeTruthy();
  return trigger!;
}

async function openDialog(dom: HTMLElement): Promise<HTMLButtonElement> {
  const trigger = addConnectionTrigger(dom);
  trigger.focus();
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
  return trigger;
}

describe("FRONT-A14 Add connection 弹窗的开场焦点", () => {
  it("FRONT-A14 打开后焦点不压在任何 Connect 动作上，而是停在弹窗自身", async () => {
    const dom = await renderConnections();
    await openDialog(dom);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, "Add connection 弹窗没打开").toBeTruthy();
    expect(dialog!.textContent).toContain("Add connection");
    // 弹窗里确实有真动作控件，否则这条回归测不到东西。
    expect(dialog!.querySelector('a[href="/api/meta/authorize"]'), "弹窗里没有 Connect 链接，样本不对").toBeTruthy();

    // 焦点必须留在弹窗内（键盘与读屏都靠这条）。有界等待走共用的 `expectFocusInside`：
    // Base UI 把焦点搬进 popup 是挂载后的下一拍（宏任务），`act` 只 flush 微任务。
    await expectFocusInside(dialog!, "焦点跑到弹窗外面去了");
    const active = document.activeElement as HTMLElement | null;

    // 弹窗里除了内建 Close，其余可聚焦控件都是真动作（Connect／Retry），一颗都不能被预压。
    const realActions = Array.from(dialog!.querySelectorAll<HTMLElement>("a[href], button")).filter(
      (element) => element.textContent?.trim() !== "Close",
    );
    expect(realActions.length, "弹窗里一颗真动作都没有，样本不对").toBeGreaterThan(0);
    expect(
      realActions.some((element) => element === active || element.contains(active)),
      "开场焦点压在一颗真动作上：误按一下 Enter 就开始授权",
    ).toBe(false);

    // 本轮落点就是弹窗自身（Base UI 给它 tabindex="-1"），读屏念的是标题与说明，不是某颗按钮。
    expect(active, "开场焦点不在弹窗容器上").toBe(dialog);
  });

  it("FRONT-A14 Escape 关闭后焦点仍回到 Add connection 入口", async () => {
    const dom = await renderConnections();
    const trigger = await openDialog(dom);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, "Add connection 弹窗没打开").toBeTruthy();
    // 先等焦点真的进了弹窗，再按 Escape——商家按的那一下正是发生在这之后。
    await expectFocusInside(dialog!, "焦点跑到弹窗外面去了");

    await act(async () => {
      (document.activeElement ?? document).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    // 焦点搬回入口同样是下一拍的事，用同一个有界等待。
    await expectFocusInside(trigger, "关闭后焦点没回到 Add connection");

    expect(document.querySelector('[role="dialog"]'), "Escape 没关掉弹窗").toBeNull();
    expect(document.activeElement, "关闭后焦点没回到 Add connection").toBe(trigger);
  });
});
