/**
 * #741 判官 r3 [P1] —— 适配层不许把「读不到」讲成「你一个账号都没连」。
 *
 * 病灶在最上游:instagram.ts / facebook.ts 拿到 fetchOwnerPages 的 `{ transientError: true }`
 * 之后照样 `return []`。于是一次暂时性的 Graph 故障,一路向下被产品断言成「你没有连接任何
 * 账号」,还配一颗 Connect 按钮 —— 商家的连接明明好好的。三种事实(读到了 / 读到了确实是空 /
 * 根本没读到)在适配层就被压成了两种。
 *
 * 这里钉的是三态本身。判断标准只有一条:**这次读有没有得到答案**。
 *   · transientError —— 没得到答案(网络/5xx/限流),唯一的 unavailable;
 *   · notConnected / needsPageScope / needsReconnect —— 都是**确定的答案**:此刻确实没有
 *     可发布的页面,连接页也正是这么写的,所以是真实的空列表,不是失败。
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

    for (const determinate of [{ notConnected: true }, { needsPageScope: true }, { needsReconnect: true }]) {
      it(`${channel.id}: ${Object.keys(determinate)[0]} → 确定的空列表(这是真答案,不是失败)`, async () => {
        mockFetchOwnerPages.mockResolvedValue(determinate);
        expect(await channel.listTargets(OWNER)).toEqual({ targets: [] });
      });
    }
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
