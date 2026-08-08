/**
 * #791-2(Auto-publish 假开关):Settings 里那个「Auto-publish posts」开关,商家关着,
 * 排期到点照样发 —— scanDuePublishPosts 全文没有读过 OwnerSettings.autoPublish,它只看
 * MetaConnection.canPublish。今天 Meta 未过审、canPublish 恒 false,所以这条谎话还没
 * 咬到人;过审那天它会同时对所有关着开关的商家生效。
 *
 * 这里把开关接成真的:一个 owner 的排期能不能自动发,必须同时满足
 *   ① 连接被 Meta 授权了(canPublish + 未暂停 + active),并且
 *   ② 商家自己把 Auto-publish 打开了。
 *
 * 默认值仍是关(DEFAULT_SETTINGS.autoPublish === false),所以「从没进过 Settings」的
 * 商家不会在过审当天被自动发布突袭。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const scheduledPostFindMany = vi.fn();
  const metaConnectionFindMany = vi.fn();
  const organizationFindMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findMany: scheduledPostFindMany },
    metaConnection: { findMany: metaConnectionFindMany },
    organization: { findMany: organizationFindMany },
  };
  return { prisma, scheduledPostFindMany, metaConnectionFindMany, organizationFindMany };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));

import { scanDuePublishPosts } from "./publish.js";

beforeEach(() => {
  vi.clearAllMocks();
  m.scheduledPostFindMany.mockResolvedValue([{ id: "sp1" }]);
});

describe("#791-2 Auto-publish 开关真的挡得住自动发布", () => {
  it("开关关着的 owner 不进扫描范围 —— 连接授权了也一样", async () => {
    m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o_off" }]);
    m.organizationFindMany.mockResolvedValue([{ id: "o_off", settings: { autoPublish: false } }]);

    expect(await scanDuePublishPosts()).toEqual([]);
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });

  it("从没设置过(settings 为 null)= 关着 —— 默认不替商家自动发", async () => {
    m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o_never" }]);
    m.organizationFindMany.mockResolvedValue([{ id: "o_never", settings: null }]);

    expect(await scanDuePublishPosts()).toEqual([]);
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });

  it("开关打开且连接被授权的 owner 才进扫描,并且只扫这些 owner", async () => {
    m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o_on" }, { ownerId: "o_off" }]);
    m.organizationFindMany.mockResolvedValue([
      { id: "o_on", settings: { autoPublish: true } },
      { id: "o_off", settings: { autoPublish: false } },
    ]);

    expect(await scanDuePublishPosts()).toEqual(["sp1"]);
    const where = m.scheduledPostFindMany.mock.calls[0]![0].where;
    expect(where.ownerId).toEqual({ in: ["o_on"] });
  });

  it("连接一个都没授权时,连 settings 都不用读(既有 fail-closed 不变)", async () => {
    m.metaConnectionFindMany.mockResolvedValue([]);
    expect(await scanDuePublishPosts()).toEqual([]);
    expect(m.organizationFindMany).not.toHaveBeenCalled();
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });

  it("settings 里塞了非布尔值(脏 JSON)按关处理 —— 不确定不等于可以", async () => {
    m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o_dirty" }]);
    m.organizationFindMany.mockResolvedValue([{ id: "o_dirty", settings: { autoPublish: "yes" } }]);

    expect(await scanDuePublishPosts()).toEqual([]);
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });
});
