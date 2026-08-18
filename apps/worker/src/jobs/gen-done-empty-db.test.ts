/**
 * gen-done-empty-db.test.ts —— #782 r13(判官 r12 P1-F1)在**真库**上证。
 *
 * 判词说的是「付费 DONE 但 generationIds 为空」这一行不该存在,而它的两半只有真库能证:
 *
 *   ① **写入点**:一趟没有产出的生成绝不许写成 DONE。这里跑真的 `handleGen`、真的 Postgres、
 *      真的 `reserveCredits/settleCredits/refundReservation`(只 mock 掉付费引擎与对象存储),
 *      断言那一行落在 FAILED 上,而钱**回到了商家账上**——不是 SETTLE。
 *      红的形状是真的:`count: 0` 的作业行(2026-06-13 的提交标记与 2026-07-15 的产出数校验
 *      #325 之间那一个月,引擎什么都没返回时就写出这个形状)在 r12 的实现上会得到
 *      DONE + generationIds=[] + SETTLE。
 *
 *   ② **存量自愈**:巡检把这样一行翻成 FAILED + 退款,而且 **exactly-once** —— 同一行被两个
 *      巡检同时扫到只退一笔;已经结算过的那一行一个字都不动(否则 FAILED 会在每个商家界面上
 *      许下一句「你没有被扣钱」的假话);而一个刚刚被商家取消的形状同样不许被它改写。
 *      这几条只有把 `CreditLedger` 的唯一索引真的压上去才叫证明,mock 出来的
 *      `refundReservation` 证明不了任何 exactly-once。
 *
 * 超时给足 60s:每条用例都要建租户、真预扣、跑完整条 handleGen(含画布结算的顾问锁),
 * 在跑满的机器上会远超 vitest 默认的 5s(同 gen-receipt-db.test.ts 的理由)。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

// 只 mock 两件事:付费引擎(绝不真调用)和对象存储。库、钱、事务全是真的。
const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
  // 整顿 C1a:报警管道注入成假 transport —— 用例断言的是「这类事件必然产生一次带上下文的
  // 上报」,不是 Sentry/Resend/Telegram 本身,所以这里一个真实外呼都不发。
  founderAlert: vi.fn(),
  captureMoneyPathError: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));
vi.mock("../alerting.js", () => ({ founderAlert: m.founderAlert, captureMoneyPathError: m.captureMoneyPathError }));

import { prisma, reserveCredits, settleCredits, refundReservation } from "@fikirtive/db";
import { handleGen, reapStaleGenJobs, GEN_DONE_EMPTY_GRACE_MS } from "./gen.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000; // 这一单预扣的内部信用点;金额不重要,**动了几次**才重要
const START = 100_000;

let orgId: string;
let projectId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 先把连接池和 query engine 的冷启动付掉
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  m.founderAlert.mockResolvedValue([]);
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  jobId = `gen_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Shot continuation" } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 这一趟巡检为**这一条**作业行发出的报警。同上:全局次数会被同库里别的行污染。 */
function alertsFor(refId: string): { key: string; context: Record<string, unknown> }[] {
  return callsFor(refId).map((call) => call[0]);
}

/** 同上,但取第二个参数(派发选项),用来分辨首发与重复。 */
function optsFor(refId: string): { repeat?: boolean }[] {
  return callsFor(refId).map((call) => call[1] ?? {});
}

function callsFor(refId: string): [{ key: string; context: Record<string, unknown> }, { repeat?: boolean } | undefined][] {
  return m.founderAlert.mock.calls
    .map((call) => call as unknown as [{ key: string; context: Record<string, unknown> }, { repeat?: boolean } | undefined])
    .filter(([alert]) => alert?.context?.genJobId === refId);
}

/** 这一单在钱上留下的全部痕迹 —— 张数与余额,不是文字。 */
async function moneyTrail(refId = jobId) {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId }, select: { kind: true, reason: true }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), reasons: ledger.map((r) => r.reason), balance: account.balance, reserved: account.reserved };
}

async function jobRow(id = jobId) {
  return prisma.genJob.findFirstOrThrow({ where: { id, ownerId: orgId }, select: { status: true, generationIds: true, error: true, spent: true } });
}

// ---------------------------------------------------------------------------
// ① 写入点:零产出永不写 DONE
// ---------------------------------------------------------------------------

describe("#782 r13 写入点不变量 —— DONE ⇒ generationIds 非空", () => {
  it("引擎什么都没返回(count=0 的那一行)→ FAILED + 退款,绝不 DONE", async () => {
    // `count: 0` 是 r12 之前真能落库的形状:产出数校验(#325)问的是「几张 ≠ 几张」,
    // 0 === 0 于是放行 —— 空的 stored、空的 ids、提交标记照写、settle 照结,DONE 落在
    // 一行指不出任何东西的作业上。r13 的零产出闸在存任何东西之前就把它挡下来。
    await prisma.genJob.create({
      data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster", kind: "IMAGE", model: "seedream", count: 0, status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    m.generateImages.mockResolvedValue([]); // 引擎回了,什么都没给

    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const job = await jobRow();
    expect(job.status, "一趟什么都没交出来的生成被写成了 DONE").toBe("FAILED");
    expect(job.generationIds).toEqual([]);
    const money = await moneyTrail();
    expect(money.kinds, "钱被结算了 —— 商家为空气付了账").toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START); // 一分不少地回来了
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("正常一路照旧:有产出 → DONE + 结算,而且 generationIds 真的指得出东西", async () => {
    // 反向锚:上面那道闸不许顺手拦下任何一趟真的做出了东西的生成。
    await prisma.genJob.create({
      data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster", kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("DONE");
    expect(job.generationIds).toHaveLength(1);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// ② 存量自愈:翻转 + 退款的 exactly-once
// ---------------------------------------------------------------------------

/**
 * 造一行「不该存在」的历史数据:DONE、零产出、宽限期之外。`settled` 决定它的钱走到哪一步。
 *
 * `settledInternal` 给一次**部分结算**(实扣 A < 预扣 B)。它存在的唯一理由是让报警里那个
 * 金额有分辨力:A === B 时,「从 SETTLE 行读回实扣」与「读 RESERVE 行的预扣额」这两种写法
 * 得到同一个数字,断言分不出对错(判官的变异④正是靠这一点活下来的)。
 */
async function seedDoneEmpty(opts: { settled: boolean; refunded?: boolean; settledInternal?: number }) {
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
      status: "DONE", generationIds: [], spent: true, progress: 100,
      startedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
      finishedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
  if (opts.settled) await prisma.$transaction((tx) => settleCredits(tx, { orgId, refId: jobId, actualInternal: opts.settledInternal }));
  if (opts.refunded) await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId: jobId }));
}

// 断言一律钉在**这一条**作业行与**这一个**租户的账上,不看 sweep 的返回计数:扫描是跨租户的,
// 而这个库同时住着同一份测试跑出来的别的行,拿一个全局计数当断言就是把用例交给运行次序。
describe("#782 r13 存量自愈 —— 翻转 FAILED + 退款,exactly-once", () => {
  it("预扣还挂着的那一行 → FAILED + 一笔退款,钱回到商家账上", async () => {
    await seedDoneEmpty({ settled: false });

    await reapStaleGenJobs();

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.reasons).toContain("gen:done-without-output"); // 这一笔退款签了自己的名字
    expect(money.balance).toBe(START);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("两个巡检同时扫到同一行 → 只翻一次、只退一笔(exactly-once 由唯一索引兜底)", async () => {
    await seedDoneEmpty({ settled: false });

    // 真并发:两次 sweep 同时跑,ledger 的 finalizer 唯一索引是唯一的仲裁者。
    await Promise.all([reapStaleGenJobs(), reapStaleGenJobs()]);

    expect((await jobRow()).status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds, "退了两笔 —— 商家凭空多出一份钱").toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    // 终态消息同样只许有一条(genJobId 上的单条终态消息唯一索引)。
    const msgs = await prisma.chatMessage.count({ where: { genJobId: jobId, ownerId: orgId } });
    expect(msgs).toBeLessThanOrEqual(1);
  }, DB_CASE_TIMEOUT_MS);

  it("已经结算过的那一行 → 一个字都不动(FAILED 会在每个界面上许下一句关于钱的假话)", async () => {
    await seedDoneEmpty({ settled: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await reapStaleGenJobs();
      const job = await jobRow();
      expect(job.status, "把一行真的收过钱的作业翻成了「你没有被扣钱」").toBe("DONE");
      const money = await moneyTrail();
      expect(money.kinds, "在一笔已结算的预扣上又开了一张退款").toEqual(["RESERVE", "SETTLE"]);
      expect(money.balance).toBe(START - HOLD); // 那笔钱确实还在平台这边
      expect(spy.mock.calls.flat().join(" ")).toContain("paid for nothing"); // 交给人看

      // 整顿 C1a —— 「交给人看」到今天为止只是一行日志,而生产日志没有人二十四小时盯着。
      // 这一条断言的是**报警真的发出去过一次**,并且带着足以定位这一单的上下文:哪个商家、
      // 哪一单、扣了多少钱。少任何一样,收到报警的人都还得先去翻库才知道在说谁。
      // 按作业行过滤,理由与上面那条注释一样:扫描是跨租户的,同一个库里还住着别的用例
      // 留下来的行,拿全局次数当断言就是把用例交给运行次序。
      expect(alertsFor(jobId), "这个商家付了钱什么都没拿到,而没有任何人被通知").toHaveLength(1);
      expect(alertsFor(jobId)[0]).toEqual(
        expect.objectContaining({
          key: "gen.paid_for_nothing",
          context: expect.objectContaining({ genJobId: jobId, orgId, chargedCredits: HOLD / 10 }),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("退得掉的那几行不报警 —— 报警只留给真的需要人来裁决的那一种", async () => {
    // 反向钉板:没有这一条,上面那个断言只证明「报警器会响」,不证明「它只在该响的时候响」。
    // 一个逢扫必响的报警器,和一个不响的报警器,一周之内会退化成同一个东西。
    await seedDoneEmpty({ settled: false });
    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("FAILED");
    expect(alertsFor(jobId), "一行自己就退得掉的作业,不该惊动 founder").toEqual([]);
  }, DB_CASE_TIMEOUT_MS);

  it("报警里的金额是**实扣**,不是预扣 —— 部分结算下两者不同,写错就看得见", async () => {
    // 判官变异④:把「从 SETTLE 行读回实扣」改成「读 RESERVE 行的预扣额」。在 A === B 的
    // fixture 上两种写法得到同一个数字,变异因此存活。这里造一次真的部分结算(实扣 600 <
    // 预扣 1000),两个数字分开,断言才真的在验它。
    //
    // 为什么这件事要紧:这个数字是给人拿去跟账本对的。报一个「商家被扣了 100」而账上只有
    // 60,收到报警的人会照着多退 40 —— 报警本身成了第二次钱错。
    const ACTUAL = 600;
    await seedDoneEmpty({ settled: true, settledInternal: ACTUAL });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await reapStaleGenJobs();
      expect(alertsFor(jobId)).toHaveLength(1);
      const context = alertsFor(jobId)[0]!.context;
      expect(context.chargedCredits, "报的是预扣额,不是这个商家真被扣掉的钱").toBe(ACTUAL / 10);
      expect(context.chargedCredits).not.toBe(HOLD / 10);
      // 账本自己也这么说:未花掉的部分退回,余额只少了实扣那一份。
      expect((await moneyTrail()).balance).toBe(START - ACTUAL);
    } finally {
      spy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("同一行第二趟巡检只进 Sentry —— 一行卡住不许变成每天 288 封邮件", async () => {
    // 那一行是**故意不清理**的,而巡检每 5 分钟一趟。没有一次性标记,同一行会被永远重复报警;
    // 而邮件那把 RESEND_API_KEY 与商家登录的魔法链接是同一把:一条报警足以把登录打挂。
    await seedDoneEmpty({ settled: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await reapStaleGenJobs();
      await reapStaleGenJobs();

      const alerts = alertsFor(jobId);
      expect(alerts, "两趟巡检 = 两条报警事件(Sentry 要照常计数)").toHaveLength(2);
      // 第一趟:完整三通道。第二趟:repeat,只走 Sentry。
      expect(optsFor(jobId)[0]?.repeat ?? false, "首发不该被当成重复").toBe(false);
      expect(optsFor(jobId)[1]?.repeat, "第二趟仍在发邮件和 Telegram").toBe(true);
      expect(alerts[1]!.context.repeatOfEarlierAlert).toBe(true);
      // 标记落在 ActionEvent 的主键上,所以它是 exactly-once 的,不是 check-then-act。
      const markers = await prisma.actionEvent.count({ where: { id: `gen_paid_for_nothing:${jobId}` } });
      expect(markers).toBe(1);
    } finally {
      spy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("两个巡检同时扫到同一行 → 只有一个拿到首发权(唯一约束裁决,不是 check-then-act)", async () => {
    await seedDoneEmpty({ settled: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await Promise.all([reapStaleGenJobs(), reapStaleGenJobs()]);
      const firsts = optsFor(jobId).filter((o) => !o.repeat);
      expect(firsts, "并发下发了两次完整报警(两封邮件、两条 Telegram)").toHaveLength(1);
      expect(await prisma.actionEvent.count({ where: { id: `gen_paid_for_nothing:${jobId}` } })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("标记写不进去(非 P2002 的库故障)⇒ 仍按首发处理 —— 节流闸是 fail-OPEN,不许把求救静音", async () => {
    // 这条钉的是整个节流设计里最要紧、也最容易被写反的一个方向。
    //
    // 节流闸是「拿不到首发权就降级成只进 Sentry」。它的 catch-all 如果写成 return false
    // (fail-CLOSED),那么一次外键错、一次连接池打满、一次磁盘满 —— 任何与「已经报过」
    // 毫无关系的库故障 —— 都会让这条求救**永久**降级:邮件和 Telegram 从此不再发,
    // 而没有任何人知道降级发生过。为了不吵而把「商家付了钱什么都没拿到」静音,
    // 正好是这张票要消灭的那件事,只不过换成由我们自己动手。
    //
    // 所以只有**确凿的主键冲突(P2002 = 这一行确实已经报过)**才算重复;其它一切
    // 算首发。宁可多发一条,也不让一次 DB 抖动把它关掉。
    await seedDoneEmpty({ settled: true });
    const markerId = `gen_paid_for_nothing:${jobId}`;
    const realCreate = prisma.actionEvent.create.bind(prisma.actionEvent);
    // 只对**这一行**的标记注入故障:巡检是跨租户的,同库里还住着别的用例留下的行,
    // 一个无差别的 mock 会顺手改掉它们的行为。
    const createSpy = vi.spyOn(prisma.actionEvent, "create").mockImplementation((async (args: { data?: { id?: string } }) => {
      if (args?.data?.id === markerId) throw Object.assign(new Error("FK violated"), { code: "P2003" });
      return realCreate(args as never);
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await reapStaleGenJobs();

      expect(alertsFor(jobId), "库故障把这一行的报警整条吞掉了").toHaveLength(1);
      expect(optsFor(jobId)[0]?.repeat ?? false, "一次非 P2002 的库故障被当成了「已经报过」").toBe(false);
      expect(alertsFor(jobId)[0]!.context.repeatOfEarlierAlert).toBe(false);
      // 标记确实没落库 —— 证明走的就是故障那一路,不是悄悄写成功了。
      expect(await prisma.actionEvent.count({ where: { id: markerId } })).toBe(0);

      // 而且它**持续**按首发处理:标记一天写不进去,这句求救就一天不许被降级。
      await reapStaleGenJobs();
      expect(optsFor(jobId).map((o) => o.repeat ?? false)).toEqual([false, false]);
    } finally {
      createSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("别人已经退过的那一行 → 翻成 FAILED,但不吞别家的退款(不多开第二张)", async () => {
    await seedDoneEmpty({ settled: false, refunded: true });

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.reasons, "把别家写的那笔退款算成了自己的").not.toContain("gen:done-without-output");
    expect(money.balance).toBe(START);
  }, DB_CASE_TIMEOUT_MS);

  it("宽限期之内的那一行 → 不碰(巡检不该是第一个注意到一行的人)", async () => {
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "DONE", generationIds: [], spent: true, progress: 100, startedAt: new Date(), finishedAt: new Date(),
      },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("DONE");
    expect((await moneyTrail()).kinds).toEqual(["RESERVE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("商家自己取消掉的那一行 → 巡检认不出它、也改不动它(CANCELLED 不是 DONE)", async () => {
    // 取消与自愈是两条同时在跑的路。取消写 CANCELLED + 退款;巡检的扫描与条件写都只认 DONE,
    // 所以它连这一行都选不到 —— 商家关于自己那次决定的真相不会被改写成别的词。
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "CANCELLED", generationIds: [], progress: 0,
        startedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
        finishedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
      },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId: jobId }));

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("CANCELLED");
    expect((await moneyTrail()).kinds).toEqual(["RESERVE", "REFUND"]);
  }, DB_CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// ③ #782 r17(判官 r16 P1-2)—— 已经结算的作业不许被暂写成 FAILED
// ---------------------------------------------------------------------------
//
// 判官钉出的五步时序:
//   1. 原 worker 跑完提交事务 —— generationIds 落库、SETTLE 与它同一笔,钱已经收了;
//   2. 但 DONE 还没写(提交与 DONE 之间隔着末帧落库、回执、attach 三个 await),行仍是 GENERATING;
//   3. 一条**迟到的重投**进来。它在第 1 步之前就把行读进了内存,所以它手上的快照
//      generationIds 还是空的 —— resume 那条路认不出这是一条已经交付的作业,于是它一路走到
//      前置闸(项目没了 / 镜头没了);
//   4. failClosedWithRefund 只看状态,不看产出,更不看 refundReservation 到底做了什么:
//      它把行写成 **FAILED**,拿到 already-settled 也照样往下走,还发一句「你没有被扣钱」;
//   5. 原 worker 随后无条件写回 DONE。
//
// 窗内那一段 FAILED 是**真的**:分镜的编辑闸读到 FAILED 就当这条作业死了(预扣已退、什么都
// 没交付),于是放行删指针;而第 5 步的 DONE 不取卡锁,r15 的串行化管不到它。除此之外,窗内
// 每一个界面都在对一个**钱已经收了**的商家说「你没有被扣钱」。
//
// 修法与 r13 第 4 扫逐字同形:翻转以 RefundOutcome 为条件。已结算 → 回滚翻转 + 大声报错;
// refunded / already-refunded / no-reservation → 照翻。
describe("#782 r17 已结算的作业:迟到的重投不许把它暂写成 FAILED", () => {
  // 这一组要断言「那句话发没发」,所以必须有一条真的会话 —— 没有 threadId 的作业
  // appendCoworkResult 直接返回,断言就成了空转。
  let threadId: string;

  /** 在前置闸问「项目还在吗」的**那一刻**插一段剧情,然后回「不在」。
   *  Prisma 的委托返回的是自带 `.organization` 等属性的 thenable,替身只给 Promise 就够用,
   *  所以这里把实现按调用签名收窄一次(唯一的 cast,收在这一个 helper 里)。 */
  function stubProjectGoneOnce(before?: () => Promise<void>) {
    return vi.spyOn(prisma.project, "findFirst").mockImplementationOnce((async () => {
      if (before) await before();
      return null;
    }) as unknown as typeof prisma.project.findFirst);
  }

  beforeEach(async () => {
    threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "Shot continuation" } });
  }, DB_CASE_TIMEOUT_MS);

  /**
   * 第 1–3 步,逐拍照做。行以「重投手上那份快照」的样子起步(GENERATING、零产出),
   * 而**原 worker 的提交事务**恰好落在重投读完行、还没走到前置闸的那一瞬 —— 用项目查询
   * 这个前置闸自己的时刻把它插进去,时序因此是确定的,不靠赛跑。
   */
  async function seedLateRedeliveryOntoCommit(opts: { settle: boolean }) {
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, threadId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "GENERATING", generationIds: [], progress: 90, startedAt: new Date(),
      },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    // ← 第 1–2 步就发生在前置闸那一刻:提交事务把产出与结算一起落库,DONE 还没写。
    return stubProjectGoneOnce(async () => {
      if (!opts.settle) return;
      await prisma.$transaction(async (tx) => {
        await tx.genJob.updateMany({ where: { id: jobId, ownerId: orgId }, data: { generationIds: ["gen_committed"], spent: true } });
        await settleCredits(tx, { orgId, refId: jobId });
      });
    });
  }

  it("提交事务已落 + 结算已收 → 迟到的重投绝不许写 FAILED(编辑闸会把 FAILED 当死作业)", async () => {
    const spy = await seedLateRedeliveryOntoCommit({ settle: true });
    try {
      await handleGen({ genJobId: jobId }, 0); // 第 3–4 步
    } finally {
      spy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status, "已结算的作业被暂写成 FAILED —— 分镜编辑闸会把它读成死作业并放行删指针").not.toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds, "钱被动了第二次").toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("那一刻不许对商家说「你没有被扣钱」—— 因为扣了", async () => {
    const spy = await seedLateRedeliveryOntoCommit({ settle: true });
    try {
      await handleGen({ genJobId: jobId }, 0);
    } finally {
      spy.mockRestore();
    }

    const lies = await prisma.chatMessage.findMany({
      where: { ownerId: orgId, genJobId: jobId, kind: "TURN_ERROR" },
      select: { text: true },
    });
    expect(lies, "对一个已经付过钱的商家说了「你没有被扣钱」").toEqual([]);
  }, DB_CASE_TIMEOUT_MS);

  it("反向锚:预扣还开着(钱真的退得掉)→ 前置闸照旧 FAILED + 退款 + 那句话,一格没松", async () => {
    const spy = await seedLateRedeliveryOntoCommit({ settle: false });
    try {
      await handleGen({ genJobId: jobId }, 0);
    } finally {
      spy.mockRestore();
    }

    expect((await jobRow()).status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    expect(money.reserved).toBe(0);
    const told = await prisma.chatMessage.count({ where: { ownerId: orgId, genJobId: jobId, kind: "TURN_ERROR" } });
    expect(told, "钱真的退了,那句「你没有被扣钱」就该照发").toBe(1);
  }, DB_CASE_TIMEOUT_MS);

  it("反向锚:从来没有预扣的历史行 → 照旧 FAILED(no-reservation 不是「已收钱」)", async () => {
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, threadId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "QUEUED", generationIds: [], progress: 0,
      },
    });
    const spy = stubProjectGoneOnce();
    try {
      await handleGen({ genJobId: jobId }, 0);
    } finally {
      spy.mockRestore();
    }

    expect((await jobRow()).status).toBe("FAILED");
    expect((await moneyTrail()).kinds).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);
});
