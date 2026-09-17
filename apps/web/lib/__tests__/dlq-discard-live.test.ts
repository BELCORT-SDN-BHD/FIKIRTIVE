/**
 * 丢弃一条死信 —— 真 Postgres、真 pg-boss、真权限闸（Founder 2026-09-15 裁决；验收表登记在
 * docs/specs/fail-closed-reliability.md §5，编号 DLQ-A1…A5）。
 *
 * 场地照抄 `dlq-watch-live.test.ts`：全程**没有 supervisor**，也就是「worker 死透了」那一刻的
 * 条件。被测物一个字都不 mock —— 动作、权限闸、pg-boss 状态迁移、探针全跑真的；只有「这次请求
 * 是谁发的」（session ＋ 邀请名单）与 `revalidatePath` 是假的，因为那两样非得有一次真 HTTP 请求
 * 才存在。
 *
 * 为什么探针必须在这里出现：丢弃这个动作的全部意义就是「看板上没了」和「探针不再数它」永远是
 * 同一句话。断言写在 `checkDeadLetters()` 上，而不是写在我自己的那条 SELECT 上 —— 否则测的是
 * 我自己跟自己一致。
 */
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTION_QUEUE,
  DEAD_LETTER_QUEUES,
  FOUNDER_OWNER_ID,
  GEN_QUEUE,
  PUBLISH_QUEUE,
  REFGEN_QUEUE,
  RENDER_QUEUE,
  RESEARCH_QUEUE,
  newId,
} from "@fikirtive/core";

const TAG = "dlq-discard";
/** 持有 `system.mutate`（ops 角色）。 */
const OPERATOR = `${TAG}-ops@fikirtive.test`;
/** 持有 `system.read`（viewer 看得见看板），**不**持有 `system.mutate` —— DLQ-A5 的主角。 */
const READER = `${TAG}-viewer@fikirtive.test`;
const ORG_ID = `${TAG}-org`;
/** 另一个 org，只为一条**预留还悬着**的生成单（判官 P2-3 的现场）。与 ORG_ID 分开，DLQ-A4 的
 *  「账本一行未变」断言因此不必跟着改。 */
const HELD_ORG_ID = `${TAG}-org-held`;

let sessionEmail: string | null = null;

vi.mock("@/lib/better-auth/compat", () => ({
  auth: async () => (sessionEmail ? { user: { email: sessionEmail, name: null, image: null, role: "viewer" } } : null),
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => ({
  allowed: async (email: string | null | undefined) => Boolean(email),
  isFounderAdmin: () => false,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
/**
 * 审计写失败、账本读失败都必须**有人看得见**（判官 P2-1／P2-2），而 `console.error` 不算
 * （`lib/actor-library-seed.ts` 的同款论证）。这里只把告警通道换成一个能问话的替身，Sentry 其余
 * 部分原样 —— 照 `admin-revoke-access-action.test.ts` 的既有做法。
 */
const captureMessage = vi.fn();
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureMessage,
}));

const { prisma } = await import("@fikirtive/db");
const { runAsStaff } = await import("@fikirtive/db/principal");
const { staffPrincipal } = await import("@/lib/auth-guard");
const { discardDeadLetter } = await import("@/lib/dlq-actions");
const { listDeadLetters, DLQ_DISCARD_EVENT } = await import("@/lib/dead-letters-admin");
const { checkDeadLetters } = await import("@/lib/dlq-watch");
const { getBoss } = await import("@/lib/queue");

const QUEUES = [...DEAD_LETTER_QUEUES];
const DATABASE_URL = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

/**
 * 收尾必须删掉的六条**父队列** —— 这条清理不是洁癖，是一个踩过的坑。
 *
 * 被测动作走 `getBoss()`（web 侧那只真句柄），而 `getBoss()` 一开机就把这六条父队列连同它们的
 * `deadLetter` 策略建出来（`apps/web/lib/queue.ts`）。父队列一存在，`<name>.dlq` 就被它引用上了，
 * 而 pg-boss 12.18.2 的 `deleteQueue` 把删不掉这件事**整个吞掉**（dist/manager.js:709 的
 * `catch { }`，实测：删完 `pgboss.queue` 里 `research.dlq` 照样在）。于是隔壁
 * `dlq-watch-live.test.ts` 那条「队列不存在 ⇒ unknown」的用例会在同一个测试库里永久变红 ——
 * apps/web 整套测试共用一个库、单线程按文件名跑，这个文件排在它前面。
 *
 * 所以这个文件借了什么就还什么：DLQ 那八条是隔壁也会建的公共场地，留着；这六条父队列是我引进来的，
 * 收尾删掉（父队列没有被谁引用，`deleteQueue` 对它们是真的有效）。
 */
const BORROWED_QUEUES = [RENDER_QUEUE, REFGEN_QUEUE, GEN_QUEUE, CAPTION_QUEUE, RESEARCH_QUEUE, PUBLISH_QUEUE];

let boss: PgBoss;
/** 这一单假装是被放弃的那一张生成活；它的钱早就了结（RESERVE −110 / REFUND +110，净 0）。 */
let genJobId: string;
/** 另一张：预留了 110 之后**再没有任何一行**——结算没来、退款也没来，钱还押着。只看
 *  `balanceDelta` 的净额，它和上面那一单一样是 0；两个净额一起看才分得出来（判官 P2-3）。 */
let heldGenJobId: string;
/** 第三张：预留 110 之后全额结算 —— 这 110 是真花掉的，押着的归零。 */
let settledGenJobId: string;

/** 探针有 30 秒缓存，而缓存本身是被测行为 —— 每次探针把时钟推到窗口之外。 */
let clock = 0;
const probe = () => checkDeadLetters((clock += 60_000));

async function seedDeadLetter(ref: string = genJobId): Promise<string> {
  const jobId = await boss.send("gen.dlq", { genJobId: ref });
  if (!jobId) throw new Error("pg-boss refused the fixture dead letter");
  return jobId;
}

async function auditRows() {
  return prisma.actionEvent.findMany({
    where: { ownerId: FOUNDER_OWNER_ID, type: DLQ_DISCARD_EVENT },
    select: { id: true, payload: true },
  });
}

async function ledgerRows() {
  return prisma.creditLedger.findMany({
    where: { orgId: ORG_ID },
    select: { id: true, balanceDelta: true, kind: true },
    orderBy: { id: "asc" },
  });
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set — this suite needs the *_test database");
  boss = new PgBoss({
    connectionString: DATABASE_URL,
    schema: "pgboss",
    supervise: false,
    schedule: false,
    migrate: true,
    max: 2,
  });
  boss.on("error", () => {});
  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);

  await prisma.organization.upsert({ where: { id: FOUNDER_OWNER_ID }, update: {}, create: { id: FOUNDER_OWNER_ID, name: "Fikirtive" } });
  await prisma.organization.upsert({ where: { id: ORG_ID }, update: {}, create: { id: ORG_ID, name: TAG } });

  for (const [email, role] of [[OPERATOR, "ops"], [READER, "viewer"]] as const) {
    const user = await prisma.user.create({ data: { email, name: TAG }, select: { id: true } });
    await prisma.userRole.create({ data: { userId: user.id, role } });
  }

  // 钱路的现场：一单已经了结的生成活（预留后退回，净 0）—— staging 那条卡住的死信就是这个形状。
  genJobId = newId();
  await prisma.creditLedger.createMany({
    data: [
      { id: newId(), orgId: ORG_ID, balanceDelta: -110, reservedDelta: 110, kind: "RESERVE", refId: genJobId, idempotencyKey: `reserve:${genJobId}`, createdBy: TAG },
      { id: newId(), orgId: ORG_ID, balanceDelta: 110, reservedDelta: -110, kind: "REFUND", refId: genJobId, idempotencyKey: `refund:${genJobId}`, createdBy: TAG },
    ],
  });

  // 第二个现场：预留了 110，之后一行都没有 —— 钱还押着。
  await prisma.organization.upsert({ where: { id: HELD_ORG_ID }, update: {}, create: { id: HELD_ORG_ID, name: `${TAG}-held` } });
  heldGenJobId = newId();
  settledGenJobId = newId();
  await prisma.creditLedger.createMany({
    data: [
      { id: newId(), orgId: HELD_ORG_ID, balanceDelta: -110, reservedDelta: 110, kind: "RESERVE", refId: heldGenJobId, idempotencyKey: `reserve:${heldGenJobId}`, createdBy: TAG },
      // 第三个现场：预留 110 之后全额结算（SETTLE 写 `B-A / -B`，见 packages/db/src/credits.ts）。
      { id: newId(), orgId: HELD_ORG_ID, balanceDelta: -110, reservedDelta: 110, kind: "RESERVE", refId: settledGenJobId, idempotencyKey: `reserve:${settledGenJobId}`, createdBy: TAG },
      { id: newId(), orgId: HELD_ORG_ID, balanceDelta: 0, reservedDelta: -110, kind: "SETTLE", refId: settledGenJobId, idempotencyKey: `settle:${settledGenJobId}`, createdBy: TAG },
    ],
  });
}, 180_000);

beforeEach(async () => {
  sessionEmail = null;
  captureMessage.mockReset();
  for (const queue of QUEUES) await boss.deleteAllJobs(queue);
  await prisma.actionEvent.deleteMany({ where: { ownerId: FOUNDER_OWNER_ID, type: DLQ_DISCARD_EVENT } });
});

afterAll(async () => {
  for (const queue of QUEUES) await boss?.deleteAllJobs(queue).catch(() => {});
  await prisma.actionEvent.deleteMany({
    where: {
      ownerId: FOUNDER_OWNER_ID,
      type: { in: [DLQ_DISCARD_EVENT, "rbac.deny"] },
      createdAt: { gte: new Date(Date.now() - 3_600_000) },
    },
  });
  // 一个 org 一次 —— 租户守卫只认 `orgId` 的等值过滤，`{ in: [...] }` 会让它打出「无 orgId 过滤」的警告
  // （观察轮是 warn，落闸后是红；`docs/specs/tenant-isolation.md` §1.3 第四态）。
  await prisma.creditLedger.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.creditLedger.deleteMany({ where: { orgId: HELD_ORG_ID } });
  await prisma.userRole.deleteMany({ where: { user: { email: { in: [OPERATOR, READER] } } } });
  await prisma.user.deleteMany({ where: { email: { in: [OPERATOR, READER] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_ID, HELD_ORG_ID] } } });
  await (await getBoss().catch(() => null))?.stop({ graceful: false, close: true });
  for (const queue of BORROWED_QUEUES) await boss?.deleteQueue(queue).catch(() => {});
  // `deleteQueue` 吞掉自己的失败（见 BORROWED_QUEUES 上面那段），所以「删过了」不等于「删掉了」——
  // 当场回查一次，把一个会在隔壁文件里爆的静默失败变成这个文件自己的红。
  const leftovers = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM pgboss.queue WHERE name = ANY(${BORROWED_QUEUES}::text[])`;
  await boss?.stop({ graceful: false, close: true });
  if (leftovers.length > 0) {
    throw new Error(
      `dlq-discard-live 借来的队列没还回去：${leftovers.map((row) => row.name).join(", ")}。` +
        `留着会让 dlq-watch-live.test.ts 的「队列不存在 ⇒ unknown」在同一个测试库里永久变红。`,
    );
  }
});

describe("DLQ discard against a real queue", () => {
  it("DLQ-A1 lists each dead letter with its queue, job id, payload identifiers and the job's ledger net", async () => {
    const jobId = await seedDeadLetter();

    // 与 `app/admin/queue/page.tsx` 同一个帧：staff、`ownerId = null`（平台扫描域）。直接裸调会
    // 让下面那次账本求和落进守卫的「无帧」分支 —— 那不是产品里的调用形状。
    const listing = await runAsStaff(staffPrincipal({ email: OPERATOR }, null), () => listDeadLetters());

    expect(listing.readable).toBe(true);
    if (!listing.readable) return;
    const item = listing.items.find((row) => row.jobId === jobId);
    expect(item).toBeDefined();
    expect(item!.queue).toBe("gen.dlq");
    expect(item!.identifiers).toEqual([{ key: "genJobId", value: genJobId }]);
    expect(item!.withheldKeys).toEqual([]);
    // 「钱已经了结」是操作者按下 Discard 之前唯一要确认的事：扣掉 0、还押着 0。
    expect(item!.ledger).toEqual({ charged: 0, held: 0, kinds: ["REFUND", "RESERVE"], rows: 2 });
  });

  /**
   * DLQ-A1（判官 P2-3）—— 只把 `balanceDelta` 求和，「预留 110 从没释放」和「钱早就了结」
   * 会算出同一个 0。两个净额一起报，那笔悬着的预留才在按下按钮之前看得见。
   */
  it("DLQ-A1 shows the credits still held for a job whose reserve was never released", async () => {
    const jobId = await seedDeadLetter(heldGenJobId);

    const listing = await runAsStaff(staffPrincipal({ email: OPERATOR }, null), () => listDeadLetters());

    expect(listing.readable).toBe(true);
    if (!listing.readable) return;
    const item = listing.items.find((row) => row.jobId === jobId);
    expect(item!.ledger).toEqual({ charged: 0, held: 110, kinds: ["RESERVE"], rows: 1 });
  });

  /** 反方向钉一次：结算掉的 110 必须报成「真花掉了 110」，而不是跟上面那条押着的同形。 */
  it("DLQ-A1 counts a settled job as charged, with nothing still held", async () => {
    const jobId = await seedDeadLetter(settledGenJobId);

    const listing = await runAsStaff(staffPrincipal({ email: OPERATOR }, null), () => listDeadLetters());

    expect(listing.readable).toBe(true);
    if (!listing.readable) return;
    const item = listing.items.find((row) => row.jobId === jobId);
    expect(item!.ledger).toEqual({ charged: 110, held: 0, kinds: ["RESERVE", "SETTLE"], rows: 2 });
  });

  /**
   * DLQ-A1（判官 P2-2）—— 账本**读失败**不许长得跟「这一条不涉及钱」一样。
   *
   * 上一版把失败 `.catch(() => new Map())` 成空 Map，于是屏幕上一行账本字都不出现 —— 与
   * 「payload 没点名任何生成单」完全同形。操作者可能就此丢掉一条预留还悬着的活。这与本规格
   * 「读不到 vs 读到空是两句话」是同一条规矩。
   */
  it("DLQ-A1 says the ledger could not be read rather than showing nothing at all", async () => {
    const jobId = await seedDeadLetter();
    // `vi.spyOn(...).mockRestore()` 在 Prisma 7 的 delegate 上会把方法**删掉**（proxy 的 get
    // 陷阱现造的，没有可还原的 own descriptor）—— 自己存一份再自己装回去。
    const original = prisma.creditLedger.groupBy;
    (prisma.creditLedger as { groupBy: unknown }).groupBy = vi.fn().mockRejectedValue(
      Object.assign(
        // Prisma 的 message 会把调用参数渲染进去 —— 这里故意把生成单号写在里面，用来钉住
        // 「告警只报分类、不报原始 message」。
        new Error(`Invalid \`prisma.creditLedger.groupBy()\` invocation: refId in ["${genJobId}"]`),
        { name: "PrismaClientKnownRequestError", code: "P1001" },
      ),
    );
    let listing: Awaited<ReturnType<typeof listDeadLetters>>;
    try {
      listing = await runAsStaff(staffPrincipal({ email: OPERATOR }, null), () => listDeadLetters());
    } finally {
      (prisma.creditLedger as { groupBy: unknown }).groupBy = original;
    }

    // 死信清单本身照读不误 —— 读不到的是账本，不是队列。
    expect(listing.readable).toBe(true);
    if (!listing.readable) return;
    expect(listing.items.find((row) => row.jobId === jobId)!.ledger).toBe("unreadable");

    // 有人看得见，且告警只带分类，不带生成单号。
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [text, options] = captureMessage.mock.calls[0] as [string, { tags?: Record<string, string>; extra?: Record<string, unknown> }];
    expect(text).toBe("Dead-letter board could not read the credit ledger");
    expect(options?.tags).toMatchObject({ area: "admin", gate: "dead-letter-ledger" });
    expect(options?.extra).toEqual({ errorName: "PrismaClientKnownRequestError", errorCode: "P1001" });
    expect(JSON.stringify(options ?? {})).not.toContain(genJobId);
  });

  it("DLQ-A2 discards one job so the probe stops counting it, and names the audit row it wrote", async () => {
    const jobId = await seedDeadLetter();
    expect((await probe()).offenders).toEqual([{ queue: "gen.dlq", count: 1 }]);

    sessionEmail = OPERATOR;
    const result = await discardDeadLetter({ queue: "gen.dlq", jobId });

    expect(result).toMatchObject({ ok: true, outcome: "discarded" });
    // 探针 —— 不是我自己的那条 SELECT —— 是「丢掉了」的唯一判据。
    expect((await probe()).status).toBe("clear");

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe((result as { auditEventId: string }).auditEventId);
    expect(rows[0]!.payload).toMatchObject({ queue: "gen.dlq", jobId, via: OPERATOR, data: { genJobId } });
  });

  /**
   * DLQ-A2／A3（判官 P2-1）—— 取消**已经发生**，审计行没写下去。
   *
   * 上一版这里没有 try/catch：`prisma.actionEvent.create` 一抛，整个 server action reject，对话框
   * 说「The action could not finish…」，操作者重试 —— 而那一条已经不在队列里，于是他读到
   * 「已经不在了，什么都没记」。一次**零审计的丢弃**外加一句假话。现在这是它自己的一个 outcome。
   */
  it("DLQ-A2 answers discarded-unaudited when the job is gone but the audit row could not be written", async () => {
    const jobId = await seedDeadLetter();
    expect((await probe()).offenders).toEqual([{ queue: "gen.dlq", count: 1 }]);
    sessionEmail = OPERATOR;

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = prisma.actionEvent.create;
    (prisma.actionEvent as { create: unknown }).create = vi.fn().mockRejectedValue(
      Object.assign(
        // 真实形状：Organization 外键失败，message 里带着调用参数（含 payload 摘要里的生成单号）。
        new Error(`Invalid \`prisma.actionEvent.create()\` invocation: Foreign key constraint failed, data: {"genJobId":"${genJobId}"}`),
        { name: "PrismaClientKnownRequestError", code: "P2003" },
      ),
    );
    let result: Awaited<ReturnType<typeof discardDeadLetter>>;
    try {
      result = await discardDeadLetter({ queue: "gen.dlq", jobId });
    } finally {
      (prisma.actionEvent as { create: unknown }).create = original;
    }

    // 丢弃是真的：探针不再数它，队列里那一行是 cancelled。
    expect(result).toEqual({ ok: true, outcome: "discarded-unaudited" });
    expect((await probe()).status).toBe("clear");
    expect((await boss.getJobById("gen.dlq", jobId))?.state).toBe("cancelled");
    // 痕迹也是真的：一行都没有 —— 所以那句话必须自己说出口，不能靠第二次按下去问出来。
    expect(await auditRows()).toHaveLength(0);

    // 再按一次仍然答「已经不在了」——这一次这句话是真的，因为上一次已经把没留痕说清楚了。
    expect(await discardDeadLetter({ queue: "gen.dlq", jobId })).toEqual({ ok: true, outcome: "already-gone" });
    expect(await auditRows()).toHaveLength(0);

    // 有人看得见：一条固定分类的告警 + 一行可 grep 的日志；两者都不带 payload 摘要。
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [text, options] = captureMessage.mock.calls[0] as [string, { tags?: Record<string, string>; extra?: Record<string, unknown> }];
    expect(text).toBe("Dead letter discarded but its audit row could not be written");
    expect(options?.tags).toMatchObject({ area: "admin", gate: "dlq-discard-audit" });
    expect(options?.extra).toEqual({ queue: "gen.dlq", jobId, errorName: "PrismaClientKnownRequestError", errorCode: "P2003" });
    expect(JSON.stringify(options ?? {})).not.toContain(genJobId);
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes("[dlq-discard]"))).toBe(true);
    consoleError.mockRestore();
  });

  /** 告警通道自己炸掉时，答案一个字都不许变（同 `lib/tenant-actions.ts` 第 9 轮的口径）。 */
  it("DLQ-A2 still answers discarded-unaudited when the alert channel itself throws", async () => {
    const jobId = await seedDeadLetter();
    sessionEmail = OPERATOR;

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = prisma.actionEvent.create;
    (prisma.actionEvent as { create: unknown }).create = vi.fn().mockRejectedValue(new TypeError("action_event insert failed"));
    captureMessage.mockImplementationOnce(() => { throw new Error("sentry transport down"); });
    try {
      expect(await discardDeadLetter({ queue: "gen.dlq", jobId })).toEqual({ ok: true, outcome: "discarded-unaudited" });
    } finally {
      (prisma.actionEvent as { create: unknown }).create = original;
      consoleError.mockRestore();
    }
    expect((await boss.getJobById("gen.dlq", jobId))?.state).toBe("cancelled");
    expect(await auditRows()).toHaveLength(0);
  });

  it("DLQ-A2 leaves the job in the queue as cancelled rather than deleting the evidence", async () => {
    const jobId = await seedDeadLetter();
    sessionEmail = OPERATOR;
    await discardDeadLetter({ queue: "gen.dlq", jobId });

    expect((await boss.getJobById("gen.dlq", jobId))?.state).toBe("cancelled");
  });

  it("DLQ-A3 answers already-gone on a second discard, and still writes only one audit row", async () => {
    const jobId = await seedDeadLetter();
    sessionEmail = OPERATOR;

    const first = await discardDeadLetter({ queue: "gen.dlq", jobId });
    const second = await discardDeadLetter({ queue: "gen.dlq", jobId });

    expect(first).toMatchObject({ ok: true, outcome: "discarded" });
    expect(second).toEqual({ ok: true, outcome: "already-gone" });
    expect(await auditRows()).toHaveLength(1);
  });

  it("DLQ-A3 answers already-gone for a job id that was never there", async () => {
    sessionEmail = OPERATOR;
    const result = await discardDeadLetter({ queue: "gen.dlq", jobId: "00000000-0000-4000-8000-000000000000" });

    expect(result).toEqual({ ok: true, outcome: "already-gone" });
    expect(await auditRows()).toHaveLength(0);
  });

  it("DLQ-A4 writes nothing to the credit ledger — discarding a dead letter never touches money", async () => {
    const jobId = await seedDeadLetter();
    const before = await ledgerRows();
    sessionEmail = OPERATOR;

    await discardDeadLetter({ queue: "gen.dlq", jobId });

    expect(await ledgerRows()).toEqual(before);
    expect(before.reduce((sum, row) => sum + row.balanceDelta, 0)).toBe(0);
  });

  it("DLQ-A5 refuses a principal without system.mutate, and the job is still counted", async () => {
    const jobId = await seedDeadLetter();
    sessionEmail = READER; // viewer holds system.read (the board) but not system.mutate

    const result = await discardDeadLetter({ queue: "gen.dlq", jobId });

    expect(result).toEqual({ error: "You don't have access to this." });
    expect((await probe()).offenders).toEqual([{ queue: "gen.dlq", count: 1 }]);
    expect(await auditRows()).toHaveLength(0);
  });

  it("DLQ-A5 refuses a request with no session at all", async () => {
    const jobId = await seedDeadLetter();
    sessionEmail = null;

    expect(await discardDeadLetter({ queue: "gen.dlq", jobId })).toEqual({ error: "Not authorized." });
    expect((await probe()).offenders).toEqual([{ queue: "gen.dlq", count: 1 }]);
  });

  /** 死信队列之外的队列不是这个动作的射程 —— 否则同一个按钮能取消在飞的 gen 活。 */
  it("DLQ-A5 refuses any queue that is not a dead-letter queue", async () => {
    sessionEmail = OPERATOR;
    const result = await discardDeadLetter({ queue: "gen", jobId: "00000000-0000-4000-8000-000000000000" });

    expect(result).toEqual({ error: "That isn't a dead-letter job this page can discard." });
  });
});
