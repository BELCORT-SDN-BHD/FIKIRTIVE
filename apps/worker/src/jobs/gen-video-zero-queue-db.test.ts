/**
 * gen-video-zero-queue-db.test.ts — #1435(零排队,docs/specs/zero-queue.md)在**真库**上、跑
 * **真的 `handleGen`** 证 QUEUE-A1 / A2 / A3 / A4。
 *
 * 只 mock 两件事:付费引擎(绝不真调用)和对象存储。库、钱、`reserveCredits`/`settleCredits`/
 * `refundReservation`、认领的条件写全是真的——验收句要求「真机制,不许靠种子绕」,所以每一条
 * 视频「在飞」都是真跑一次 `handleGen` 提交出来的,不是手填一行 GENERATING 状态的 DB 行。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  submitVideo: vi.fn(),
  pollVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, submitVideo: m.submitVideo, pollVideo: m.pollVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits, refundReservation } from "@fikirtive/db";
import { handleGen } from "./gen.js";

const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000;

type Org = { orgId: string; projectId: string };

async function seedOrg(name: string): Promise<Org> {
  const orgId = `org_${randomUUID()}`;
  const projectId = `prj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name } });
  return { orgId, projectId };
}

async function seedVideoJob(org: Org, id: string): Promise<void> {
  await prisma.genJob.create({
    data: {
      id, ownerId: org.orgId, projectId: org.projectId,
      prompt: "a fifteen minute product walkthrough", kind: "VIDEO", model: "seedance-2-mini",
      count: 1, status: "QUEUED", spent: false, videoOptions: { seconds: 5, resolution: "480p" },
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId: org.orgId, refId: id, cost: HOLD }));
}

async function seedImageJob(org: Org, id: string): Promise<void> {
  await prisma.genJob.create({
    data: {
      id, ownerId: org.orgId, projectId: org.projectId,
      prompt: "a quick poster", kind: "IMAGE", model: "seedream",
      count: 1, status: "QUEUED", spent: false,
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId: org.orgId, refId: id, cost: HOLD }));
}

async function jobRow(org: Org, id: string) {
  return prisma.genJob.findFirstOrThrow({
    where: { id, ownerId: org.orgId }, select: { status: true, generationIds: true, videoOptions: true, spent: true },
  });
}

async function ledgerKinds(orgId: string, refId: string) {
  const rows = await prisma.creditLedger.findMany({ where: { orgId, refId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => r.kind);
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(() => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("QUEUE-A1 / QUEUE-A2 — 4 条视频真的提交在飞时，施工位与账本都是空闲的，商家 B 的短任务立即开跑不等队", () => {
  it(
    "QUEUE-A1: 商家 A 连发 4 条长视频后，商家 B 提交短任务，B 的任务立即开跑不等队（真机制：每条 handleGen 调用都真的跑完提交，不是种子直接写 GENERATING）",
    async () => {
      const merchantA = await seedOrg("Merchant A — four long videos");
      const merchantB = await seedOrg("Merchant B — one quick poster");

      // 商家 A 连发 4 条长视频：逐条真跑 handleGen 的**提交**分支（唯一 mock 的是付费引擎本身，
      // 认领、reserve、写在飞任务标记全部走真实的 Postgres 条件写）。
      const aIds = Array.from({ length: 4 }, (_, i) => `gen_a${i}_${randomUUID()}`);
      const submitStartedAt = Date.now();
      for (const [i, id] of aIds.entries()) {
        await seedVideoJob(merchantA, id);
        m.submitVideo.mockResolvedValueOnce({ providerTaskId: `task-a${i}` });
        const outcome = await handleGen({ genJobId: id }, 0);
        // 真机制的核心断言就在这里：提交成功之后这次投递**立即结束**——不是「假装结束」，是
        // handleGen 自己的 await 链真的在这一行返回，没有原地等到视频真正渲染完。
        expect(outcome).toMatchObject({ awaitingVideoPoll: true });
      }
      const submitElapsedMs = Date.now() - submitStartedAt;
      // 4 次真实的 handleGen 调用（各自一次真实的 Postgres 认领 + reserve 查询 + 条件写）全部
      // 跑完只用了这么短的时间，本身就是「没有原地等视频渲染」的直接证据——如果这里像旧账
      // 那样原地轮询到终态，这一步会花上真实的分钟级时间，而不是毫秒级。
      expect(submitElapsedMs).toBeLessThan(5_000);

      // A 的 4 条现在都是「在飞」——真产品意义上视频正在供应商那边生成——但每一行在数据库里
      // 长的是「已提交、等下一次查询」的样子，不是「worker 正占着什么」的样子：没有任何一列
      // 记着「这个 worker 进程/施工位仍然拴在这条作业上」，因为 handleGen 的调用已经结束了。
      for (const id of aIds) {
        const row = await jobRow(merchantA, id);
        expect(row.status).toBe("GENERATING");
        expect(row.generationIds).toEqual([]);
        expect((row.videoOptions as { providerTask?: { id: string } } | null)?.providerTask?.id).toBeTruthy();
      }

      // 商家 B 的短任务：在 A 的 4 条视频**仍然在飞**的这一刻提交，真认领、真出图、真结算——
      // 不等 A 的任何一条渲染完。
      const bId = `gen_b_${randomUUID()}`;
      await seedImageJob(merchantB, bId);
      const bStartedAt = Date.now();
      const bOutcome = await handleGen({ genJobId: bId }, 0);
      const bElapsedMs = Date.now() - bStartedAt;

      expect(bOutcome).toBeUndefined(); // 正常完工，不是又一次「放手」
      expect(bElapsedMs).toBeLessThan(5_000); // 同样立即完工，不是排在 A 后面等出来的
      const bRow = await jobRow(merchantB, bId);
      expect(bRow.status).toBe("DONE");
      expect(bRow.spent).toBe(true);
      expect(await ledgerKinds(merchantB.orgId, bId)).toEqual(["RESERVE", "SETTLE"]);

      // 反向锚：A 的 4 条这一刻确实还在飞（不是因为它们其实已经悄悄结束了，B 才显得「没等」）。
      for (const id of aIds) {
        expect((await jobRow(merchantA, id)).status).toBe("GENERATING");
      }
    },
    DB_CASE_TIMEOUT_MS,
  );
});

describe("QUEUE-A3 — 任意轮询次数下走完提交→成功，账本恰一组 reserve→settle，轮询不产生任何额外账本行", () => {
  it(
    "QUEUE-A3: 提交 + 6 次 pending 轮询 + 1 次 succeeded 轮询，账本自始至终只有 RESERVE 与 SETTLE 各一行",
    async () => {
      const org = await seedOrg("QUEUE-A3 poll count");
      const id = `gen_a3_${randomUUID()}`;
      await seedVideoJob(org, id);

      // 提交。
      m.submitVideo.mockResolvedValue({ providerTaskId: "task-a3" });
      await handleGen({ genJobId: id }, 0);
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE"]);

      // 6 次 pending 轮询——每一次都是一条**新的**投递（真读库、真判 pending、真结束）。
      m.pollVideo.mockResolvedValue({ status: "pending" });
      for (let i = 0; i < 6; i++) {
        const outcome = await handleGen({ genJobId: id }, 0);
        expect(outcome).toMatchObject({ awaitingVideoPoll: true });
        // 恰一组的前半句:轮询次数不管多少,账本这一刻都只有 RESERVE ——一行都没多。
        expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE"]);
      }

      // 第 7 次:终于 succeeded。
      m.pollVideo.mockResolvedValue({
        status: "succeeded",
        video: { bytes: new Uint8Array([9]), ext: "mp4" },
      });
      const finalOutcome = await handleGen({ genJobId: id }, 0);
      expect(finalOutcome).toBeUndefined();
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "SETTLE"]);
      expect((await jobRow(org, id)).status).toBe("DONE");
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "QUEUE-A3: 已经 DONE 之后再被重投一次(同一条 succeeded 消息晚到)——resume-committed 短路生效，provider 一次都不再被调用，账本恰一组不动",
    async () => {
      const org = await seedOrg("QUEUE-A3 late redelivery");
      const id = `gen_a3b_${randomUUID()}`;
      await seedVideoJob(org, id);

      m.submitVideo.mockResolvedValue({ providerTaskId: "task-a3b" });
      await handleGen({ genJobId: id }, 0);
      m.pollVideo.mockResolvedValue({ status: "succeeded", video: { bytes: new Uint8Array([9]), ext: "mp4" } });
      await handleGen({ genJobId: id }, 0);
      expect((await jobRow(org, id)).status).toBe("DONE");
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "SETTLE"]);

      // 迟到的重投:pg-boss 的 at-least-once 语义下，同一条已经处理完的消息完全可能再送一次。
      vi.clearAllMocks();
      m.pollVideo.mockResolvedValue({ status: "succeeded", video: { bytes: new Uint8Array([9]), ext: "mp4" } });
      const redeliveryOutcome = await handleGen({ genJobId: id }, 0);

      expect(redeliveryOutcome).toBeUndefined();
      expect(m.pollVideo).not.toHaveBeenCalled(); // #1435 的 resume-check 排在 generationIds.length>0 短路之后——这一次投递从没走到过 pollVideo
      expect(m.submitVideo).not.toHaveBeenCalled();
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "SETTLE"]); // 恰一组，没有第二笔 SETTLE

      // ── 变异检验(#1430 先例口径,亲手做过一次,如实记录结果——包含一次预判落空)────────
      // 第一次尝试只关掉 gen.ts 顶部的
      //     if (job.generationIds.length > 0) { committed = true; await resumeCommittedGenJob(job); return; }
      // (改成 `if (false && ...)`)——预期会红,结果**仍然绿**:handleGen 最顶上还有一条更早的
      // 独立短路 `if (job.status === "DONE") return;`(line ~1632),这一单此刻 status 已经是
      // DONE,单独这一条就已经挡住了整次重投,`generationIds.length>0` 那句压根没被走到。
      // 只关掉 DONE 早退那一句、留着 generationIds 那句,同样**仍然绿**——因为反过来
      // generationIds 那句独立地也挡住了它。这两条互相冗余地保护着"同一条晚到的重投"这一种
      // 情形,任何一条单独在场都够。只有**同时**关掉这两句,这条用例才真的红:
      //   AssertionError: expected "spy" to not be called at all, but actually been called 1 times
      //   (m.pollVideo 的第 207 行断言——`provider.pollVideo("task-a3b", {returnLastFrame:true})`
      //   真的被再调用了一次)
      // 日志同时证实了下一层防线接住了它:代码一路走到 resume-poll 分支重新查到 succeeded,
      // 再次跑进 commit 事务,而那笔 commit 事务自己的 CAS(`where:{status:"GENERATING"}`,
      // line ~2439)因为这一行已经是 DONE 而匹配 0 行,抛 REDELIVERY_DISCARD,干净回滚——
      // handleGen 的返回值(undefined)因此仍然"看起来对",真正暴露问题的只有
      // `pollVideo`/`submitVideo` 调用次数这两条断言。这是这条用例本身教会我的事,而不是
      // 编写它之前就预料到的:QUEUE-A3 的"恰一次"在这一种情形下由三层独立防线共同兜底
      // (DONE 早退 → generationIds 早退 → commit-tx CAS),不是单一一条守卫的功劳——
      // 三层里关掉任何一层,另外两层依然把钱路焊死;只有三层同时失守,才会退化成"虽然没有
      // 双花,但白白多打一次已经付费的供应商查询"(仍然安全,只是不再"零多余调用")。
      // 改完之后已经改回原样(两处 `if (false && ...)` 都还原成 `if (...)`),工作树复原。
    },
    DB_CASE_TIMEOUT_MS,
  );
});

describe("QUEUE-A4 — 视频提交后进程崩溃重启：在飞任务被接回轮询，最终 settle 或 refund 恰一次", () => {
  it(
    "QUEUE-A4: 提交刚被供应商接受、落标记那句条件写正要执行那一刻，另一趟并发投递已经抢先判 stale 并退了款——`persistVideoProviderTaskWithRetry` 自己的 CAS 必须干净放弃，绝不覆盖已发生的退款，也绝不二次退款",
    async () => {
      // 这条打的是 gen.ts 里 `persistVideoProviderTaskWithRetry` 自己的 CAS(`where: {...,
      // status: "GENERATING"}`,line ~1567)——落在 submitVideo 成功**之后**、这次投递写下
      // 「已提交」标记**之前**的那扇窗口。真实世界里能撞进这扇窗口的是:认领超时判 stale 的
      // 清道夫,或者同一条消息的另一次重复投递,在这个当口抢先把行判 FAILED 并退了款。用真实
      // 的行为(而不是伪造读)复现它:把这次"退款"作为 `submitVideo` 调用本身的副作用——
      // handleGen 已经真实认领了这一行(QUEUED→GENERATING,真实 Postgres 条件写)之后才调用
      // `submitVideo`,所以在它返回 providerTaskId 之前,这一行在真实 DB 里被另一次操作抢先
      // 改写,与生产环境的时序完全一致。
      const org = await seedOrg("QUEUE-A4 persist-marker CAS loses the race");
      const id = `gen_a4_${randomUUID()}`;
      await seedVideoJob(org, id);

      m.submitVideo.mockImplementationOnce(async () => {
        await prisma.genJob.updateMany({
          where: { id, ownerId: org.orgId, status: "GENERATING" },
          data: { status: "FAILED", error: "stale, refunded by a concurrent sweep", finishedAt: new Date() },
        });
        await prisma.$transaction((tx) => refundReservation(tx, { orgId: org.orgId, refId: id }));
        return { providerTaskId: "task-a4-orphan" }; // 供应商那一侧这个任务真的被接受了——这一单已经真花了一次引擎成本
      });

      const outcome = await handleGen({ genJobId: id }, 0);

      // 干净放弃:不是「投递失败」,是「这一单已经不该由我来管了」——所以 handleGen 正常
      // resolve(undefined),不是 reject。`persistVideoProviderTaskWithRetry` 的 CAS 匹配 0 行
      // ⇒ 抛 REDELIVERY_DISCARD ⇒ 这次投递直接放弃,不覆盖别家已经写好的 FAILED,不二次退款。
      expect(outcome).toBeUndefined();
      const row = await jobRow(org, id);
      expect(row.status).toBe("FAILED"); // 别家写的 FAILED 原样留着
      expect(row.generationIds).toEqual([]);
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "REFUND"]); // 恰一次退款

      // 同一条消息晚到重投:这一行现在已经是 FAILED,`genJobEndedWithoutDelivering` 在最顶上
      // 就早退——不会二次退款,也不会重新提交、重新花一次供应商的钱。
      vi.clearAllMocks();
      const redelivery = await handleGen({ genJobId: id }, 0);
      expect(redelivery).toBeUndefined();
      expect(m.submitVideo).not.toHaveBeenCalled();
      expect(m.pollVideo).not.toHaveBeenCalled();
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "REFUND"]); // 还是恰一次
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "QUEUE-A4: 已经提交、查到 succeeded 正要落库入账那一刻，另一趟投递抢先判 stale 并退了款——commit 事务的条件写必须整体回滚新产出，绝不双开第二笔账、绝不误发免费交付",
    async () => {
      // 这条打的是 gen.ts 里 commit 事务自己的 CAS(`tx.genJob.updateMany({where:{...,
      // status:"GENERATING"}})`,line ~2439-2443)——与上一条用例打的是同一族守卫在
      // **另一个时间点**的同一份纪律:提交阶段(persistVideoProviderTaskWithRetry)与
      // 出片入账阶段(commit tx)各自独立持有一次 CAS,两处都要在真实 DB 上验过,一处都不能少。
      // 竞态窗口这次挪到「这次投递已经读到 GENERATING 那一行、正在拿着 succeeded 的产出准备写
      // commit 事务」与「commit 事务真正执行那一刻」之间——用 `pollVideo` 调用的副作用真实
      // 复现:handleGen 已经读完 GENERATING 那一行、正要发起这次投递自己的 pollVideo 请求时,
      // 真的把库里的这一行改成 FAILED+已退款,commit 事务此时在真实 DB 里读到的就是"这一行
      // 已经不是 GENERATING 了"。
      const org = await seedOrg("QUEUE-A4 commit-tx CAS loses the race");
      const id = `gen_a4b_${randomUUID()}`;
      await seedVideoJob(org, id);

      // 先让这一单正常走到「已提交、标记已落库」的状态(GENERATING + videoOptions.providerTask)。
      m.submitVideo.mockResolvedValueOnce({ providerTaskId: "task-a4b" });
      await handleGen({ genJobId: id }, 0);
      expect((await jobRow(org, id)).status).toBe("GENERATING");
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE"]);

      // 下一次投递:pollVideo 一被调用，就(模拟另一趟并发投递抢先赢了)把这一行判 stale、FAILED
      // 并退款——然后才告诉这次投递「succeeded」。这正是 commit 事务的 CAS 存在的理由要防的
      // 那扇窗口。
      m.pollVideo.mockImplementationOnce(async () => {
        await prisma.genJob.updateMany({
          where: { id, ownerId: org.orgId, status: "GENERATING" },
          data: { status: "FAILED", error: "stale, refunded by a concurrent sweep", finishedAt: new Date() },
        });
        await prisma.$transaction((tx) => refundReservation(tx, { orgId: org.orgId, refId: id }));
        return { status: "succeeded", video: { bytes: new Uint8Array([9]), ext: "mp4" } };
      });

      const outcome = await handleGen({ genJobId: id }, 0);

      // 干净放弃:不是「投递失败」,是「这一单已经不该由我来管了」——所以 handleGen 正常
      // resolve(undefined),不是 reject。commit 事务自己的 CAS 匹配 0 行 ⇒ 抛
      // REDELIVERY_DISCARD ⇒ 整个事务(包括这次投递本想写的 Asset/Generation 行)整体回滚。
      expect(outcome).toBeUndefined();
      const row = await jobRow(org, id);
      expect(row.status).toBe("FAILED"); // 别家写的 FAILED 原样留着,没被这次投递覆盖回 DONE
      expect(row.generationIds).toEqual([]); // commit 事务整体回滚,没有留下孤儿 Asset/Generation
      expect(await ledgerKinds(org.orgId, id)).toEqual(["RESERVE", "REFUND"]); // 恰一次退款,不是两次,也没有多出一笔 SETTLE
    },
    DB_CASE_TIMEOUT_MS,
  );
});
