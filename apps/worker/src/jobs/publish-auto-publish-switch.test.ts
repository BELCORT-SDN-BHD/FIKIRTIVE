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

/**
 * #810 r3(跨族判官 r2 残余两条 P1)。
 *
 * [P1-a] r2 的复核做在 APPLYING 认领**之前**。认领之后还有最长 240 秒的慢工序 ——
 *   取媒体、转 JPEG、解析页面 —— 这段时间没有人再看一眼开关,商家在此窗口关掉,
 *   帖子照样发出去。开关要挡得住,必须挡在**外部发送之前的最后一刻**。
 *   做法:执行器把「准备」和「发送」拆开 —— 准备完返回一个 send 闭包,handlePublish
 *   在调用 send 之前问最后一次。复核与 send 之间的亚秒窗口是物理下限;240 秒不是。
 *
 * [P1-b] 「交还 SCHEDULED」的 CAS 没有排除别人的活 claim:重复 worker 能把另一个
 *   worker 正在发布的行翻回可编辑/可取消;而成功路径又只按 metaPostId:null 盲写
 *   PUBLISHED,会盖掉这期间商家的编辑或取消。两处都要 CAS 在「这仍然是我这一轮」上。
 */
describe("#810 r3 P1-a 最后一刻复核:慢工序期间关掉开关也发不出去", () => {
  /** 一个「真」执行器的形状:准备阶段不外呼,只返回 send 闭包。 */
  const preparingExecutor = (sent: () => void) =>
    vi.fn(async () => ({
      send: async () => {
        sent();
        return { externalId: "ig_1" };
      },
    }));

  it("开关全程开着 —— 准备完照常发送(这道闸不误伤正常发布)", async () => {
    const sent = vi.fn();
    const exec = preparingExecutor(sent);

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec as never);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledTimes(1);
    const published = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED");
    expect(published?.[0].data).toMatchObject({ status: "PUBLISHED", metaPostId: "ig_1" });
  });

  it("认领之后、发送之前商家关掉开关 —— 一个字都不发,claim 释放,行交还 SCHEDULED", async () => {
    // 第一次读(认领前的省钱短路)开关还开着;第二次读(发送前的最后一刻)已经关了。
    let reads = 0;
    m.organizationFindUnique.mockImplementation(async () => ({ settings: { autoPublish: ++reads === 1 } }));
    const sent = vi.fn();
    const exec = preparingExecutor(sent);

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec as never);

    // 慢工序照跑(钱已经花在转码上了,那不可逆),但外部发送一次都没有发生。
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sent).not.toHaveBeenCalled();
    expect(reads).toBe(2); // 两次复核都真的问了数据库
    // 不留 PUBLISHED / FAILED / NEEDS_ATTENTION —— 撤回不是失败。
    expect(m.scheduledPostUpdateMany.mock.calls.find((c) => ["PUBLISHED", "FAILED", "NEEDS_ATTENTION"].includes(c[0].data?.status))).toBeFalsy();
    // 自己的 claim 释放掉,行交还 SCHEDULED 等着。
    expect(m.publishAttemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: expect.anything(), state: "APPLYING" }), data: expect.objectContaining({ state: "FAILED" }) }),
    );
    const back = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "SCHEDULED");
    expect(back?.[0].where).toMatchObject({ id: "sp1", status: "PUBLISHING", metaPostId: null });
  });

  it("最后一刻读不到组织行 = fail closed,同样不发", async () => {
    let reads = 0;
    m.organizationFindUnique.mockImplementation(async () => (++reads === 1 ? { settings: { autoPublish: true } } : null));
    const sent = vi.fn();

    await handlePublish({ scheduledPostId: "sp1" }, 0, preparingExecutor(sent) as never);

    expect(sent).not.toHaveBeenCalled();
  });
});

describe("#810 r3 P1-b 两个 worker 交错:谁也别想翻掉别人正在发的那一行", () => {
  it("交还 SCHEDULED 的 CAS 必须排除还有活 APPLYING claim 的行", async () => {
    // 场景:worker A 已认领并在慢工序里(行是 PUBLISHING、存在活 APPLYING);
    // worker B 的同一个 job 被重复投递,读到开关已关,准备把行交还 SCHEDULED。
    m.scheduledPostFindUnique.mockResolvedValue({ ...DUE_POST, status: "PUBLISHING" });
    m.organizationFindUnique.mockResolvedValue({ settings: { autoPublish: false } });

    await handlePublish({ scheduledPostId: "sp1" }, 1, vi.fn() as never);

    const back = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "SCHEDULED");
    expect(back).toBeTruthy();
    // 关键:条件里必须带「这行上没有活着的 APPLYING」,否则会把 A 正在发的行翻回可编辑。
    expect(back?.[0].where).toMatchObject({
      id: "sp1",
      status: "PUBLISHING",
      metaPostId: null,
      attempts: { none: { state: "APPLYING" } },
    });
  });

  it("成功写回 CAS 在「仍是本 worker 的 APPLYING」上;claim 已被别人收走时不盲写 PUBLISHED", async () => {
    // 收尾时才发现自己的 claim 已经不在了(reaper 收走 / 别的路径改了)。
    m.publishAttemptUpdateMany.mockResolvedValue({ count: 0 });
    const exec = vi.fn(async () => ({ send: async () => ({ externalId: "ig_live" }) }));

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec as never);

    // 帖子确实已经上线,但这一行已经不归我们了 —— 不许盲写 PUBLISHED 盖掉期间的编辑或取消。
    expect(m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED")).toBeFalsy();
    // 但也不能装作没发生:留一条带 externalId 的 UNCONFIRMED 记录,lock 4 从此拒绝再发一次。
    expect(m.publishAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "UNCONFIRMED", metaPostId: "ig_live" }) }),
    );
  });

  it("正常成功:claim 仍是自己的 → 写 PUBLISHED,且 CAS 在 PUBLISHING 上(不能复活已取消的行)", async () => {
    const exec = vi.fn(async () => ({ send: async () => ({ externalId: "ig_ok" }) }));

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec as never);

    const published = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED");
    expect(published?.[0].where).toMatchObject({ id: "sp1", status: "PUBLISHING", metaPostId: null, deletedAt: null });
    expect(m.publishAttemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.anything(), state: "APPLYING" }),
        data: expect.objectContaining({ state: "APPLIED", metaPostId: "ig_ok" }),
      }),
    );
  });

  it("行在发送期间被取消/编辑走了 —— 不复活它,改为留下 UNCONFIRMED 让人来核", async () => {
    // claim CAS 命中(仍是我们的),但帖子行的 CAS 落空(状态已不是 PUBLISHING)。
    m.publishAttemptUpdateMany.mockResolvedValue({ count: 1 });
    m.scheduledPostUpdateMany.mockImplementation(async (args: { data?: { status?: string } }) =>
      args?.data?.status === "PUBLISHED" ? { count: 0 } : { count: 1 },
    );
    const exec = vi.fn(async () => ({ send: async () => ({ externalId: "ig_moved" }) }));

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec as never);

    expect(m.publishAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "UNCONFIRMED", metaPostId: "ig_moved" }) }),
    );
  });
});
