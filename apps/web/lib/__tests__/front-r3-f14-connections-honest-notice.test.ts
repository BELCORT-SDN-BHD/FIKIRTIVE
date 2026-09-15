// @vitest-environment jsdom
/**
 * R3-F14 —— Connections 页顶那句实话，规格 `docs/specs/wave2-shell.md:394-395` 要求、
 * 验收表 `docs/specs/wave2-shell.md:565` 定状态：
 *
 *   > No Instagram or Facebook account can be connected right now, so nothing here can be
 *   > linked yet. Your schedule stays real either way.
 *
 * 状态由验收表自己写死：「Connections 页在 `PUBLISHING_AVAILABLE === false` 时说出
 * 「现在连不上」」——**不是永远说**。通电那天这句话必须自己消失，否则它就变成这仓最贵的
 * 老病：一句活得比它描述的事实还久的话。
 *
 * 这道围栏照抄 `publish-honest-preview.test.ts` 已经承重的三段式：
 *   ① **两态都钉**（纯函数，不翻任何全局）：关着说那一句，开着返回 null。
 *   ② **可见面**：真把 `OttoConnections` 渲染出来，扫 `textContent` —— 注释、title 属性、
 *      源码字符串都不算，商家眼睛看得到的才算。
 *   ③ **反向自证**：这句话在 `OttoConnections.tsx` 源码里一个字都没有，却一字不差出现在
 *      DOM 上 —— 它只可能是从核心权威走过来的。谁抄一份到屏幕里，这一条立刻红。
 *
 * 外加一条 R3-F14 自己的：**不许和逐服务的 Unavailable 重复**。X 那一行的「Unavailable」
 * 说的是「这个服务连不了」，页顶这句说的是「Instagram / Facebook 今天也连不了」。两句各说
 * 各的事，页面上各自只出现一次。
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTIONS_PREVIEW_NOTICE,
  PUBLISHING_AVAILABLE,
  connectionsPreviewNotice,
} from "@fikirtive/core/schedule-draft";

const mocks = vi.hoisted(() => ({
  disconnectMeta: vi.fn(),
  getMetaInsights: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
  getAccountViewData: vi.fn(),
}));

vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: vi.fn(),
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

const CONNECTIONS_SRC = readFileSync(
  path.join(process.cwd(), "components/otto/OttoConnections.tsx"),
  "utf8",
);

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
  { id: "x", label: "X", status: "not_connected" as const, targets: [], connectUrl: "/api/x/authorize" },
];

const CONNECTED_CHANNELS = [
  { id: "instagram", label: "Instagram", status: "connected" as const, targets: ["Acme IG Page"], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "connected" as const, targets: ["Acme Page"], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "not_connected" as const, targets: [], connectUrl: "/api/x/authorize" },
];

async function renderConnections(embedded = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoConnections, { embedded })));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

describe("R3-F14 Connections 页顶的实话", () => {
  it("R3-F14 ①：权威两态各说各的 —— 关着说那一句，开着一个字都不说", () => {
    expect(connectionsPreviewNotice(false)).toBe(
      "No Instagram or Facebook account can be connected right now, so nothing here can be linked yet. Your schedule stays real either way.",
    );
    expect(connectionsPreviewNotice(false)).toBe(CONNECTIONS_PREVIEW_NOTICE);
    // 通电那天这句话自己消失,不需要有人记得回来删屏幕上的一行。
    expect(connectionsPreviewNotice(true)).toBeNull();
  });

  it("R3-F14 ②：发布没通电时,商家在 Connections 页上看得到这句话", async () => {
    // 这一条钉的是**预览门**当前的状态;通电那天(PUBLISHING_AVAILABLE 翻 true)它跟着删,
    // 与 publish-honest-preview.test.ts 顶上那条同一寿命。
    expect(PUBLISHING_AVAILABLE).toBe(false);

    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });

    const dom = await renderConnections();
    expect(dom.textContent ?? "").toContain(CONNECTIONS_PREVIEW_NOTICE);
  });

  it("R3-F14 ②：搬进 Settings 外壳(embedded)之后仍然说得出来", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });

    const dom = await renderConnections(true);
    expect(dom.textContent ?? "").toContain(CONNECTIONS_PREVIEW_NOTICE);
  });

  it("R3-F14 ②：商家自己连着 Meta 也照说 —— 这句话问的是产品,不是这一家的连接状态", async () => {
    // 「产品发得出去吗」压过「这家商家连上了吗」,与 auto-publish 那颗开关同一个口径
    // (`apps/web/lib/auto-publish-gate.ts`)。
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: CONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: true,
      meta: {
        connected: true,
        status: "active",
        accounts: [],
        canWrite: true,
        adsAutonomy: "ASK",
        adsWritesPaused: false,
      },
    });
    mocks.getMetaInsights.mockResolvedValue({ accounts: [] });

    const dom = await renderConnections();
    expect(dom.textContent ?? "").toContain(CONNECTIONS_PREVIEW_NOTICE);
  });

  it("R3-F14 ③：反向自证 —— 屏幕上一字不差,源码里一个字都没有", () => {
    expect(CONNECTIONS_SRC).not.toContain(CONNECTIONS_PREVIEW_NOTICE);
    expect(CONNECTIONS_SRC).not.toContain("can be connected right now");
  });

  it("R3-F14 ④：不和逐服务的 Unavailable 重复 —— 两句各说各的事,各出现一次", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });

    const dom = await renderConnections();
    const text = dom.textContent ?? "";

    // 页顶这句只说一次(没有被逐渠道 map 出三份)。
    expect(occurrences(text, CONNECTIONS_PREVIEW_NOTICE)).toBe(1);

    // X 那一行原本的实话原封不动:清单行仍是 Unavailable,详情面板仍写自己那一句。
    const xRow = dom.querySelector<HTMLButtonElement>('button[aria-label="View X connection"]');
    expect(xRow).toBeTruthy();
    expect(xRow!.textContent).toContain("Unavailable");
    // 这句是**逐服务**的,页顶那句没有把它顶掉,也没有复述它。
    expect(occurrences(text, "This service is not available to connect.")).toBe(0);
    await act(async () => xRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const xText = dom.textContent ?? "";
    expect(occurrences(xText, "This service is not available to connect.")).toBe(1);
    expect(occurrences(xText, CONNECTIONS_PREVIEW_NOTICE)).toBe(1);
  });
});
