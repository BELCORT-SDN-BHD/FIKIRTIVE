/**
 * #851 r2 —— 屏幕说「nothing is sent」,worker 就不许送出去。
 *
 * 病灶(r1 判官 P1):产品级发布闸只接到了**文案**上。排程屏、批准卡、Otto 三处都改口说
 * 「publishing is not switched on — nothing goes out」,但 `scanDuePublishPosts()` 只问
 * 「Meta 授权了吗 + 商家开关开着吗」,执行时的最后一道复核也只问商家开关。于是这条时序完全
 * 可达:一个**连接已授权、自己把 Auto-publish 打开**的 workspace,会在一块写着「什么都不会
 * 发出去」的屏幕底下,真的把帖子发到 Instagram。说的和做的分家,而且分在最贵的那一侧 ——
 * 外部副作用不可逆。
 *
 * 这个文件守的是「做的」那一半:**不 mock 产品闸**,读的就是 packages/core 里
 * `PUBLISHING_AVAILABLE` 今天真实的值。同族的另外四个 publish 测试文件测的是「发布真的发生
 * 时」的机制(三重幂等、六状态、认领与交还),那些机制只有通电才走得到,所以它们把闸显式
 * mock 成 true —— 每个文件顶上都写着为什么,并指回这里。
 *
 * ── 承重在哪(如实声明)────────────────────────────────────────────────────
 * · 前三条断言的是**行为**,不是文案:替身执行器一次都没被调用、APPLYING 认领一次都没建、
 *   帖子行不留在 PUBLISHING 装作还在发。
 * · 第四条是反面自证:同一套 prisma 替身,把闸 mock 成通电后重新装载 publish.js,同一个
 *   handlePublish 立刻就发。少了它,上面三条可能只是在一个坏掉的台子上永远为真。
 * · 闸是**产品级**的:它不认识 owner,所以这里不测租户形状 —— 租户隔离另有其守。
 *
 * ⚠️ 通电那天:翻 packages/core/src/schedule-draft.ts 的 PUBLISHING_AVAILABLE 之后,本文件
 * 整个删掉(它断言的正是「闸关着」),同族四个文件顶上那条 mock 与它的注释一并删掉 —— 那条
 * mock 存在的唯一理由就是这道闸关着。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUBLISHING_AVAILABLE } from "@fikirtive/core/schedule-draft";

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

// 注意:这里**没有** mock @fikirtive/core/schedule-draft —— 全文读的是产品闸的真实值。
import { handlePublish, scanDuePublishPosts } from "./publish.js";

const DUE_POST = {
  id: "sp1", ownerId: "o1", channel: "instagram", metaTargetId: "pg1", caption: "hi", firstComment: null,
  status: "SCHEDULED", metaPostId: null, deletedAt: null,
};

/** 一个「样样齐备」的现场:连接被 Meta 授权、商家自己把 Auto-publish 打开、帖子已批准且到点。
 *  除了产品闸,没有任何一道闸拦得住它 —— 所以下面每一条不发,都只可能是产品闸挡的。 */
beforeEach(() => {
  vi.clearAllMocks();
  m.metaConnectionFindMany.mockResolvedValue([{ ownerId: "o1" }]);
  m.organizationFindMany.mockResolvedValue([{ id: "o1", settings: { autoPublish: true } }]);
  m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: true } });
  m.scheduledPostFindMany.mockResolvedValue([{ id: "sp1" }]);
  m.scheduledPostFindUnique.mockResolvedValue(DUE_POST);
  m.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });
  m.publishAttemptCreate.mockResolvedValue({ id: "pa1" });
  m.publishAttemptFindFirst.mockResolvedValue(null);
  m.publishAttemptUpdate.mockResolvedValue({});
  m.publishAttemptUpdateMany.mockResolvedValue({ count: 1 });
});

describe("#851 产品闸关着时,发布 worker 一个字都不投递", () => {
  it("适用期:发布通道还没通电 —— 这一条红了就是回来删掉本文件的时刻", () => {
    expect(PUBLISHING_AVAILABLE).toBe(false);
  });

  it("扫描:授权 + 开关全开的 owner 也不进队列,连连接表都不查", async () => {
    expect(await scanDuePublishPosts()).toEqual([]);
    // 闸挡在最前面:不是「查完发现没有」,是根本没开始查。
    expect(m.metaConnectionFindMany).not.toHaveBeenCalled();
    expect(m.scheduledPostFindMany).not.toHaveBeenCalled();
  });

  it("执行:就算有一条 job 已经在队列里,也不外呼、不认领、不写 PUBLISHED", async () => {
    const exec = vi.fn().mockResolvedValue({ externalId: "ig_1" });

    await handlePublish({ scheduledPostId: "sp1" }, 0, exec);

    // job 确实跑到了(台子是活的),然后在任何外部动作之前停住。
    expect(m.scheduledPostFindUnique).toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(m.publishAttemptCreate).not.toHaveBeenCalled();
    expect(m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED")).toBeFalsy();
    // 撤回不是失败:不留 FAILED / NEEDS_ATTENTION,帖子还在它的位置上等着。
    expect(
      m.scheduledPostUpdateMany.mock.calls.find((c) => ["FAILED", "NEEDS_ATTENTION"].includes(c[0].data?.status)),
    ).toBeFalsy();
  });

  it("重投递:上一轮留下的 PUBLISHING 行交还 SCHEDULED,不装作还在发", async () => {
    m.scheduledPostFindUnique.mockResolvedValue({ ...DUE_POST, status: "PUBLISHING" });
    const exec = vi.fn();

    await handlePublish({ scheduledPostId: "sp1" }, 1, exec);

    expect(exec).not.toHaveBeenCalled();
    const back = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "SCHEDULED");
    expect(back?.[0].where).toMatchObject({ id: "sp1", status: "PUBLISHING", metaPostId: null });
  });
});

describe("#851 反面自证:这套替身在通电时确实会发", () => {
  afterEach(() => {
    vi.doUnmock("@fikirtive/core/schedule-draft");
    vi.resetModules();
  });

  it("同一套 prisma 替身 + 同一个 handlePublish,闸通电后立刻发 —— 上面三条不是在检一个坏掉的台子", async () => {
    vi.resetModules();
    vi.doMock("@fikirtive/core/schedule-draft", () => ({ PUBLISHING_AVAILABLE: true }));
    const { handlePublish: handlePublishWithGateOn, scanDuePublishPosts: scanWithGateOn } = await import("./publish.js");
    const exec = vi.fn().mockResolvedValue({ externalId: "ig_1" });

    expect(await scanWithGateOn()).toEqual(["sp1"]);
    await handlePublishWithGateOn({ scheduledPostId: "sp1" }, 0, exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(m.publishAttemptCreate).toHaveBeenCalledTimes(1);
  });
});
