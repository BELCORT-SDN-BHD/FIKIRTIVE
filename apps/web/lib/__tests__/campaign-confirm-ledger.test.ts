/**
 * campaign-confirm-ledger —— 战役确认卡的**全真账本**证据(#708 / #709)。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger(经真 `startGen` 的 `reserveCredits`),
 * worker 的结算用它自己那两个函数(`settleCredits` / `refundReservation`)原样模拟 ——
 * MockProvider 路径,零真实 provider 调用、零真实花费。只有 startGen 周边的 web 管线是替身
 * (auth guard / impersonation / queue / guardian / model registry / next-cache),与
 * `factory-batch-ledger.test.ts` 同一套。
 *
 * 证的就是那一条:**确认卡上写的数 == 账本上真扣的数**。
 *   - 有已生成条目的战役:卡上写 1,账本扣 1(修前卡上写 12);
 *   - 选了 480p 的战役:卡上写半价档的数,账本扣同一个数;
 *   - 冻结档位:落库快照就是确认时刻那一档。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

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

const { confirmCampaignGeneration, quoteCampaignGeneration } = await import("../campaign-generation-confirm");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");
// 「另一个标签页占住了这一格」要在库里落一行真的历史,而它的键必须与派发那一侧**同一个**
// 推导 —— 手抄一份公式就等于测了一个不存在的键。
const { stableCellLogicalPrefix } = await import("../factory-batch");
const { deriveCampaignBatchId } = await import("../campaign-gen-identity");
const { campaignDispatchLeaseHolder, CAMPAIGN_DISPATCH_LEASE_MS, BATCH_IDLE_STATUS } =
  await import("../campaign-approval-lock");

const IMG = 1; // one image cell = 1 displayed credit
const VID_720_5S = 11; // #644 裁决 2026-08-06
const VID_480_5S = 6; // #645 T4 价目表(Founder 裁决 2026-08-06):480p 半价档,5 秒 = 6
const SPEC_480 = { resolution: "480p", durationSeconds: 5 };

// ULID-shaped campaign ids (the action's own schema requires them).
function campaignId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return Array.from({ length: 26 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

type PlanEntry = { id: string; format: string; brief: string; hook?: string; platform?: string };

function planEntry(entry: PlanEntry) {
  return {
    id: entry.id,
    date: "2026-08-08",
    platform: entry.platform ?? "instagram",
    format: entry.format,
    hook: entry.hook ?? `hook ${entry.id}`,
    brief: entry.brief,
    estCredits: 999,
    status: "approved",
  };
}

async function seedWorld(balanceDisplay: number, entries: PlanEntry[]) {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({
    data: { orgId: ownerId, balance: balanceDisplay * INTERNAL_PER_DISPLAY, reserved: 0 },
  });
  const id = campaignId();
  await prisma.campaign.create({
    data: {
      id,
      ownerId,
      name: "Raya sale",
      goal: "Sell the Raya collection",
      startAt: new Date("2026-08-01"),
      endAt: new Date("2026-08-31"),
      planJson: { theme: "Raya", rationale: null, entries: entries.map(planEntry), ideas: [] },
    },
  });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Raya project", campaignId: id } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, campaignId: id, projectId };
}

async function setPlan(id: string, ownerId: string, entries: PlanEntry[]) {
  await prisma.campaign.update({
    where: { id, ownerId },
    data: { planJson: { theme: "Raya", rationale: null, entries: entries.map(planEntry), ideas: [] } },
  });
}

async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}

/** 这一趟真正被预扣走的内部 credits —— 直接读账本,不读任何返回值。
 *  一行都没有时必须是 0,不是 -0(`toBe` 分得清这两个)。 */
async function reservedThisRun(ownerId: string, since: Date): Promise<number> {
  const rows = await prisma.creditLedger.findMany({
    where: { orgId: ownerId, kind: "RESERVE", createdAt: { gte: since } },
  });
  return rows.reduce((sum, row) => sum - row.balanceDelta, 0);
}

/** worker 的成功结算,走它自己那个函数。 */
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({
    where: { id: jobId, ownerId },
    data: { status: "DONE", spent: true, finishedAt: new Date() },
  });
}

/** worker 的失败结算(退款 + FAILED),同样走它自己那个函数。 */
async function workerRefund(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({
    where: { id: jobId, ownerId },
    data: { status: "FAILED", error: "provider failed", finishedAt: new Date() },
  });
}

async function quoteFor(id: string, options: Record<string, unknown>) {
  const quoted = await quoteCampaignGeneration(id, options);
  if (!("ok" in quoted)) throw new Error(quoted.error);
  return quoted;
}

/**
 * 商家**看着卡确认**的那份请求(#708 修复轮 P1-1):价格、内容、以及他复核时会被交付的
 * 那一组条目,三样一起签。少收放行,少交付要重新问。
 */
function signed(
  world: { campaignId: string; projectId: string },
  quoted: Awaited<ReturnType<typeof quoteFor>>,
  over: Record<string, unknown> = {},
) {
  return {
    campaignId: world.campaignId,
    projectId: world.projectId,
    expectedTotalCredits: quoted.quote.totalDisplayCredits,
    expectedContentFingerprint: quoted.quote.contentFingerprint,
    expectedDeliveryFingerprint: quoted.quote.deliveryFingerprint,
    ...over,
  };
}

async function jobCount(ownerId: string) {
  return prisma.genJob.count({ where: { ownerId } });
}

/**
 * 「派发窗口」的钩子(#749 判官 r2 P1)—— 判官指出的那条缝,原样重现。
 *
 * 确认动作先读一次历史算出报价与交付面(**锁外快照**),再把这一批交给 `orchestrateBatch`;
 * 后者在派发第一格之前先解析批次分组行。挂在那一步的一次性动作,落点正是「商家签名依据的
 * 那次报价已经读完」与「这一批还一格都没花钱」之间。世界在这里变(worker 退款置失败 /
 * 另一次派发占住某个条目),用的是真实动作,不是把替身放宽。
 */
function whileDispatchWindowOpen(hook: () => Promise<void>) {
  const delegate = prisma.generationBatch as unknown as Record<string, unknown>;
  const real = (delegate.findFirst as (args: unknown) => Promise<unknown>).bind(delegate);
  const once = async (args: unknown) => {
    delegate.findFirst = real; // 一次性:这一批之后照旧走真的那条路
    await hook();
    return real(args);
  };
  delegate.findFirst = once;
  return () => { if (delegate.findFirst === once) delegate.findFirst = real; };
}

/**
 * 判官 r3 指出的那条缝:**格与格之间**(#749 判官 r3 P1)。
 *
 * `orchestrateBatch` 每派发完一格,就把那个任务打上批次标记(`genJob.updateMany`)—— 那一刻
 * 这一格的扣费**已经提交**,而下一格还没开始,campaign 锁也已随上一笔事务放开。挂在这里的
 * 一次性动作,落点正是判官描述的那个窗口。之前那两条测试把闯入点放在「任何一格花钱之前」,
 * 恰好避开了它。
 */
function betweenDispatchedCells(hook: () => Promise<void>) {
  const delegate = prisma.genJob as unknown as Record<string, unknown>;
  const real = (delegate.updateMany as (args: unknown) => Promise<unknown>).bind(delegate);
  const once = async (args: unknown) => {
    delegate.updateMany = real; // 只在第一格之后闯入一次
    const tagged = await real(args);
    await hook();
    return tagged;
  };
  delegate.updateMany = once;
  return () => { if (delegate.updateMany === once) delegate.updateMany = real; };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  mockRequireOwner.mockReset();
  vi.restoreAllMocks();
});

describe("#708 战役确认卡:卡上写的数 == 账本真扣的数", () => {
  it("已生成的条目不再进报价,而账本正好扣了卡上那个数", async () => {
    const world = await seedWorld(200, [
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);

    // 第一趟：两条都是新的，全价。
    const firstQuote = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(firstQuote.quote.totalDisplayCredits).toBe(VID_720_5S + IMG);
    const firstStart = new Date();
    const first = await confirmCampaignGeneration(signed(world, firstQuote));
    if (!("ok" in first)) throw new Error(first.error);
    expect(await reservedThisRun(world.ownerId, firstStart))
      .toBe(firstQuote.quote.totalDisplayCredits * INTERNAL_PER_DISPLAY);

    // 片子真的做完了（worker 结算）。
    const videoJobId = first.result.cells[0].jobId!;
    await workerSettle(world.ownerId, videoJobId);

    // 计划里换掉那张图：片子已经生成过、不再收费；图是全新的。
    await setPlan(world.campaignId, world.ownerId, [
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
      { id: "P2", format: "post", brief: "A brand new still for the feed" },
    ]);
    const balanceBefore = (await account(world.ownerId)).balance;

    const secondQuote = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(secondQuote.quote.lines.map((line) => line.charge)).toEqual(["reused", "new"]);
    expect(secondQuote.quote.totalDisplayCredits).toBe(IMG); // 修前:12

    const secondStart = new Date();
    const second = await confirmCampaignGeneration(signed(world, secondQuote));
    if (!("ok" in second)) throw new Error(second.error);
    expect(second.result).toMatchObject({ dispatched: 1, reused: 1, failed: 0 });

    // 报价 == 实扣：账本这一趟只多了 1 credit 的 RESERVE，余额也只少了 1 credit。
    expect(await reservedThisRun(world.ownerId, secondStart)).toBe(IMG * INTERNAL_PER_DISPLAY);
    const after = await account(world.ownerId);
    expect(balanceBefore - after.balance).toBe(IMG * INTERNAL_PER_DISPLAY);

    // 结算之后仍然是同一个数（settle == reserve == quote）。
    const imageJobId = second.result.cells[1].jobId!;
    await workerSettle(world.ownerId, imageJobId);
    const settled = await account(world.ownerId);
    expect(balanceBefore - settled.balance).toBe(IMG * INTERNAL_PER_DISPLAY);
  });

  it("余额只有 5 credits 的商家买得起那张 1 credit 的新图(修前被 12 credits 挡死)", async () => {
    const world = await seedWorld(5, [
      { id: "V1", format: "reel", brief: "A vertical clip that was already made" },
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);
    // 先把那条片子做出来（用一笔够用的余额），再把余额压到 5。
    await prisma.creditAccount.update({
      where: { orgId: world.ownerId },
      data: { balance: 200 * INTERNAL_PER_DISPLAY },
    });
    const seeded = await quoteFor(world.campaignId, { projectId: world.projectId });
    const seedRun = await confirmCampaignGeneration(signed(world, seeded));
    if (!("ok" in seedRun)) throw new Error(seedRun.error);
    await workerSettle(world.ownerId, seedRun.result.cells[0].jobId!);

    await setPlan(world.campaignId, world.ownerId, [
      { id: "V1", format: "reel", brief: "A vertical clip that was already made" },
      { id: "P2", format: "post", brief: "A brand new still for the feed" },
    ]);
    await prisma.creditAccount.update({
      where: { orgId: world.ownerId },
      data: { balance: 5 * INTERNAL_PER_DISPLAY, reserved: 0 },
    });

    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(quoted.balanceDisplayCredits).toBe(5);
    expect(quoted.quote.totalDisplayCredits).toBe(IMG);
    expect(quoted.quote.totalDisplayCredits).toBeLessThanOrEqual(quoted.balanceDisplayCredits);

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, quoted));
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(1);
    expect(await reservedThisRun(world.ownerId, start)).toBe(IMG * INTERNAL_PER_DISPLAY);
  });
});

// ---------------------------------------------------------------------------
// #708 修复轮 P1-1 —— 全真账本:交付缩水时,一分钱都不许离开余额
// ---------------------------------------------------------------------------
describe("#708 修复轮 P1-1 全真账本:少付不等于少交付", () => {
  it("复核之后掉队的条目:账本 RESERVE 增量 0、余额与预扣不变、GenJob 数不变", async () => {
    const world = await seedWorld(200, [
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);

    // ① 商家在这一页复核:两条都会交付,片子 720p,合计 12。
    const reviewed = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(reviewed.quote.totalDisplayCredits).toBe(VID_720_5S + IMG);
    expect(reviewed.quote.lines.map((line) => line.charge)).toEqual(["new", "new"]);

    // ② 另一个标签页先按 480p 确认了同一份计划 —— 片子被冻结在 480p;
    //    那张图这一趟没做成,worker 走自己的退款路把它退了并置 FAILED。
    const otherTab = await quoteFor(world.campaignId, { projectId: world.projectId, videoSpec: SPEC_480 });
    const other = await confirmCampaignGeneration(signed(world, otherTab, { videoSpec: SPEC_480 }));
    if (!("ok" in other)) throw new Error(other.error);
    await workerRefund(world.ownerId, other.result.cells[1].jobId!);

    // ③ 回到这一页重算:片子这一条已经不会开始了,图还是新的 —— 总额从 12 掉到 1。
    const now = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(now.quote.lines.map((line) => line.charge)).toEqual(["blocked", "new"]);
    expect(now.quote.totalDisplayCredits).toBe(IMG);
    // 内容一个字没改 —— 旧的两道闸(总额上限、内容指纹)都拦不住它。
    expect(now.quote.contentFingerprint).toBe(reviewed.quote.contentFingerprint);
    expect(now.quote.deliveryFingerprint).not.toBe(reviewed.quote.deliveryFingerprint);

    const before = await account(world.ownerId);
    const jobsBefore = await jobCount(world.ownerId);
    const start = new Date();

    const res = await confirmCampaignGeneration(signed(world, reviewed));

    // 先看账本 —— 这条断言先红,红出来的就是「修前真的花掉了多少」。
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    const after = await account(world.ownerId);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(before.reserved);
    expect(await jobCount(world.ownerId)).toBe(jobsBefore);
    expect("error" in res && res.error).toMatch(/can no longer be created as reviewed/i);
  });

  it("合法复用放行:重放同一份签名 —— 派发 0 / 复用 2 / 收 0,交付指纹逐字相同", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
      { id: "P2", format: "post", brief: "A second still for the same feed" },
    ]);
    const reviewed = await quoteFor(world.campaignId, { projectId: world.projectId });
    const request = signed(world, reviewed);

    const first = await confirmCampaignGeneration(request);
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);

    const before = await account(world.ownerId);
    const start = new Date();

    const replay = await confirmCampaignGeneration(request);

    if (!("ok" in replay)) throw new Error(replay.error);
    expect(replay.result).toMatchObject({ dispatched: 0, reused: 2, failed: 0, totalCredits: 0 });
    // 复用照常交付,所以交付面逐字不动 —— 少收放行这条路一格没被收窄。
    expect(replay.quote.deliveryFingerprint).toBe(reviewed.quote.deliveryFingerprint);
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    const after = await account(world.ownerId);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(before.reserved);
    expect(await jobCount(world.ownerId)).toBe(2);
  });
});

describe("#709 选了 480p 的战役:卡上写半价档,账本扣的就是那个数", () => {
  it("480p 的报价、预扣、结算与落库快照是同一档", async () => {
    const world = await seedWorld(200, [
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
    ]);
    const videoSpec = { resolution: "480p", durationSeconds: 5 };

    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId, videoSpec });
    expect(quoted.quote.totalDisplayCredits).toBe(VID_480_5S);
    expect(quoted.quote.lines[0].specChips).toEqual(["9:16", "5s", "480p", "With sound"]);
    expect(quoted.videoMenu.resolutions).toContain("480p");

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, quoted, { videoSpec }));
    if (!("ok" in res)) throw new Error(res.error);

    // 报价 == 预扣。
    expect(await reservedThisRun(world.ownerId, start)).toBe(VID_480_5S * INTERNAL_PER_DISPLAY);

    // 冻结档位：落库快照就是确认时刻那一档（#657 先例）。
    const jobId = res.result.cells[0].jobId!;
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: world.ownerId } });
    expect(job.videoOptions).toMatchObject({ resolution: "480p", seconds: 5, aspectRatio: "9:16" });

    // settle == reserve == quote。
    const before = await account(world.ownerId);
    await workerSettle(world.ownerId, jobId);
    const after = await account(world.ownerId);
    expect(after.reserved).toBe(before.reserved - VID_480_5S * INTERNAL_PER_DISPLAY);
    expect(after.balance).toBe(before.balance); // 预扣时已离开余额，结算不再动它
    expect(200 * INTERNAL_PER_DISPLAY - after.balance).toBe(VID_480_5S * INTERNAL_PER_DISPLAY);
  });

  it("默认档仍是已裁的 720p/5s = 11 credits(半价档是选项,不是新默认)", async () => {
    const world = await seedWorld(200, [
      { id: "V1", format: "reel", brief: "A vertical clip at the default tier" },
    ]);
    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(quoted.quote.totalDisplayCredits).toBe(VID_720_5S);
    expect(quoted.videoMenu.selected).toEqual({ resolution: "720p", durationSeconds: 5 });

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, quoted));
    if (!("ok" in res)) throw new Error(res.error);
    expect(await reservedThisRun(world.ownerId, start)).toBe(VID_720_5S * INTERNAL_PER_DISPLAY);
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r2 P1 —— 锁内复判:签名对得上,不等于花钱那一刻还对得上
// ---------------------------------------------------------------------------
/**
 * 判官 r2 指出的那条缝:确认动作先读一次历史算出报价与交付面(那是**锁外快照**),
 * 几十毫秒之后才一格一格真扣钱。缝里世界会动,而旧的三道闸都只看快照 ——
 *   ① 一单「复用中」的任务恰好失败 → 引擎在锁里改判「新做」并预扣全价,**哪怕商家签的是 0**;
 *   ② 另一个标签页用别的材料占住某一格 → 那一格被挡下,批次照旧继续,已派发的格照收钱。
 * 两条都能让签名逐字对上,实际却超出批准金额或交付缩水。
 *
 * 这两条用**真账本**说话:断言的是 RESERVE 增量与余额/预扣/GenJob 行数,不是任何返回值。
 */
describe("#749 判官 r2 P1 锁内复判:签名之后变了的,一律停在花钱之前", () => {
  it("签的是「复用、收 0」,而那一单在扣费之前失败了:一格不派发,账本 RESERVE 增量 0", async () => {
    const world = await seedWorld(200, [
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
    ]);

    // ① 第一趟真做了一单,它还在跑。
    const firstQuote = await quoteFor(world.campaignId, { projectId: world.projectId });
    const first = await confirmCampaignGeneration(signed(world, firstQuote));
    if (!("ok" in first)) throw new Error(first.error);
    const liveJobId = first.result.cells[0].jobId!;

    // ② 商家回到确认页:这一条只会被复用,卡上写 0 —— 他签的就是 0。
    const reviewed = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(reviewed.quote.lines.map((line) => line.charge)).toEqual(["reused"]);
    expect(reviewed.quote.totalDisplayCredits).toBe(0);

    // ③ 他按下确认之后、这一格真扣钱之前,那一单失败了(worker 走它自己的退款路)。
    whileDispatchWindowOpen(async () => { await workerRefund(world.ownerId, liveJobId); });

    const jobsBefore = await jobCount(world.ownerId);
    const start = new Date();

    const res = await confirmCampaignGeneration(signed(world, reviewed));

    // 先看账本 —— 修前这里会红出「商家签的是 0,账本却少了 11」。
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    const after = await account(world.ownerId);
    // 第一笔预扣已被 worker 退回,余额回到原点、预扣归零 —— 这一趟一分钱都没再动。
    expect(after.balance).toBe(200 * INTERNAL_PER_DISPLAY);
    expect(after.reserved).toBe(0);
    expect(await jobCount(world.ownerId)).toBe(jobsBefore);

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 0, reused: 0, failed: 1, totalCredits: 0 });
    // 结果如实告诉商家哪一格没做成、为什么 —— 不是一句机器码。
    expect(res.result.cells[0].error).toMatch(/wasn't started and wasn't charged/i);
  });

  it("签名之后另一格被别人占住:已派发之前就停,两格都不收钱,账本一行不动", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
      { id: "P2", format: "post", brief: "A second still for the same feed" },
    ]);

    // 商家复核:两条都会交付、都是新的,合计 2。
    const reviewed = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(reviewed.quote.lines.map((line) => line.charge)).toEqual(["new", "new"]);
    expect(reviewed.quote.blockedCount).toBe(0);

    // 他按下确认之后、**第一格**真扣钱之前,别人用完全不同的材料占住了第二格。
    const otherKey = `${stableCellLogicalPrefix(
      deriveCampaignBatchId(world.campaignId, world.projectId),
      "P2",
    )}${"0".repeat(32)}`;
    whileDispatchWindowOpen(async () => {
      await prisma.genJob.create({
        data: {
          id: `gen_${randomUUID()}`,
          ownerId: world.ownerId,
          projectId: world.projectId,
          prompt: "an entirely different picture nobody reviewed",
          model: "seedream",
          kind: "IMAGE",
          count: 1,
          status: "QUEUED",
          idempotencyKey: otherKey,
        },
      });
    });

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, reviewed));

    // 修前:第一格照旧派发并预扣 1,第二格被挡下 —— 交付缩水,钱照收。
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    const after = await account(world.ownerId);
    expect(after.balance).toBe(200 * INTERNAL_PER_DISPLAY);
    expect(after.reserved).toBe(0);
    // 库里只剩别人那一单 —— 这一批一格都没建。
    expect(await jobCount(world.ownerId)).toBe(1);

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 0, failed: 2, totalCredits: 0 });
    expect(res.result.cells[0].error).toMatch(/wasn't started and wasn't charged/i);
  });

  it("世界没变时照旧放行:合法复用仍然是复用,新做仍然新做、扣的还是卡上那个数", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
    ]);

    const reviewed = await quoteFor(world.campaignId, { projectId: world.projectId });
    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, reviewed));
    if (!("ok" in res)) throw new Error(res.error);

    expect(res.result).toMatchObject({ dispatched: 2, reused: 0, failed: 0 });
    expect(await reservedThisRun(world.ownerId, start))
      .toBe(reviewed.quote.totalDisplayCredits * INTERNAL_PER_DISPLAY);

    // 再确认一次:两格都只会被复用,锁内复判同样放行,账本再无增量。
    const again = await quoteFor(world.campaignId, { projectId: world.projectId });
    expect(again.quote.lines.map((line) => line.charge)).toEqual(["reused", "reused"]);
    const second = new Date();
    const replay = await confirmCampaignGeneration(signed(world, again));
    if (!("ok" in replay)) throw new Error(replay.error);
    expect(replay.result).toMatchObject({ dispatched: 0, reused: 2, failed: 0, totalCredits: 0 });
    expect(await reservedThisRun(world.ownerId, second)).toBe(0);
    expect(await jobCount(world.ownerId)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r3 P1 —— 格与格之间的那条缝:批次级承诺要批次级机制
// ---------------------------------------------------------------------------
/**
 * campaign 锁是事务级的,每一格提交时就放开,批次却还在往下派发。两标签页于是能在**格与格
 * 之间**交错:先付掉共用的那一格,再被人占走另一格。判官的定向复现是
 * `dispatched: 1, failed: 1, totalCredits: 10` —— 商家为一份缩水的交付付了钱。
 *
 * 终态只允许两种:**要么整批做完并如数收费,要么一格没开始且一分钱没动**。
 * 禁止态就是判官复现出的那一种:部分扣费 + 交付缩水。
 */
describe("#749 判官 r3 P1 格间交错:终态只有两种,禁止部分扣费+交付缩水", () => {
  type ConfirmResult = Awaited<ReturnType<typeof confirmCampaignGeneration>>;

  /** 两个标签页复核的是同一个战役、同一个项目,只有片子档位不同 —— 于是它们争的是同一格。 */
  async function twoTabs() {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
    ]);
    const at720 = await quoteFor(world.campaignId, { projectId: world.projectId });
    const at480 = await quoteFor(world.campaignId, { projectId: world.projectId, videoSpec: SPEC_480 });
    // 图片那一格两边完全相同(它没有档位),片子那一格两边规格不同 —— 这正是判官的场景。
    expect(at720.quote.lines.map((line) => line.charge)).toEqual(["new", "new"]);
    expect(at480.quote.lines.map((line) => line.charge)).toEqual(["new", "new"]);
    return { world, at720, at480 };
  }

  it("持租的那一批照常做完,闯入的那一次在自己花钱之前被挡住(零扣费)", async () => {
    const { world, at720, at480 } = await twoTabs();
    const intruderResults: ConfirmResult[] = [];
    const intruderStart = new Date();

    // 第一格(图片)扣费已提交、第二格还没开始 —— 判官那条缝。另一个标签页在这里确认。
    betweenDispatchedCells(async () => {
      intruderResults.push(await confirmCampaignGeneration(signed(world, at480, { videoSpec: SPEC_480 })));
    });

    const holderStart = new Date();
    const holder = await confirmCampaignGeneration(signed(world, at720));

    // ① 持租的那一批整批做完 —— 交付没缩水。
    if (!("ok" in holder)) throw new Error(holder.error);
    expect(holder.result).toMatchObject({ dispatched: 2, reused: 0, failed: 0 });
    expect(await reservedThisRun(world.ownerId, holderStart))
      .toBe(at720.quote.totalDisplayCredits * INTERNAL_PER_DISPLAY);

    // ② 闯入的那一次一格都没派发,而且一分钱没动。
    expect(intruderResults).toHaveLength(1);
    const intruder = intruderResults[0]!;
    expect("error" in intruder && intruder.error).toMatch(/still starting its items/i);
    expect(await reservedThisRun(world.ownerId, intruderStart))
      .toBe(at720.quote.totalDisplayCredits * INTERNAL_PER_DISPLAY); // 只有持租那一批的预扣
    expect(await jobCount(world.ownerId)).toBe(2); // 两格,都是持租那一批的
  });

  it("镜像:先认领的是 480p 那一批,720p 那次整批失败且零扣费", async () => {
    const { world, at720, at480 } = await twoTabs();
    const intruderResults: ConfirmResult[] = [];

    betweenDispatchedCells(async () => {
      intruderResults.push(await confirmCampaignGeneration(signed(world, at720)));
    });

    const holderStart = new Date();
    const holder = await confirmCampaignGeneration(signed(world, at480, { videoSpec: SPEC_480 }));

    if (!("ok" in holder)) throw new Error(holder.error);
    expect(holder.result).toMatchObject({ dispatched: 2, reused: 0, failed: 0 });
    expect(await reservedThisRun(world.ownerId, holderStart))
      .toBe(at480.quote.totalDisplayCredits * INTERNAL_PER_DISPLAY);

    expect(intruderResults).toHaveLength(1);
    const intruder = intruderResults[0]!;
    expect("error" in intruder && intruder.error).toMatch(/still starting its items/i);
    expect(await jobCount(world.ownerId)).toBe(2);
    // 片子那一格冻结的是**持租那一批**签的档 —— 没有半份交付。
    const video = await prisma.genJob.findFirstOrThrow({
      where: { ownerId: world.ownerId, id: holder.result.cells[1].jobId! },
    });
    expect(video.videoOptions).toMatchObject({ resolution: "480p", seconds: 5 });
  });

  it("租约归还之后照常放行 —— 它挡的是「正在派发」,不是「这个战役」", async () => {
    const { world, at720, at480 } = await twoTabs();

    const first = await confirmCampaignGeneration(signed(world, at720));
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);

    // 上一批已经归还租约。另一个标签页现在确认:它不会被租约挡住 —— 会被**交付面**挡住,
    // 因为片子那一格已经用别的档做过了。停在花钱之前,零扣费。
    const start = new Date();
    const later = await confirmCampaignGeneration(signed(world, at480, { videoSpec: SPEC_480 }));

    expect("error" in later && later.error).not.toMatch(/still starting its items/i);
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    expect(await jobCount(world.ownerId)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r3 P1 —— 租约的过期与归还:失效方向只能是「更保守」
// ---------------------------------------------------------------------------
/**
 * 租约挡的是「另一次派发正在进行」。它一定会有失效的时候(进程崩了、归还写失败),所以要证
 * 的不是「永不失效」,而是**每一种失效都往保守那一侧倒**:
 *   - 残留的租约 ⇒ 下一次确认被挡住(最多让商家重新确认一次),绝不放行任何一笔钱;
 *   - 租约老死 ⇒ 商家能继续用,不需要人工介入 —— 否则一次崩溃就把这个战役永久钉死。
 */
describe("#749 判官 r3 P1 租约的过期与归还", () => {
  /** 直接改这一行的 status/updatedAt。Prisma 的 @updatedAt 会覆盖写入值,所以走原生 SQL。 */
  async function forceLease(batchId: string, status: string, ageMs: number) {
    await prisma.$executeRawUnsafe(
      `UPDATE "GenerationBatch" SET "status" = $1, "updatedAt" = now() - ($2 || ' milliseconds')::interval WHERE "id" = $3`,
      status,
      String(ageMs),
      batchId,
    );
  }

  async function batchRow(ownerId: string, batchId: string) {
    return prisma.generationBatch.findFirstOrThrow({ where: { id: batchId, ownerId } });
  }

  it("活性判据:闲置与认不出来的值都不算租约,自己的租约过了时限也不算", () => {
    const now = Date.now();
    const fresh = new Date(now - 1_000);
    const stale = new Date(now - CAMPAIGN_DISPATCH_LEASE_MS - 1_000);

    expect(campaignDispatchLeaseHolder({ status: BATCH_IDLE_STATUS, updatedAt: fresh }, now)).toBeNull();
    expect(campaignDispatchLeaseHolder({ status: "dispatching:att-1", updatedAt: fresh }, now)).toBe("att-1");
    // 过了时限 —— 崩掉的那次派发不该把战役永久钉死。
    expect(campaignDispatchLeaseHolder({ status: "dispatching:att-1", updatedAt: stale }, now)).toBeNull();
    // 认不出来的值当作没有租约:唯一的写入者是这个模块,而把陌生值读成「有人占着」会永久
    // 钉死这个战役 —— 那比让商家重新确认一次严重得多。钱那一侧的 fail-closed 靠「认领失败
    // 即整批拒绝」,不靠这一行。
    expect(campaignDispatchLeaseHolder({ status: "whatever", updatedAt: fresh }, now)).toBeNull();
  });

  it("残留的租约挡住下一次确认,而且一分钱都没动(保守方向)", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);
    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });
    const batchId = deriveCampaignBatchId(world.campaignId, world.projectId);

    // 上一次派发崩在半路:分组行留下了一把没人归还的租约,而且它还很新。
    await prisma.generationBatch.create({
      data: { id: batchId, ownerId: world.ownerId, projectId: world.projectId, name: "crashed run" },
    });
    await forceLease(batchId, "dispatching:ghost-attempt", 1_000);

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, quoted));

    expect("error" in res && res.error).toMatch(/still starting its items/i);
    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    expect(await jobCount(world.ownerId)).toBe(0);
  });

  it("租约老死之后商家照常能做 —— 一次崩溃不会把这个战役永久钉死", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);
    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });
    const batchId = deriveCampaignBatchId(world.campaignId, world.projectId);
    await prisma.generationBatch.create({
      data: { id: batchId, ownerId: world.ownerId, projectId: world.projectId, name: "crashed run" },
    });
    await forceLease(batchId, "dispatching:ghost-attempt", CAMPAIGN_DISPATCH_LEASE_MS + 5_000);

    const start = new Date();
    const res = await confirmCampaignGeneration(signed(world, quoted));

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(1);
    expect(await reservedThisRun(world.ownerId, start)).toBe(IMG * INTERNAL_PER_DISPLAY);
  });

  it("派发结束就归还,而且只归还自己那一把", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
    ]);
    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });
    const batchId = deriveCampaignBatchId(world.campaignId, world.projectId);

    const res = await confirmCampaignGeneration(signed(world, quoted));
    if (!("ok" in res)) throw new Error(res.error);
    // 做完了 ⇒ 这一行回到闲置,下一次确认不必等它老死。
    expect((await batchRow(world.ownerId, batchId)).status).toBe(BATCH_IDLE_STATUS);

    // 别人的租约不许被这一批的归还顺手清掉:再确认一次(全复用、零扣费),中途把租约换成
    // 别人的,归还只匹配自己那把 token,所以它必须原封不动。
    const replay = await quoteFor(world.campaignId, { projectId: world.projectId });
    betweenDispatchedCells(async () => { await forceLease(batchId, "dispatching:someone-else", 1_000); });
    const start = new Date();
    const second = await confirmCampaignGeneration(signed(world, replay));

    expect(await reservedThisRun(world.ownerId, start)).toBe(0);
    expect((await batchRow(world.ownerId, batchId)).status).toBe("dispatching:someone-else");
    expect(second).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r4 —— 钱一落地就续租:提交之后的收尾不再拿着一把正在老化的租约
// ---------------------------------------------------------------------------
/**
 * 判官 r4 的残余:租约原本只在**下一格钱事务开头**才续。首格提交之后还有一段没有硬上限的
 * 收尾 —— 审计写、缓存失效、批次标记、下一格的历史读 —— 全程拿着一把正在老化的租约。
 * 持有者若在这里被暂停超过 TTL,闯入者就能接管,老持有者恢复后第二格冲突。
 *
 * 修法是把窗口压到最小(不是消灭这个竞态 —— 那属钱路重构,已登记 #359):**提交的那一刻**
 * 就续一次。证据要能分辨「续在事务开头」与「续在提交之后」,所以断言看的是:批次往下走
 * 之前,顶层客户端上是否已经发生过一次租约写,而且那一次**看得见已提交的扣费** ——
 * 看得见就说明它发生在提交之后,不是事务开头那一次(事务里的写走的是事务客户端,而且
 * 那时任务还没提交,别的连接看不见)。
 */
describe("#749 判官 r4 钱一落地就续租", () => {
  /** 记录**顶层客户端**上的每一次租约写,以及写的那一刻库里有没有已提交的扣费。 */
  function recordTopLevelLeaseWrites(ownerId: string) {
    const delegate = prisma.generationBatch as unknown as Record<string, unknown>;
    const real = (delegate.updateMany as (args: unknown) => Promise<unknown>).bind(delegate);
    const sawCommittedJob: boolean[] = [];
    delegate.updateMany = async (args: unknown) => {
      sawCommittedJob.push((await prisma.genJob.count({ where: { ownerId } })) > 0);
      return real(args);
    };
    return { sawCommittedJob, restore: () => { delegate.updateMany = real; } };
  }

  it("首格提交之后、批次往下走之前,租约已经被续过一次", async () => {
    const world = await seedWorld(200, [
      { id: "P1", format: "post", brief: "A festive product still for the feed" },
      { id: "V1", format: "reel", brief: "A vertical clip of the Raya collection" },
    ]);
    const quoted = await quoteFor(world.campaignId, { projectId: world.projectId });

    const writes = recordTopLevelLeaseWrites(world.ownerId);
    let atMoveOn: { count: number; allSawJob: boolean } | null = null;
    // 首格已提交、已打上批次标记,批次正要走向第二格 —— 判官说的那段收尾就从这里开始。
    betweenDispatchedCells(async () => {
      atMoveOn = {
        count: writes.sawCommittedJob.length,
        allSawJob: writes.sawCommittedJob.every(Boolean),
      };
    });

    let res;
    try {
      res = await confirmCampaignGeneration(signed(world, quoted));
    } finally {
      writes.restore();
    }

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 2, failed: 0 });

    expect(atMoveOn).not.toBeNull();
    // 修前:顶层客户端上一次租约写都还没发生(只有整批结束后的归还),这里是 0 —— 必红。
    expect(atMoveOn!.count).toBeGreaterThanOrEqual(1);
    // 而且那一次写看得见已提交的扣费 —— 它发生在提交之后,不是事务开头那一次。
    expect(atMoveOn!.allSawJob).toBe(true);
  });
});
