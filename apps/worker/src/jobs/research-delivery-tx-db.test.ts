/**
 * research-delivery-tx-db.test.ts —— 钱路 M1-b ② 在**真库**上证。
 *
 * 被证的事实(审计 P1):research 先收钱、后交货,而两件事此前在**两笔独立事务**里 ——
 * 结算先提交,报告的写在它后面单独跑,而且被 try/catch 吞掉。中间任何一次失败(写库报错、
 * 约束冲突、进程被 SIGKILL)的结果都是**钱收了、货没了**,并且没有任何东西会回头补它。
 *
 * 这里用的是真 `withLlmBudget`(真 reserve / 真 settle / 真 refund、真账本行),只把跑模型
 * 的 `run` 换成夹具 —— 钱路的每一笔都是真库行为,不是 mock 里的约定。
 *
 * 四条:
 *   ① 顺利时:报告 + 卡片 + 作业终态 + SETTLE **同一笔提交**都在。
 *   ② 交付写炸掉(#1001 判官场景 D 手法:在事务中途插入一次真实失败):整笔回滚 ——
 *      **没有 SETTLE**、预扣被全额退回、报告不存在、余额一分不少。
 *   ③ 迟到的交付撞上已经被 reaper 判死的作业:同样整笔回滚,绝不对着一笔已经退掉的预扣交货。
 *   ④ 双租户:一次 research 的结算/退款只动它自己那个组织的钱。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@fikirtive/otto", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, run: m.run };
});

import { prisma, refundReservation } from "@fikirtive/db";
import { handleResearch } from "./research.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const START = 1_000_000;
/** 一个 NUL 字节。写成 fromCharCode 而不是转义,免得它以裸字节的形式躺在源码里。 */
const NUL = String.fromCharCode(0);

let orgId: string;
let projectId: string;
let threadId: string;
let cardId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  threadId = `thr_${randomUUID()}`;
  cardId = `msg_${randomUUID()}`;
  jobId = `rj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "P" } });
  await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId } });
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId,
      ownerId: orgId,
      role: "AGENT",
      kind: "RESEARCH_CARD",
      seq: 1,
      payload: { researchId: "r1", topic: "EV market", tier: "quick", status: "running" },
    },
  });
  await prisma.researchJob.create({
    data: { id: jobId, ownerId: orgId, threadId, cardId, idempotencyKey: `research:${cardId}`, tier: "quick", status: "QUEUED" },
  });
  // 夹具的默认行为:模型跑完了,产出一段报告。
  m.run.mockResolvedValue({
    finalOutput: "# Report\nFindings…",
    newItems: [],
    state: { usage: { inputTokens: 1000, outputTokens: 500 } },
  });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId, refId: `research:${cardId}` },
    select: { kind: true },
    orderBy: { createdAt: "asc" },
  });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), balance: account.balance, reserved: account.reserved };
}

async function reportRows() {
  return prisma.chatMessage.findMany({ where: { ownerId: orgId, kind: "RESEARCH_REPORT" }, select: { id: true } });
}

async function jobRow() {
  return prisma.researchJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId }, select: { status: true } });
}

async function cardStatus() {
  const row = await prisma.chatMessage.findFirstOrThrow({ where: { id: cardId, ownerId: orgId }, select: { payload: true } });
  return (row.payload as { status?: string } | null)?.status;
}

describe("钱路 M1-b ②:research 的交付与结算同一笔提交", () => {
  it("顺利时:报告、卡片、作业 DONE 与 SETTLE 一起落库", async () => {
    await handleResearch({ jobId }, 0);

    expect((await jobRow()).status).toBe("DONE");
    expect(await cardStatus()).toBe("done");
    expect(await reportRows()).toHaveLength(1);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
    expect(money.reserved).toBe(0);
    expect(money.balance).toBeLessThan(START); // 真的收了钱
  }, DB_CASE_TIMEOUT_MS);

  it("交付写炸在事务中途:整笔回滚 —— 没有 SETTLE、全额退款、报告不存在", async () => {
    // #1001 判官场景 D 的手法:在**真实执行的那一刻**插入一次真实失败,而不是断言一个 mock
    // 被怎样调用。
    //
    // 这里用的失败是真的、也是这条产品线真会遇到的一种:模型的输出里带了一个 NUL 字节。
    // Postgres 的 jsonb 装不下它,于是报告那一笔写在**事务中途**抛错 —— 不需要 mock 任何
    // prisma 方法,失败就发生在真正写库的那一刻。修复前这一笔正是被 try/catch 吞掉的那一笔:
    // 钱照收、卡片写「完成」、报告从来没有存在过。
    m.run.mockResolvedValue({
      finalOutput: `# Report\nFindings…${NUL}tail`,
      newItems: [],
      state: { usage: { inputTokens: 1000, outputTokens: 500 } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handleResearch({ jobId }, 0);
    } finally {
      warn.mockRestore();
    }

    const money = await moneyTrail();
    expect(money.kinds, "钱收了(SETTLE 落库)但货没了 —— 这正是这张票要消灭的形状").toEqual(["RESERVE", "REFUND"]);
    expect(money.balance, "交付失败了却还是扣了商家的钱").toBe(START);
    expect(money.reserved).toBe(0);
    expect(await reportRows(), "报告不该存在").toHaveLength(0);
    expect((await jobRow()).status).toBe("FAILED");
    expect(await cardStatus()).toBe("failed");
  }, DB_CASE_TIMEOUT_MS);

  it("迟到的交付撞上已被判死的作业:回滚 + 全额退款,绝不对着退掉的预扣交货", async () => {
    // reaper 在这次跑的中途把作业判成 FAILED(worker 崩过、卡片已经告诉商家「中断了」)。
    // 交付的第一笔就是终态 CAS:它匹配不到 RUNNING,于是整笔回滚。
    m.run.mockImplementation(async () => {
      await prisma.researchJob.updateMany({
        where: { id: jobId, ownerId: orgId },
        data: { status: "FAILED", error: "research was interrupted — please try again" },
      });
      return { finalOutput: "# Report", newItems: [], state: { usage: { inputTokens: 1000, outputTokens: 500 } } };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handleResearch({ jobId }, 0);
    } finally {
      warn.mockRestore();
    }

    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    expect(await reportRows()).toHaveLength(0);
    // 赢家(reaper)写给商家看的那句话不许被一句内部错误盖掉。
    const job = await prisma.researchJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId }, select: { status: true, error: true } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toBe("research was interrupted — please try again");
  }, DB_CASE_TIMEOUT_MS);

  // ── #1046-P1:退款已经赢了 finalizer,但作业行还没被改动 ────────────────────────────
  //
  // 上一条靠的是终态 CAS(作业已经不是 RUNNING)。这一条打的是它够不到的那个窗口:
  // 预扣清道夫按 60 分钟阈值退了 `research:<cardId>` 的款,而 research-status 清道夫还没跑到
  // 这一行 —— 作业**仍然是 RUNNING**。此刻模型返回结果:`settleCredits` 撞上 finalizer 唯一
  // 约束,createMany 计数 0,函数返回 void 一如成功;CAS 匹配到 RUNNING,于是交付照写。
  // 结果是商家白拿一份报告,权威账本记着 REFUND。守卫 = 交付前直接读一次终态。
  it("#1046-P1 退款已在但作业仍 RUNNING:迟到的结算不许交货(直接读终态,不信 settle 的空操作)", async () => {
    m.run.mockImplementation(async () => {
      // 清道夫退款:预扣被释放,作业行一个字都没动。
      await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId: `research:${cardId}` }));
      return { finalOutput: "# Report", newItems: [], state: { usage: { inputTokens: 1000, outputTokens: 500 } } };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handleResearch({ jobId }, 0);
    } finally {
      warn.mockRestore();
    }

    const money = await moneyTrail();
    // 只有一条 finalizer,而且是 REFUND —— 没有第二笔钱动过。
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance, "退过款之后又收了一次钱").toBe(START);
    expect(money.reserved).toBe(0);
    expect(await reportRows(), "对着一笔已经退掉的预扣交了货").toHaveLength(0);
    expect((await jobRow()).status).toBe("FAILED");
  }, DB_CASE_TIMEOUT_MS);

  it("双租户:一次 research 的结算/退款只动它自己那个组织的钱", async () => {
    const otherOrgId = `org_${randomUUID()}`;
    await prisma.organization.create({ data: { id: otherOrgId } });
    await prisma.creditAccount.create({ data: { orgId: otherOrgId, balance: START, reserved: 0 } });

    await handleResearch({ jobId }, 0);

    const other = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: otherOrgId } });
    expect(other.balance).toBe(START);
    expect(other.reserved).toBe(0);
    expect(await prisma.creditLedger.findMany({ where: { orgId: otherOrgId } })).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);
});
