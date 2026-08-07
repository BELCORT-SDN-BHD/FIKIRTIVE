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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  mockRequireOwner.mockReset();
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
