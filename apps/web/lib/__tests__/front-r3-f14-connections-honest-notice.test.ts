// @vitest-environment jsdom
/**
 * R3-F14 —— Connections 页顶那句实话，规格 `docs/specs/wave2-shell.md:394-395` 要求、
 * 验收表 `docs/specs/wave2-shell.md:565` 定状态。
 *
 * **规格原话只描述得了一种世界，而我们不住在那种世界里。** 规格写的是一句话挂在一道闸上：
 *
 *   > No Instagram or Facebook account can be connected right now, so nothing here can be
 *   > linked yet. Your schedule stays real either way.
 *
 * 可这一页上有两道各自独立的闸：
 *   ① **连得上吗** —— 按渠道，来自 `lib/channels/channel-meta.ts` 的
 *      `UNAVAILABLE_PUBLISHING_CHANNEL_IDS`。今天名单里只有 `x`，所以 Instagram 与 Facebook
 *      各自画着一枚能按的 Connect。
 *   ② **连上之后发得出去吗** —— 全产品一颗开关，`PUBLISHING_AVAILABLE`。今天：发不出去。
 *
 * staging 正好落在规格那句话描述不了的那格（①开②关）：页顶说「一个账号都连不上」，两寸以下
 * 就是一枚活的 Connect 按钮。同一扇屏幕自相矛盾，商家学会的是「这页的话不用读」——那比这句话
 * 本身值钱得多。所以口径订正为**两道闸各自有答案**，登记在
 * `docs/specs/frontend-baseline.md` §5 的 2026-09-15 R3-F14 行。
 *
 * 这道围栏照抄 `publish-honest-preview.test.ts` 已经承重的三段式，并为两道闸各加一条：
 *   ① **四格全钉**（纯函数，不翻任何全局）：两闸的每一种组合各说各的话，全开返回 null。
 *   ② **可见面**：真把 `OttoConnections` 渲染出来，扫 `textContent` —— 注释、title 属性、
 *      源码字符串都不算，商家眼睛看得到的才算。
 *   ③ **反向自证**：三句话在 `OttoConnections.tsx` 源码里一个字都没有，却一字不差出现在
 *      DOM 上 —— 它只可能是从核心权威走过来的。谁抄一份到屏幕里，这一条立刻红。
 *   ④ **不许和逐服务的 Unavailable 重复**：X 那一行说的是「这个服务连不了」，页顶那句说的是
 *      整页两道闸。两句各说各的事，页面上各自只出现一次。
 *   ⑤ **不许和自己的按钮打架**（本轮新增，钉的就是 R3-F14 复核里那两条 P2）：屏幕上只要有一条
 *      通往 Meta 授权地址的活链接，页顶就不准说「一个账号都连不上」；反过来也一样。
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTIONS_NOTICE,
  PUBLISHING_AVAILABLE,
  connectionsNotice,
} from "@fikirtive/core/schedule-draft";
import { META_BACKED_CHANNEL_IDS, isConnectableChannel } from "@/lib/channels/channel-meta";

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

/** 今天这一页说的是哪一句 —— 从两道闸真实的读数推，不写死。 */
const TODAYS_NOTICE = connectionsNotice(
  META_BACKED_CHANNEL_IDS.some((id) => isConnectableChannel(id)),
  PUBLISHING_AVAILABLE,
);

describe("R3-F14 Connections 页顶的实话", () => {
  it("R3-F14 ①：两道闸四格各说各的 —— 全开那天一个字都不说", () => {
    // ①开②关 —— 今天，也是 staging 那一格：连得上，发不出去。
    expect(connectionsNotice(true, false)).toBe(
      "You can link an Instagram or Facebook account here, but publishing is not switched on yet, so nothing you schedule is sent to it. Your schedule stays real either way.",
    );
    // ①关②关 —— 连不上，也发不出去。
    expect(connectionsNotice(false, false)).toBe(
      "No Instagram or Facebook account can be connected right now, and publishing is not switched on yet, so nothing here can be linked or sent. Your schedule stays real either way.",
    );
    // ①关②开 —— 发得出去了，但还没有渠道可连。
    expect(connectionsNotice(false, true)).toBe(
      "Publishing is switched on, but no Instagram or Facebook account can be connected right now, so there is nothing here to send from yet.",
    );
    // 两闸全开:这句话自己消失,不需要有人记得回来删屏幕上的一行。
    expect(connectionsNotice(true, true)).toBeNull();

    // 四句各不相同 —— 任何两格共用一句话都意味着有一格在说不属于它的实话。
    expect(connectionsNotice(true, false)).toBe(CONNECTIONS_NOTICE.publishingOff);
    expect(connectionsNotice(false, false)).toBe(CONNECTIONS_NOTICE.neitherGate);
    expect(connectionsNotice(false, true)).toBe(CONNECTIONS_NOTICE.connectOff);
    expect(new Set(Object.values(CONNECTIONS_NOTICE)).size).toBe(3);
  });

  it("R3-F14 ①：第二个参数缺省时读的是产品那颗真开关,不是某个写死的 false", () => {
    expect(connectionsNotice(true)).toBe(connectionsNotice(true, PUBLISHING_AVAILABLE));
    expect(connectionsNotice(false)).toBe(connectionsNotice(false, PUBLISHING_AVAILABLE));
  });

  it("R3-F14 ①：两道闸今天各自的读数 —— 任一道翻面这条就红,提醒回来改屏幕上的话", () => {
    // ① 今天连得上:UNAVAILABLE_PUBLISHING_CHANNEL_IDS 里只有 x。
    expect(META_BACKED_CHANNEL_IDS.map((id) => isConnectableChannel(id))).toEqual([true, true]);
    expect(isConnectableChannel("x")).toBe(false);
    // ② 今天发不出去。
    expect(PUBLISHING_AVAILABLE).toBe(false);
    // 于是今天该说的就是 ①开②关 那一句。
    expect(TODAYS_NOTICE).toBe(CONNECTIONS_NOTICE.publishingOff);
  });

  it("R3-F14 ②：商家在 Connections 页上看得到今天这两道闸对应的那一句", async () => {
    mocks.getAccountViewData.mockResolvedValue({
      settings: {},
      channels: DISCONNECTED_CHANNELS,
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { connected: false },
    });

    const dom = await renderConnections();
    expect(dom.textContent ?? "").toContain(TODAYS_NOTICE!);
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
    expect(dom.textContent ?? "").toContain(TODAYS_NOTICE!);
  });

  it("R3-F14 ②：商家自己连着 Meta 也照说 —— 闸②问的是产品,不是这一家的连接状态", async () => {
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
    expect(dom.textContent ?? "").toContain(TODAYS_NOTICE!);
  });

  it("R3-F14 ②：读不回来(error)与读之前(loading)说的是同一句 —— 闸①不由那次网络读回答", async () => {
    mocks.getAccountViewData.mockResolvedValue({ error: "load-failed" });

    const dom = await renderConnections();
    expect(dom.textContent ?? "").toContain("Could not load connections");
    expect(dom.textContent ?? "").toContain(TODAYS_NOTICE!);
  });

  it("R3-F14 ③：反向自证 —— 屏幕上一字不差,源码里一个字都没有", () => {
    for (const sentence of Object.values(CONNECTIONS_NOTICE)) {
      expect(CONNECTIONS_SRC).not.toContain(sentence);
    }
    expect(CONNECTIONS_SRC).not.toContain("can be connected right now");
    expect(CONNECTIONS_SRC).not.toContain("You can link an Instagram");
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
    expect(occurrences(text, TODAYS_NOTICE!)).toBe(1);

    // X 那一行原本的实话原封不动:清单行仍是 Unavailable,详情面板仍写自己那一句。
    const xRow = dom.querySelector<HTMLButtonElement>('button[aria-label="View X connection"]');
    expect(xRow).toBeTruthy();
    expect(xRow!.textContent).toContain("Unavailable");
    // 这句是**逐服务**的,页顶那句没有把它顶掉,也没有复述它。
    expect(occurrences(text, "This service is not available to connect.")).toBe(0);
    await act(async () => xRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const xText = dom.textContent ?? "";
    expect(occurrences(xText, "This service is not available to connect.")).toBe(1);
    expect(occurrences(xText, TODAYS_NOTICE!)).toBe(1);
  });

  it("R3-F14 ⑤：页顶那句不准和同屏的按钮打架 —— 有活的 Connect 就不准说「连不上」", async () => {
    // 这一条钉的正是复核里那两条 P2:句子挂在 PUBLISHING_AVAILABLE 一道闸上时,Instagram 详情
    // 面板那枚活 Connect 就在同屏两寸以下,页顶却说一个账号都连不上。
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

    // 默认选中第一行(Instagram),详情面板画着一条通往 Meta 授权地址的活链接。
    const connectLink = dom.querySelector<HTMLAnchorElement>('a[href="/api/meta/authorize"]');
    expect(connectLink).toBeTruthy();
    expect(connectLink!.textContent).toContain("Connect");

    // 有活链接 ⇒ 页顶不准说「一个账号都连不上」,两句里的任何一句都不行。
    expect(text).not.toContain(CONNECTIONS_NOTICE.neitherGate);
    expect(text).not.toContain(CONNECTIONS_NOTICE.connectOff);
    expect(text).not.toContain("No Instagram or Facebook account can be connected right now");
    // 该说的是承认连得上、但发不出去的那一句。
    expect(text).toContain(CONNECTIONS_NOTICE.publishingOff);
  });

  it("R3-F14 ⑤：反过来也一样 —— Meta 也进不可连名单那天,页顶改口而不是继续说反话", () => {
    // 闸①真关上时的那两句,都以「连不上」开头,与那天屏幕上零个 Connect 按钮对得上。
    expect(connectionsNotice(false, false)).toContain(
      "No Instagram or Facebook account can be connected right now",
    );
    expect(connectionsNotice(false, true)).toContain(
      "no Instagram or Facebook account can be connected right now",
    );
    // 而闸①开着的那一句,一个字都不说「连不上」。
    expect(connectionsNotice(true, false)!.toLowerCase()).not.toContain("can be connected right now");
  });
});
