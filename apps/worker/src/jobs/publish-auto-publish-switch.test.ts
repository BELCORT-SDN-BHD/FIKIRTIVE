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
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const metaConnectionFindMany = vi.fn();
  const organizationFindMany = vi.fn();
  const organizationFindUnique = vi.fn();
  const publishAttemptCreate = vi.fn();
  const publishAttemptFindFirst = vi.fn();
  const publishAttemptUpdate = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findMany: scheduledPostFindMany, findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany },
    metaConnection: { findMany: metaConnectionFindMany },
    organization: { findMany: organizationFindMany, findUnique: organizationFindUnique },
    publishAttempt: { create: publishAttemptCreate, findFirst: publishAttemptFindFirst, update: publishAttemptUpdate, updateMany: publishAttemptUpdateMany },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
  };
  return {
    prisma, scheduledPostFindMany, scheduledPostFindUnique, scheduledPostUpdateMany,
    metaConnectionFindMany, organizationFindMany, organizationFindUnique,
    publishAttemptCreate, publishAttemptFindFirst, publishAttemptUpdate, publishAttemptUpdateMany,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));

import { handlePublish, scanDuePublishPosts } from "./publish.js";

const DUE_POST = {
  id: "sp1", ownerId: "o1", channel: "instagram", metaTargetId: "pg1", caption: "hi", firstComment: null,
  status: "SCHEDULED", metaPostId: null, deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.scheduledPostFindMany.mockResolvedValue([{ id: "sp1" }]);
  m.scheduledPostFindUnique.mockResolvedValue(DUE_POST);
  m.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });
  m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: true } });
  m.publishAttemptCreate.mockResolvedValue({ id: "pa1" });
  m.publishAttemptFindFirst.mockResolvedValue(null);
  m.publishAttemptUpdate.mockResolvedValue({});
  m.publishAttemptUpdateMany.mockResolvedValue({ count: 1 });
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

/**
 * #810 P1-1(跨族判官):上面那道闸只在**扫描**时查开关。入队载荷只有 scheduledPostId,
 * 执行时 handlePublish 只复核 Meta 授权,从不读 Organization.settings —— 于是这条时序
 * 是可达的:开关 ON → 扫描入队 → 商家切 OFF → worker 执行(或 60 秒后重试)→ 帖子照样
 * 上线。商家明确撤回之后仍然发生了外部副作用,这是最不该发生的一类。
 *
 * 一个开关要挡得住,必须挡在**外部副作用发生之前的那一刻**,不是挡在决定要发的那一刻。
 */
describe("#810 P1-1 执行前复核:开关关了就不发", () => {
  it("入队之后商家关掉开关 —— 执行时不发,零 Meta 调用,连 APPLYING 都不认领", async () => {
    m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: false } });
    const exec = vi.fn();

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);

    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
    // 复核读的是这个 owner 自己的 settings。
    expect(m.organizationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "o1" } }),
    );
  });

  it("首次失败进重试、重试前商家关掉 —— 重试也不发,并且把帖子交还 SCHEDULED 等着", async () => {
    // 重试时行是 PUBLISHING(上一轮 claim 留下的),不是 SCHEDULED。
    m.scheduledPostFindUnique.mockResolvedValue({ ...DUE_POST, status: "PUBLISHING" });
    m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: false } });
    const exec = vi.fn();

    await handlePublish({ scheduledPostId: "sp1" }, 1, exec);

    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
    // 不留在 PUBLISHING 装作还在发:交还 SCHEDULED,开关再打开就照常走。
    const back = m.scheduledPostUpdateMany.mock.calls.at(-1)?.[0];
    expect(back?.where).toMatchObject({ id: "sp1", status: "PUBLISHING", metaPostId: null });
    expect(back?.data).toMatchObject({ status: "SCHEDULED" });
  });

  it("settings 读不到(组织行没了)= fail closed 不发", async () => {
    m.organizationFindUnique.mockResolvedValue(null);
    const exec = vi.fn();

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);

    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
  });

  it("开关仍然开着 —— 照常认领并执行(这道闸不挡正常发布)", async () => {
    const exec = vi.fn().mockResolvedValue({ externalId: "ig_1" });

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(m.publishAttemptCreate).toHaveBeenCalledTimes(1);
  });
});
