/**
 * real08-retry-paid-ledger —— 「一单付费生成失败之后,商家改一改再试」那条路的**付费半段**,
 * 跑在真 Postgres(*_test)、真 Prisma、真积分台账上。
 *
 * 补的是哪个洞:走查 REAL-08(`docs/audits/fullstack-staging-2026-09-14/real-scenarios.md`)在
 * staging 只证到**免费半段**——重试入口在、原退款没被抵消、付费前 fail-closed 理由可行动;
 * 「新单一次预扣」那一条走不到:那天 org founder 仅有的两个自然失败都是永久性无效输入
 * (80×107px 起始帧、「不能作人物」的参考图),任何忠实重试都在校验层被拒,而那一行自己写着
 * 「没有自然失败则 NOT RUN,不故意打挂线上」。Founder 2026-09-18(对谈)改判:由测试覆盖。
 * 登记见 `docs/specs/money-engine.md` §5 2026-09-18 行。
 *
 * 为什么不是既有那几个文件能顺手加一条:
 *   · `gen-ledger.test.ts` 的重试用例走的是 `startGen` 的**平键**(调用方自己出一个新键),
 *     D-035 明写平键只是「在飞防重复提交」;REAL-08 走的是**卡键** `cowork:<cardId>` ——
 *     全状态唯一索引 `GenJob_cowork_idempotency_once`,语义与平键正相反。
 *   · `otto-card-options-ledger.test.ts` 真库、真账本,但它从 `startCoworkGen` 进,跳过了
 *     商家真正按下的那个动作 `coworkGenerate`(卡键就是在那里长出来的)。
 *   · `cowork-actions.test.ts` 覆盖 `coworkGenerate`,但整个 `@fikirtive/db` 是假件 ——
 *     一行真账本都没有。
 * 这个文件把这三段接成商家实际走的那一条:铸卡 → `coworkGenerate` 批准 → 供应商侧失败退款
 * → `coworkVaryCard`(「Try again」)克隆 → `ottoUpdateGenCardOptions`(「Change something」)
 * 改一格 → `coworkGenerate` 批准克隆卡。钱这一层一个替身都没有。
 *
 * 钉住四件事:
 *   (a) 付费单在供应商侧失败 ⇒ 恰好退一次(RESERVE→REFUND、余额复原;第二个失败信号
 *       拿到 `already-refunded`,账本零新增行、余额一分不动);
 *   (b) 重试(克隆卡 → 改一格 → 批准)⇒ **新的一单、新的幂等键**,恰好一行 RESERVE,
 *       原来那一笔退款一个字节没动;
 *   (c) 同一张重试卡批两次(顺序 / 并发)⇒ 拿回同一单,只预扣一次;
 *   (d) 整段旅程账本守恒:∑balanceDelta == 期末余额 − 期初余额,且 reserved 归零。
 *
 * 只有 web 层 startGen 周边是假件(auth guard、impersonation、队列、guardian、机型开关、
 * next/cache)——与 `gen-ledger.test.ts` / `otto-card-options-ledger.test.ts` 同一套。
 * worker 的两个终态用它自己调的那两个函数原样跑(`refundReservation` / `settleCredits`,
 * 见 `apps/worker/src/jobs/gen.ts` 的 `failClosedWithRefund`:状态翻转与退款同一笔事务)。
 * 零 provider 调用,零真实花费。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { coworkGenerate, coworkVaryCard } = await import("../cowork-actions");
const { ottoUpdateGenCardOptions } = await import("../otto-actions");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");

const PROMPT = "A pandan kaya jar on a marble counter";

function ottoCtx(world: World): OttoContext {
  return {
    orgId: world.ownerId,
    userId: "user-test",
    projectId: world.projectId,
    threadId: world.threadId,
    disabledModels: [],
    sourceGenerationId: null,
  } as OttoContext;
}

async function seedWorld(balanceDisplay: number) {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({
    data: { orgId: ownerId, balance: balanceDisplay * INTERNAL_PER_DISPLAY, reserved: 0 },
  });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "REAL-08 retry" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId, openingBalance: balanceDisplay * INTERNAL_PER_DISPLAY };
}

type World = { ownerId: string; projectId: string; threadId: string; openingBalance: number };

/** Otto 铸卡 → 原样落库成一张 GEN_CARD(payload 一个字节都不改写)。 */
async function mintImageCard(world: World, seq: number): Promise<{ cardId: string; payload: CardPayload }> {
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: PROMPT, entityIds: [], variantSel: {} },
    ottoCtx(world),
    [],
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: world.threadId,
      ownerId: world.ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq,
      text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return { cardId, payload: cardPayload };
}

/** 商家在那张卡上按下 Generate —— 走的就是浏览器调的那个 Server Action。 */
async function approve(cardId: string) {
  return coworkGenerate({ cardId, prompt: PROMPT, entityIds: [], variantSel: {} });
}

function jobIdOf(res: Awaited<ReturnType<typeof coworkGenerate>>): string {
  if ("error" in res) throw new Error(`coworkGenerate 失败:${res.error}`);
  return res.id;
}

async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

/**
 * 供应商侧失败的那一刻,worker 在钱这一层做的那件事。参照物是
 * `apps/worker/src/jobs/gen.ts:907-941` 的 `failClosedWithRefund`,**不是逐字照抄**——
 * 复刻的只有钱路那一段,其余三处明确不复刻:
 *
 * 复刻:状态翻转与退款落在**同一笔事务**里;退款调的是账本自己的 `refundReservation`
 * (不是替身),所以回的是它自己的四态答复(`RefundOutcome`),「第二个失败信号」到底做了
 * 什么可以被断言,而不是靠数行数猜。
 *
 * 不复刻:① 真函数那句 `updateMany` 带两道谓词(`status` 仍在 `GEN_IN_FLIGHT_STATUSES`、
 * `generationIds: { isEmpty: true }`),`count === 0` 就直接 `return false`、**根本不调**
 * `refundReservation`——真实退款在这道条件之后,本夹具是无条件退;② `already-settled` 抛
 * `SETTLED_PRE_SPEND_FAIL` 把那次状态翻转整笔回滚的那一支,连同它的 `captureMoneyPathError`
 * 报警;③ 终态的 `appendCoworkResult(…, "TURN_ERROR", …)` 与 `settleCanvasBoard(job)`。
 * ①②是取消/已结算竞态下「该不该退」的判定,本文件不造这两种竞态(每次 workerFail 都打在一张
 * 刚预扣、没交付、没被取消的单上);③ 不碰账本(`gen.ts:775` 写明「no money column, no
 * ledger」),三者都不改本文件对账本行与余额的断言。判定本身的围栏在 worker 自己的
 * `apps/worker/src/jobs/gen.test.ts` 与 `gen-done-empty-db.test.ts`。
 */
async function workerFail(ownerId: string, jobId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.genJob.updateMany({
      where: { id: jobId, ownerId },
      data: { status: "FAILED", error: "provider rejected the request", finishedAt: new Date() },
    });
    return refundReservation(tx, { orgId: ownerId, refId: jobId });
  });
}

/** worker 的成功终态,走它自己调的那个函数。 */
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({
    where: { id: jobId, ownerId },
    data: { status: "DONE", spent: true, finishedAt: new Date() },
  });
}

/** 「Try again」那一下之后,这条对话里最新的那张 GEN_CARD —— 克隆卡。 */
async function newestCard(world: World): Promise<{ cardId: string; payload: CardPayload }> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { threadId: world.threadId, ownerId: world.ownerId, kind: "GEN_CARD", deletedAt: null },
    orderBy: { seq: "desc" },
    select: { id: true, payload: true },
  });
  return { cardId: row.id, payload: row.payload as unknown as CardPayload };
}

async function persistedCard(world: World, cardId: string): Promise<CardPayload> {
  const row = await prisma.chatMessage.findFirstOrThrow({
    where: { id: cardId, ownerId: world.ownerId, kind: "GEN_CARD" },
    select: { payload: true },
  });
  return row.payload as unknown as CardPayload;
}

/** 走完整条路到「克隆卡就摆在那里」为止:批准 → 供应商失败退款 → 按 Try again。 */
async function failThenRetryCard(world: World) {
  const first = await mintImageCard(world, 1);
  const failedJobId = jobIdOf(await approve(first.cardId));
  const outcome = await workerFail(world.ownerId, failedJobId);
  expect(outcome).toBe("refunded");
  const varied = await coworkVaryCard({ cardId: first.cardId });
  expect("error" in varied).toBe(false);
  const retry = await newestCard(world);
  expect(retry.cardId).not.toBe(first.cardId);
  return { first, failedJobId, retry };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("REAL-08 付费半段 (a) 供应商侧失败 ⇒ 恰好退一次,第二个失败信号一分钱不动", () => {
  it("失败单:RESERVE 一行、REFUND 一行、余额复原到一分不差", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world, 1);
    const price = card.payload.estimatedCredits * INTERNAL_PER_DISPLAY;

    const jobId = jobIdOf(await approve(card.cardId));
    const held = await account(world.ownerId);
    expect(held.reserved).toBe(price);
    expect(held.balance).toBe(world.openingBalance - price);

    expect(await workerFail(world.ownerId, jobId)).toBe("refunded");

    const rows = await ledgerRows(world.ownerId);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND"]);
    expect(rows[0]!.refId).toBe(jobId);
    expect(rows[0]!.balanceDelta).toBe(-price); // 扣走的就是卡上那个数
    expect(rows[0]!.reservedDelta).toBe(price);
    expect(rows[1]!.refId).toBe(jobId);
    expect(rows[1]!.balanceDelta).toBe(price); // 退回来的与扣走的同一个数,读的是 RESERVE 行自己
    expect(rows[1]!.reservedDelta).toBe(-price);
    const after = await account(world.ownerId);
    expect(after.balance).toBe(world.openingBalance); // 商家没有为一张没拿到的图出钱
    expect(after.reserved).toBe(0);
  });

  it("同一单再收一个失败信号(redelivery / 收割器)⇒ already-refunded,账本零新增行、余额零变化", async () => {
    const world = await seedWorld(500);
    const card = await mintImageCard(world, 1);
    const jobId = jobIdOf(await approve(card.cardId));
    expect(await workerFail(world.ownerId, jobId)).toBe("refunded");

    const rowsAfterFirst = await ledgerRows(world.ownerId);
    const balanceAfterFirst = (await account(world.ownerId)).balance;

    const second = await workerFail(world.ownerId, jobId);
    const third = await workerFail(world.ownerId, jobId);

    // 先数钱,再读答复 —— 钱本身就是这一条的判据,答复只是它的说明。
    expect(await ledgerRows(world.ownerId)).toHaveLength(rowsAfterFirst.length); // 一行都没多
    const after = await account(world.ownerId);
    expect(after.balance).toBe(balanceAfterFirst);
    expect(after.reserved).toBe(0);
    expect([second, third]).toEqual(["already-refunded", "already-refunded"]);
  });
});

describe("REAL-08 付费半段 (b) 改一改再试 ⇒ 新的一单、新的幂等键、只预扣一次", () => {
  it("「Try again」那一下本身零花费:零 GenJob、零账本新增行、退款行一个字节没动", async () => {
    const world = await seedWorld(500);
    const { failedJobId, retry } = await failThenRetryCard(world);

    // 克隆发生在退款之后 —— 这一下不许碰钱。
    const rows = await ledgerRows(world.ownerId);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND"]); // 还是失败那一单的两行
    expect(rows.every((r) => r.refId === failedJobId)).toBe(true);
    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId } })).toBe(1);
    expect((await account(world.ownerId)).balance).toBe(world.openingBalance);

    // 克隆卡是一张还没生成过的卡:身份是新的,内容与原卡逐格相同。
    const cloned = await persistedCard(world, retry.cardId);
    expect(cloned.model).toBe(retry.payload.model);
    expect(cloned.params).toEqual(retry.payload.params);
    const clonedRow = await prisma.chatMessage.findFirstOrThrow({
      where: { id: retry.cardId, ownerId: world.ownerId },
      select: { genJobId: true },
    });
    expect(clonedRow.genJobId).toBeNull();
  });

  it("克隆卡上改一格(Change something)再批准 ⇒ 新单、键是 cowork:<新卡 id>、恰好一行 RESERVE,原退款不动", async () => {
    const world = await seedWorld(500);
    const { failedJobId, retry } = await failThenRetryCard(world);

    // 「Change something」在钱这一侧的样子:卡上改一格,报价跟着换一个数。
    const edited = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: retry.cardId, count: 3 });
    if ("error" in edited) throw new Error(`改档被拒:${edited.error}`);
    expect(edited.payload.params.count).toBe(3);
    const retryPrice = (await persistedCard(world, retry.cardId)).estimatedCredits * INTERNAL_PER_DISPLAY;
    expect(retryPrice).toBeGreaterThan(retry.payload.estimatedCredits * INTERNAL_PER_DISPLAY);

    const retryJobId = jobIdOf(await approve(retry.cardId));
    expect(retryJobId).not.toBe(failedJobId);

    // 新的一单,键长在**新卡**上 —— 与失败那一单不同域,谁也复活不了谁。
    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: retryJobId, ownerId: world.ownerId },
      select: { idempotencyKey: true, count: true, status: true },
    });
    expect(job.idempotencyKey).toBe(`cowork:${retry.cardId}`);
    expect(job.count).toBe(3);
    const failedJob = await prisma.genJob.findFirstOrThrow({
      where: { id: failedJobId, ownerId: world.ownerId },
      select: { idempotencyKey: true, status: true },
    });
    expect(failedJob.idempotencyKey).not.toBe(job.idempotencyKey);
    expect(failedJob.status).toBe("FAILED");

    // 账本:三行,新单只预扣了一次,卡上那个数就是预扣那个数。
    const rows = await ledgerRows(world.ownerId);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND", "RESERVE"]);
    expect(rows.filter((r) => r.refId === retryJobId).map((r) => r.kind)).toEqual(["RESERVE"]);
    expect(Math.abs(rows[2]!.balanceDelta)).toBe(retryPrice);
    // 原来那一笔退款:还是那一行,一个字段都没被新单碰过。
    expect(rows[1]!.refId).toBe(failedJobId);
    expect(rows[1]!.balanceDelta).toBe(-rows[0]!.balanceDelta);
    const acct = await account(world.ownerId);
    expect(acct.reserved).toBe(retryPrice); // 在飞的只有新单这一笔
    expect(acct.balance).toBe(world.openingBalance - retryPrice); // 失败那一单的钱已经完整回来了
  });
});

describe("REAL-08 付费半段 (c) 同一张重试卡批两次 ⇒ 只预扣一次", () => {
  it("顺序连按两次 ⇒ 拿回同一单,账本只有一行 RESERVE", async () => {
    const world = await seedWorld(500);
    const { retry } = await failThenRetryCard(world);

    const firstPress = jobIdOf(await approve(retry.cardId));
    const secondPress = jobIdOf(await approve(retry.cardId));
    expect(secondPress).toBe(firstPress);

    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId, idempotencyKey: `cowork:${retry.cardId}` } })).toBe(1);
    const reserves = (await ledgerRows(world.ownerId)).filter((r) => r.refId === firstPress && r.kind === "RESERVE");
    expect(reserves).toHaveLength(1);
  });

  it("第一单已经 DONE 之后再按 ⇒ 还是拿回那一单,不是第二次购买(卡键是全状态唯一的)", async () => {
    const world = await seedWorld(500);
    const { retry } = await failThenRetryCard(world);

    const retryJobId = jobIdOf(await approve(retry.cardId));
    await workerSettle(world.ownerId, retryJobId);
    const balanceAfterSettle = (await account(world.ownerId)).balance;

    expect(jobIdOf(await approve(retry.cardId))).toBe(retryJobId);
    expect((await ledgerRows(world.ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(2); // 失败那一单 + 重试这一单
    expect((await account(world.ownerId)).balance).toBe(balanceAfterSettle);
  });

  it("并发双击(两个请求同时在飞)⇒ 仍然一单一扣 —— 全状态唯一索引是兜底", async () => {
    const world = await seedWorld(500);
    const { retry } = await failThenRetryCard(world);

    const [a, b] = await Promise.all([approve(retry.cardId), approve(retry.cardId)]);
    const ids = [a, b].filter((r): r is { id: string } => "id" in r).map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(1); // 两个请求指向同一单(或其中一个被索引干净拒掉)

    expect(await prisma.genJob.count({ where: { ownerId: world.ownerId, idempotencyKey: `cowork:${retry.cardId}` } })).toBe(1);
    expect((await ledgerRows(world.ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(2);
  });
});

describe("REAL-08 付费半段 (d) 整段旅程账本守恒", () => {
  it("失败 → 退款 → 克隆 → 改一格 → 批准 → 连按 → 结算:∑balanceDelta == 期末 − 期初,reserved 归零", async () => {
    const world = await seedWorld(500);
    const { failedJobId, retry } = await failThenRetryCard(world);

    const edited = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId: retry.cardId, count: 2 });
    if ("error" in edited) throw new Error(`改档被拒:${edited.error}`);
    const retryPrice = (await persistedCard(world, retry.cardId)).estimatedCredits * INTERNAL_PER_DISPLAY;

    const retryJobId = jobIdOf(await approve(retry.cardId));
    expect(jobIdOf(await approve(retry.cardId))).toBe(retryJobId); // 商家又按了一下
    await workerSettle(world.ownerId, retryJobId);
    // 失败那一单的晚到终结者:两个都必须是空动作。
    const lateRefund = await workerFail(world.ownerId, failedJobId);
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: world.ownerId, refId: failedJobId }));

    const rows = await ledgerRows(world.ownerId);
    const acct = await account(world.ownerId);

    // 守恒:账本每一行的净变之和,就是余额走过的距离 —— 没有一分钱是凭空出现或消失的。
    const sumBalance = rows.reduce((n, r) => n + r.balanceDelta, 0);
    expect(sumBalance).toBe(acct.balance - world.openingBalance);
    const sumReserved = rows.reduce((n, r) => n + r.reservedDelta, 0);
    expect(sumReserved).toBe(acct.reserved);
    expect(acct.reserved).toBe(0);

    // 整段旅程商家只为**交付了的那一单**出过钱。
    expect(acct.balance).toBe(world.openingBalance - retryPrice);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND", "RESERVE", "SETTLE"]);
    expect(rows.filter((r) => r.refId === failedJobId).map((r) => r.kind)).toEqual(["RESERVE", "REFUND"]);
    expect(rows.filter((r) => r.refId === retryJobId).map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expect(lateRefund).toBe("already-refunded");
  });
});
