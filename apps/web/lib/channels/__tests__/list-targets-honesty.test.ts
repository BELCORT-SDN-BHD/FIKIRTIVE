/**
 * #741 判官 r3 [P1] —— 适配层不许把「读不到」讲成「你一个账号都没连」。
 *
 * 病灶在最上游:instagram.ts / facebook.ts 拿到 fetchOwnerPages 的 `{ transientError: true }`
 * 之后照样 `return []`。于是一次暂时性的 Graph 故障,一路向下被产品断言成「你没有连接任何
 * 账号」,还配一颗 Connect 按钮 —— 商家的连接明明好好的。三种事实(读到了 / 读到了确实是空 /
 * 根本没读到)在适配层就被压成了两种。
 *
 * 判官 r5 [P1] 又往下挖了一层:上一轮把 needsReconnect / needsPageScope 也算成「确定的空」,
 * 同样是假话。这两种情况都发生在 MetaConnection **已存在**时(meta-pages.ts:13-22)——
 * 商家明明连过,连接页也显示 Connected / Reconnect needed,排程页却说「Connect an account
 * first」、服务端答「Connect your account before approving.」。同一个产品两套说法。
 *
 * 所以是**四**类,判断标准是「这次读得到了什么答案」:
 *   · pages —— 读到了,这些就是账号;
 *   · transientError —— 没得到答案(网络/5xx/限流),unavailable;
 *   · needsReconnect / needsPageScope —— 连着,但此刻用不了(blocked),各有各的如实说法;
 *   · notConnected —— **唯一**能安全映射成空列表的:确实没连过。
 *   · x —— 读本地库,永远确定。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchOwnerPages, mockChannelFindFirst } = vi.hoisted(() => ({
  mockFetchOwnerPages: vi.fn(),
  mockChannelFindFirst: vi.fn(),
}));

vi.mock("../../meta-pages", () => ({ fetchOwnerPages: mockFetchOwnerPages }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: vi.fn() }, channelConnection: { findFirst: mockChannelFindFirst } },
}));

import { instagram } from "../instagram";
import { facebook } from "../facebook";
import { x } from "../x";

const OWNER = "owner-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Meta 适配层:三态如实上报", () => {
  for (const channel of [instagram, facebook]) {
    it(`${channel.id}: 读到页面 → 就是这些账号`, async () => {
      mockFetchOwnerPages.mockResolvedValue({ pages: [{ id: "page-1", name: "Kopi Kita" }] });
      expect(await channel.listTargets(OWNER)).toEqual({ targets: [{ id: "page-1", name: "Kopi Kita" }] });
    });

    it(`${channel.id}: 暂时性故障 → 「读不到」,绝不是空列表`, async () => {
      mockFetchOwnerPages.mockResolvedValue({ transientError: true });
      const res = await channel.listTargets(OWNER);
      // 病灶就在这一行:旧代码 `"pages" in r ? … : []`,故障与「没连」同一个出口。
      expect(res).toEqual({ unavailable: true });
      expect("targets" in res).toBe(false);
    });

    it(`${channel.id}: notConnected → 确定的空列表(唯一能安全说「一个都没连」的情况)`, async () => {
      mockFetchOwnerPages.mockResolvedValue({ notConnected: true });
      expect(await channel.listTargets(OWNER)).toEqual({ targets: [] });
    });

    // 判官 r5 [P1]:这两种都发生在连接**已存在**时。说成空列表 = 告诉一个连过的商家
    // 「你没连过」,而且和连接页的说法对不上。
    it(`${channel.id}: needsReconnect → 连着但用不了,不是空列表`, async () => {
      mockFetchOwnerPages.mockResolvedValue({ needsReconnect: true });
      const res = await channel.listTargets(OWNER);
      expect(res).toEqual({ blocked: "needs_reconnect" });
      expect("targets" in res).toBe(false);
    });

    it(`${channel.id}: needsPageScope → 连着但没有页面权限,不是空列表`, async () => {
      mockFetchOwnerPages.mockResolvedValue({ needsPageScope: true });
      const res = await channel.listTargets(OWNER);
      expect(res).toEqual({ blocked: "needs_page_permission" });
      expect("targets" in res).toBe(false);
    });
  }
});

describe("x 适配层:本地读永远是确定的答案", () => {
  it("有连接 → 就是这个账号", async () => {
    mockChannelFindFirst.mockResolvedValue({ id: "row-1", externalId: "x-1", displayName: "Kopi Kita" });
    expect(await x.listTargets(OWNER)).toEqual({ targets: [{ id: "x-1", name: "Kopi Kita" }] });
  });

  it("没有连接 → 确定的空列表,不是 unavailable", async () => {
    mockChannelFindFirst.mockResolvedValue(null);
    expect(await x.listTargets(OWNER)).toEqual({ targets: [] });
  });
});
