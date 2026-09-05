/**
 * gen-thread-redelivery-db —— 结果消息**真的写失败**之后，商家还能不能拿回那条结果。
 *
 * 规格 `docs/specs/creation-engine.md` 验收 **CREATE-A1**（画布路径的判定落在确认卡片上）；
 * 触发＝Founder 2026-09-04 20:45 裁决(编排者代记)：「画布上任何付费出图出片都写进这张
 * 画布的对话历史（请求、确认、结果），刷新与换浏览器都在。」
 *
 * 「请求＋确认」那两行由 `apps/web/lib/gen-actions.ts` 在钱事务里写(它自己的真库用例在
 * `apps/web/lib/__tests__/canvas-paid-into-history.test.ts`)。这一份钉的是**结果**那一行：
 * 它由 `appendCoworkResult` 写，而那个写是 best-effort —— 写不成就吞掉，从前后面什么都没有，
 * 于是作业已经 DONE、钱也已经结了，对话却永远停在「making this…」。
 *
 * 所以这里注入一次**真实的写失败**（临时给 `ChatMessage` 加一条 CHECK 约束，让结果消息被
 * 数据库真拒），再证补投扫描 `redeliverGenThreadResults` 把那条消息补了回来。用完在
 * finally 里删掉约束；加之前也先 DROP IF EXISTS —— 上一轮被超时打断留下的残留，不该让
 * 下一轮报一个与被测行为无关的错。只作用于本测试库，不碰迁移、不碰生产 schema。
 *
 * 变异证伪：把 reaper tick 里那次 `redeliverGenThreadResults()` 拿掉（或让扫描永远返回空）
 * ⇒ 第①条红。
 *
 * 钱一格不动：整份用例里没有 reserve / settle / refund，账本零新增行 —— 每条用例都断言它。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { displayCredits, pricedGenCredits } from "@fikirtive/core";
import { appendCoworkResult } from "./gen.js";
import { redeliverGenThreadResults, GEN_THREAD_REDELIVERY_GRACE_MS } from "./gen-thread-redelivery.js";

// 同其它 worker 真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
/** 结果消息上那个数 —— 与交付路同一份 `pricedGenCredits`,这里不写字面量。 */
const IMAGE_CREDITS = displayCredits(pricedGenCredits({
  kind: "IMAGE", model: "seedream", count: 1, referenceVideoGenerationId: null, videoOptions: null,
}));

let orgId: string;
let projectId: string;
let threadId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  threadId = `thr_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Thread redelivery" } });
  await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "Untitled", surface: "canvas" } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 一行已经终结的付费作业 —— 带着这块画布的线程标签,结束时间落在补投窗口里。 */
async function seedTerminalJob(over: {
  status: "DONE" | "FAILED" | "CANCELLED";
  generationIds?: string[];
  ageMs?: number;
}): Promise<string> {
  const jobId = `gen_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId,
      ownerId: orgId,
      projectId,
      threadId,
      prompt: "a cup steaming on a rattan mat",
      kind: "IMAGE",
      model: "seedream",
      count: 1,
      status: over.status,
      generationIds: over.generationIds ?? [],
      finishedAt: new Date(Date.now() - (over.ageMs ?? GEN_THREAD_REDELIVERY_GRACE_MS + 60_000)),
    },
  });
  return jobId;
}

async function threadMessages() {
  return prisma.chatMessage.findMany({ where: { ownerId: orgId, threadId }, orderBy: { seq: "asc" } });
}

/**
 * 与 worker 的 reaper tick 同一个外壳:跨租户扫描只在系统帧里成立(#463 两段式)。
 *
 * 返回值是**全库**这一轮补了几条(测试库里还有别的用例留下的行),所以每条用例的断言
 * 一律落在**这条线程自己的消息**上,不去数那个全局数字 —— 那才是商家看得见的东西。
 */
async function sweep(): Promise<number> {
  return runAsSystem("worker-reaper-tick", () => redeliverGenThreadResults());
}

async function ledgerRows() {
  return prisma.creditLedger.findMany({ where: { orgId } });
}

/** 让结果消息的写入被数据库**真的**拒绝(而不是靠 mock 假装拒绝)。 */
async function withResultWritesFailing(fn: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS k1_thread_result_fault`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ChatMessage" ADD CONSTRAINT k1_thread_result_fault CHECK ("kind" <> 'GEN_RESULT' AND "kind" <> 'TURN_ERROR') NOT VALID`,
  );
  try {
    await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS k1_thread_result_fault`);
  }
}

describe("CREATE-A1 —— 结果消息写失败之后的补投(真库,真失败)", () => {
  it("CREATE-A1: 交付路写结果失败 ⇒ 对话里什么都没有;补投扫描把那条结果补回来", async () => {
    const jobId = await seedTerminalJob({ status: "DONE", generationIds: [`gen_${randomUUID()}`] });
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId } });

    await withResultWritesFailing(async () => {
      // 交付路那一次:被数据库真拒,`appendCoworkResult` 照它的契约吞掉(不许抛进交付路)。
      await appendCoworkResult(job, "GEN_RESULT", job.generationIds, "", IMAGE_CREDITS);
      expect(await threadMessages()).toHaveLength(0);
    });

    // 补投:同一条消息,这一次写成了。
    expect(await sweep()).toBeGreaterThanOrEqual(1);
    const messages = await threadMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe("GEN_RESULT");
    expect(messages[0]!.genJobId).toBe(jobId);
    expect((messages[0]!.payload as Record<string, unknown>).costCredits).toBe(IMAGE_CREDITS);
    expect((messages[0]!.payload as Record<string, unknown>).generationIds).toEqual(job.generationIds);
    // 钱一格没动。
    expect(await ledgerRows()).toHaveLength(0);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A1: 补投是幂等的——已经有结果的作业不会被补第二条", async () => {
    const jobId = await seedTerminalJob({ status: "DONE", generationIds: [`gen_${randomUUID()}`] });
    await sweep();
    await sweep(); // 第二轮:这条线程上不会多出第二条
    const messages = await threadMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.genJobId).toBe(jobId);
    expect(await ledgerRows()).toHaveLength(0);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A1: 失败收场的作业补的是终局消息,商家不会永远看着「making this…」", async () => {
    await seedTerminalJob({ status: "FAILED" });
    expect(await sweep()).toBeGreaterThanOrEqual(1);
    const messages = await threadMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe("TURN_ERROR");
    expect(messages[0]!.text).toBe("I couldn't finish that one — and you weren't charged. Want to try again?");
    expect(await ledgerRows()).toHaveLength(0);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A1: 商家自己取消的那一条不补——不许把「我停的」改写成「我们没做成」", async () => {
    await seedTerminalJob({ status: "CANCELLED" });
    await sweep();
    expect(await threadMessages()).toHaveLength(0);
  }, DB_CASE_TIMEOUT_MS);

  it("CREATE-A1: 刚结束的作业先放着——它自己的交付路多半正在写那条消息", async () => {
    await seedTerminalJob({ status: "DONE", generationIds: [`gen_${randomUUID()}`], ageMs: 1_000 });
    await sweep();
    expect(await threadMessages()).toHaveLength(0);
  }, DB_CASE_TIMEOUT_MS);
});
