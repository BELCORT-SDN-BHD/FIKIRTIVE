/**
 * 图片动作防重复扣钱(幂等加固)—— 规格 `docs/specs/asset-action-idempotency.md`
 * (已冻结 · v1,#1368)的验收证据,票 #1375,修的洞是 #1045 的两个 P1。
 *
 * 这个文件钉的是验收表里的 ASSET-A1 / A2 / A5 / A6 / A7 / A8 / A9 / A10。
 * 另外两行(ASSET-A3「终态之后的重放拿回原单」与 ASSET-A4「再按一次是新的一单」)住在
 * `asset-idempotency-ledger.test.ts` —— 它们是那个文件里那条旧口径绿测试的原地改写,
 * 规格 §1.4 点名要改的就是那一段,所以证据留在原处而不是搬家。
 *
 * 跑在真 Postgres(*_test)、真 Prisma、真积分台账上;只有 web 层的周边是假件
 * (auth guard、impersonation、队列、guardian、机型开关、next/cache),与
 * `asset-idempotency-ledger.test.ts` / `gen-ledger.test.ts` 同一套。零 provider 调用,
 * 零真实花费。worker 的两种终态都用 worker 自己调的那两个函数模拟:成功走
 * `settleCredits`,失败走 `refundReservation`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, ASSET_ANCHOR_NOT_IN_WORKSPACE } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startAssetGen, getActiveGenModels } = await import("../gen-actions");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // 一张图 = 1 显示 credit = 10 内部

// 引擎名从来不出浏览器:四个付费入口送的都是 `getActiveGenModels()` 回的公开别名。
const ACTIVE = await getActiveGenModels();
const IMAGE_ALIAS = ACTIVE.image;

// ── real-DB helpers ──────────────────────────────────────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "ASSET idempotency acceptance" } });
  return id;
}
/** 一张真的在这个租户工作区里的图 —— 面板上的锚点只能是它。 */
async function seedAnchor(ownerId: string, projectId: string): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, ""),
      ext: "jpg",
      mime: "image/jpeg",
      sizeBytes: BigInt(100_000),
      source: "GENERATED",
    },
  });
  const genId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: genId,
      ownerId,
      projectId,
      shotId: null,
      assetId,
      source: "GENERATED",
      promptText: "nasi lemak plate, window light",
      entitySnapshot: { entities: [] },
    },
  });
  return genId;
}
async function ledgerRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
async function reserveRows(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId, kind: "RESERVE" }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({
    where: { ownerId, projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, idempotencyKey: true },
  });
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
/** worker 的成功终态,走 worker 自己调的那个函数。 */
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
/** worker 的失败终态:钱退回去、任务落 FAILED —— 同样走 worker 自己调的那个函数。 */
async function workerFail(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId, reason: "provider failed" }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "FAILED", finishedAt: new Date() } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
function idOf(res: Awaited<ReturnType<typeof startAssetGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}
/** 浏览器那一次按下出的意图编号(`asset-action-intent.ts` 的 `beginAssetIntent`)。 */
function newIntentId(): string {
  return randomUUID();
}

/** 面板 `handleRegen` 送出去的那一份请求体,逐字同形(DetailPanel.tsx)。 */
function regenIntent(projectId: string, anchorGenId: string, intentId: string, over: Record<string, unknown> = {}) {
  return {
    expectedCredits: 1,
    assetOp: "regen",
    assetAnchorGenerationId: anchorGenId,
    assetIntentId: intentId,
    projectId,
    prompt: "nasi lemak plate, window light",
    entityIds: [],
    count: 1,
    kind: "image",
    model: IMAGE_ALIAS,
    aspectRatio: "1:1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 锚点归属(规格 §1.4 改动一) ───────────────────────────────────────────────
describe("锚点归属:客户端送来的编号必须在当前工作区里查得到", () => {
  it("ASSET-A1 请求里的 assetAnchorGenerationId 被换成另一个商家的图 ⇒ 拒收并说 \"That image isn't available in this workspace.\";零新 GenJob、账本零新行、余额不变", async () => {
    // 双租户:两个商家各自有自己的组织、项目和图。
    const ownerA = await seedOrg(1000);
    const projectA = await seedProject(ownerA);
    const anchorA = await seedAnchor(ownerA, projectA);
    const ownerB = await seedOrg(1000);
    const projectB = await seedProject(ownerB);
    const anchorB = await seedAnchor(ownerB, projectB);

    // 商家 A 把锚点换成商家 B 的一张图。
    asOwner(ownerA);
    const stolen = await startAssetGen(regenIntent(projectA, anchorB, newIntentId()));
    expect(stolen).toEqual({ error: ASSET_ANCHOR_NOT_IN_WORKSPACE });
    expect(ASSET_ANCHOR_NOT_IN_WORKSPACE).toBe("That image isn't available in this workspace.");

    // 反方向同样挡住 —— 这条边界不是单向的。
    asOwner(ownerB);
    const reverse = await startAssetGen(regenIntent(projectB, anchorA, newIntentId()));
    expect(reverse).toEqual({ error: ASSET_ANCHOR_NOT_IN_WORKSPACE });

    // 两边都是 $0:没有任务、没有账本行、余额一分没动。
    for (const [ownerId, projectId] of [[ownerA, projectA], [ownerB, projectB]] as const) {
      expect(await jobs(ownerId, projectId)).toHaveLength(0);
      expect(await ledgerRows(ownerId)).toHaveLength(0);
      expect((await account(ownerId)).balance).toBe(1000);
      expect((await account(ownerId)).reserved).toBe(0);
    }
  });

  it("ASSET-A1 编造一个根本不存在的锚点 ⇒ 同一句拒绝、同样 $0(fail closed,不回落成「没有锚点就照做」)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const result = await startAssetGen(regenIntent(projectId, `gen_${randomUUID()}`, newIntentId()));

    expect(result).toEqual({ error: ASSET_ANCHOR_NOT_IN_WORKSPACE });
    expect(await jobs(ownerId, projectId)).toHaveLength(0);
    expect(await ledgerRows(ownerId)).toHaveLength(0);
    expect((await account(ownerId)).balance).toBe(1000);
  });

  it("ASSET-A2 商家对自己工作区里的图按 Regenerate ⇒ 正常出一单、余额扣一次(锚点检查不误伤合法动作)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    const started = idOf(await startAssetGen(regenIntent(projectId, anchor, newIntentId())));

    expect(started.disposition).toBe("fresh");
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    const rows = await reserveRows(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reservedDelta).toBe(IMG);
    expect((await account(ownerId)).balance).toBe(1000 - IMG);
  });

  it("ASSET-A2 同一个商家的另一个项目里的图也算「本工作区」⇒ 照做(租户边界是 owner,不是 project)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectA = await seedProject(ownerId);
    const projectB = await seedProject(ownerId);
    const anchorInB = await seedAnchor(ownerId, projectB);

    const started = idOf(await startAssetGen(regenIntent(projectA, anchorInB, newIntentId())));

    expect(started.disposition).toBe("fresh");
    expect(await jobs(ownerId, projectA)).toHaveLength(1);
  });
});

// ── 重放 vs 再按一次(规格 §1.4 改动二 + 改动三) ──────────────────────────────
describe("断线重连:提交还在飞的时候重发", () => {
  it("ASSET-A5 生成中(QUEUED)原样重发同一次提交 ⇒ 回到同一单、只有一条进度、账本零新行", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);
    const intentId = newIntentId();

    const first = idOf(await startAssetGen(regenIntent(projectId, anchor, intentId)));
    const live = await jobs(ownerId, projectId);
    expect(live[0]!.status, "这一单还在跑").toBe("QUEUED");
    const held = await account(ownerId);

    // 页面重连后自动重发:编号还在(上一次提交没落地),所以是同一把键。
    const resent = idOf(await startAssetGen(regenIntent(projectId, anchor, intentId)));

    expect(resent.id).toBe(first.id);
    expect(resent.disposition).toBe("reused");
    expect(await jobs(ownerId, projectId), "页面上只有一条进度条").toHaveLength(1);
    expect(await reserveRows(ownerId)).toHaveLength(1);
    expect(await account(ownerId)).toMatchObject({ balance: held.balance, reserved: held.reserved });
  });
});

describe("数据库那一道:跨终态唯一索引", () => {
  it("ASSET-A6 第一单已 DONE,同一把 asset: 键再落一次库 ⇒ 被唯一索引挡掉,零新 GenJob、$0", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    const first = idOf(await startAssetGen(regenIntent(projectId, anchor, newIntentId())));
    await workerSettle(ownerId, first.id);
    const [done] = await jobs(ownerId, projectId);
    const key = done!.idempotencyKey!;
    const before = await account(ownerId);

    // 应用层的复用读与建行之间不是原子的(TOCTOU):两个请求都读到「可以建」,第一个先
    // 跑完 DONE,第二个才插入。这里直接模拟那个插入 —— 索引必须自己挡住它。
    await expect(
      prisma.genJob.create({
        data: {
          id: `gj_${randomUUID()}`,
          ownerId,
          projectId,
          prompt: "nasi lemak plate, window light",
          model: "seedream",
          kind: "IMAGE",
          count: 1,
          idempotencyKey: key,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect(await reserveRows(ownerId)).toHaveLength(1);
    expect(await account(ownerId)).toMatchObject({ balance: before.balance, reserved: before.reserved });
  });

  it("ASSET-A6 并发两次同一意图的提交(项目锁 + 唯一索引两道合起来)⇒ 一单一扣", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);
    const intentId = newIntentId();

    const [a, b] = await Promise.all([
      startAssetGen(regenIntent(projectId, anchor, intentId)),
      startAssetGen(regenIntent(projectId, anchor, intentId)),
    ]);

    expect(idOf(a).id).toBe(idOf(b).id);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect(await reserveRows(ownerId)).toHaveLength(1);
  });
});

// ── 钱守恒 ───────────────────────────────────────────────────────────────────
describe("钱守恒", () => {
  it("ASSET-A7 跑完 A3(终态重放)、A4(再按一次)、A5(在途重发)之后对账:余额减少量 = 账本净额 = 实际生成次数 × 单价,无悬挂 reserve、无重复 settle", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    // ① 第一次按下 → 跑完(worker 结算)。
    const intent1 = newIntentId();
    const first = idOf(await startAssetGen(regenIntent(projectId, anchor, intent1)));
    await workerSettle(ownerId, first.id);
    // ② A3:终态之后原样重发同一次提交 —— 不该动一分钱。
    expect(idOf(await startAssetGen(regenIntent(projectId, anchor, intent1))).id).toBe(first.id);
    // ③ A4:商家再按一次 —— 真的再来一张。
    const intent2 = newIntentId();
    const second = idOf(await startAssetGen(regenIntent(projectId, anchor, intent2)));
    expect(second.id).not.toBe(first.id);
    // ④ A5:这一单还在跑的时候断线重发 —— 同样不该动钱。
    expect(idOf(await startAssetGen(regenIntent(projectId, anchor, intent2))).id).toBe(second.id);
    await workerSettle(ownerId, second.id);

    // 实际生成次数 = 2(两次按下),不是 4 次提交。
    const realGenerations = 2;
    const rows = await ledgerRows(ownerId);
    const acct = await account(ownerId);

    // (a) 余额减少量 = 实际生成次数 × 单价。
    expect(1000 - acct.balance).toBe(realGenerations * IMG);
    // (b) 账本是余额与预留的唯一权威:两个字段都必须等于各自的净额。
    expect(acct.balance).toBe(1000 + rows.reduce((sum, r) => sum + r.balanceDelta, 0));
    expect(acct.reserved).toBe(rows.reduce((sum, r) => sum + r.reservedDelta, 0));
    // (c) 无悬挂 reserve:每一行 RESERVE 都被结清,预留归零。
    expect(acct.reserved).toBe(0);
    const reserves = rows.filter((r) => r.kind === "RESERVE");
    expect(reserves).toHaveLength(realGenerations);
    // (d) 无重复 settle:每一单最多一条 SETTLE。
    const settles = rows.filter((r) => r.kind === "SETTLE");
    expect(settles).toHaveLength(realGenerations);
    expect(new Set(settles.map((r) => r.refId)).size).toBe(realGenerations);
    // (e) 提交了四次,只建了两单。
    expect(await jobs(ownerId, projectId)).toHaveLength(realGenerations);
  });

  it("ASSET-A8 一单 FAILED(钱已退)后商家按一次重试 ⇒ 新的一单、扣一次钱;余额与账本对得上,退款那一行既不被抵消也不重复", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    const failed = idOf(await startAssetGen(regenIntent(projectId, anchor, newIntentId())));
    await workerFail(ownerId, failed.id);
    // 退款之后余额回到原位、预留归零。
    expect(await account(ownerId)).toMatchObject({ balance: 1000, reserved: 0 });

    // 商家按一次重试 = 一次新的按下 = 新编号。
    const retry = idOf(await startAssetGen(regenIntent(projectId, anchor, newIntentId())));
    expect(retry.id).not.toBe(failed.id);
    expect(retry.disposition).toBe("fresh");
    await workerSettle(ownerId, retry.id);

    const rows = await ledgerRows(ownerId);
    const acct = await account(ownerId);
    expect(rows.filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "SETTLE")).toHaveLength(1);
    expect(acct.balance).toBe(1000 + rows.reduce((sum, r) => sum + r.balanceDelta, 0));
    // 一次失败(退光)+ 一次成功(扣一次)⇒ 净扣一次。
    expect(1000 - acct.balance).toBe(IMG);
    expect(acct.reserved).toBe(0);
  });
});

// ── Otto 那一面(规格 §1.9) ──────────────────────────────────────────────────
describe("Otto 模板窗:与人工面板共用同一层,所以自动继承同一条规矩", () => {
  it("ASSET-A9 模板动作发起后原样重发同一次提交 ⇒ 与 ASSET-A3 一致:命中原单、账本零新行", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);
    const intentId = newIntentId();

    const templateRun = () => ({
      expectedCredits: 1,
      assetOp: "template",
      assetAnchorGenerationId: anchor,
      assetIntentId: intentId,
      projectId,
      kind: "image",
      sourceGenerationId: anchor,
      prompt: "marketplace main image, clean white background",
      entityIds: [],
      count: 1,
      model: IMAGE_ALIAS,
      aspectRatio: "1:1",
    });

    const first = idOf(await startAssetGen(templateRun()));
    // 跑完之后再重发一次 —— 终态也要命中原单(这正是 #1045 那个 P1 的形状)。
    await workerSettle(ownerId, first.id);
    const settled = await account(ownerId);
    const resent = idOf(await startAssetGen(templateRun()));

    expect(resent.id).toBe(first.id);
    expect(resent.disposition).toBe("reused");
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect(await reserveRows(ownerId)).toHaveLength(1);
    expect(await account(ownerId)).toMatchObject({ balance: settled.balance, reserved: settled.reserved });
    const [job] = await jobs(ownerId, projectId);
    expect(job!.idempotencyKey).toMatch(/^asset:template:[0-9a-f]{64}$/);
  });
});

// ── 迁移(规格 §1.4 改动三 / ASSET-A10) ──────────────────────────────────────
describe("迁移:全新数据库", () => {
  it("ASSET-A10 在全新数据库上跑完迁移 ⇒ 跨终态唯一索引存在且谓词是 LIKE 'asset:%'", async () => {
    // 这个测试库就是「全新数据库」:CI 的 tests 作业先 `prisma migrate deploy` 到一个空库,
    // 再跑这一条。索引是从迁移来的,不是从测试来的 —— 所以它同时证明迁移真的应用成功了。
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'GenJob_asset_idempotency_once'`,
    );
    expect(rows, "GenJob_asset_idempotency_once 必须存在").toHaveLength(1);
    const def = rows[0]!.indexdef;
    expect(def).toContain("UNIQUE");
    expect(def).toContain(`"ownerId", "projectId", "idempotencyKey"`);
    // Postgres 把 LIKE 存成 `~~`。谓词必须覆盖**全部状态**(里面不许出现 status 条件),
    // 否则终态之后的重放又会挤进来。
    expect(def).toContain("'asset:%'");
    expect(def).not.toContain("status");
  });

  it("ASSET-A10 同一个全新数据库上 ASSET-A3 与 ASSET-A4 两条验收行为一致", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    // A3:跑完之后原样重发 ⇒ 原单、零新行。
    const intentId = newIntentId();
    const first = idOf(await startAssetGen(regenIntent(projectId, anchor, intentId)));
    await workerSettle(ownerId, first.id);
    expect(idOf(await startAssetGen(regenIntent(projectId, anchor, intentId))).id).toBe(first.id);
    expect(await reserveRows(ownerId)).toHaveLength(1);

    // A4:再按一次 ⇒ 新的一单、第二行 RESERVE。
    const again = idOf(await startAssetGen(regenIntent(projectId, anchor, newIntentId())));
    expect(again.id).not.toBe(first.id);
    expect(await reserveRows(ownerId)).toHaveLength(2);
    expect((await account(ownerId)).balance).toBe(1000 - 2 * IMG);
  });
});

// ── 意图编号本身的纪律 ───────────────────────────────────────────────────────
describe("意图编号:算不出键就不许花钱", () => {
  it("ASSET-A3 意图编号缺席 / 空串 / 超长 ⇒ 一律出界,零建单、零预扣(不许悄悄给它一个缺省值)", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const anchor = await seedAnchor(ownerId, projectId);

    const bads: Record<string, unknown>[] = [
      { assetIntentId: undefined },
      { assetIntentId: "" },
      { assetIntentId: 1 },
      { assetIntentId: "i".repeat(129) },
    ];
    for (const bad of bads) {
      const result = await startAssetGen({ ...regenIntent(projectId, anchor, newIntentId()), ...bad });
      expect(result).toEqual({ error: "That generation request is out of bounds." });
    }
    expect(await jobs(ownerId, projectId)).toHaveLength(0);
    expect(await ledgerRows(ownerId)).toHaveLength(0);
    expect((await account(ownerId)).balance).toBe(1000);
  });
});
