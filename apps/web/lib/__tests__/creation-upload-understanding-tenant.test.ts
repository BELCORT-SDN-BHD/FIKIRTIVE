/**
 * creation-upload-understanding-tenant —— 上传理解费那条**新读路**的租户边界，用真库钉。
 *
 * 规格 `docs/specs/creation-engine.md` §5 :169（FSE-009，Founder 2026-09-10 裁 #1307：上传素材
 * 的费用只显示含理解费的合计，不拆行）。追溯落在那条变更登记行上，不认领任何 CREATE- 编号
 * （理由与本片其余测试同一把尺子，见 PR 描述）。
 *
 * 判官第 3 轮 P2-f —— 已有的那一份（`creation-upload-understanding-cost.test.ts`）把 prisma 整个
 * 替身掉，所以它证明的是「查询语句里写了 ownerId」，不是「换一个租户真的看不到」。而这条读路
 * 恰好**两道护栏一道都没有**：`getGenerationLineage` 不在 `runAsUser` 帧里（身份靠每一条
 * where 自己带 ownerId），`CreditLedger` 也不在 `TENANT_MODELS`（`packages/db` 的 tenant guard
 * 不会替它补条件）。所以这一份换成**真 Postgres**：租户 A 上传的那件素材上真有一笔理解费，
 * 租户 B 无论从哪一面看都看不到它。
 *
 * 纯读、零写钱路：这里不预扣、不结算、不退款，账本行是直接插进去的固定夹具。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../storage", () => ({
  storage: { put: vi.fn(), get: vi.fn(), del: vi.fn(), url: () => "" },
  extFromFilename: () => "png",
  mimeOf: () => "image/png",
  kindOf: () => "image",
}));
vi.mock("../queue", () => ({ getBoss: vi.fn() }));

const { loadUploadUnderstandingCredits } = await import("../canvas-lineage-data");
const { getGenerationLineage } = await import("../actions");
const { prisma } = await import("@fikirtive/db");

type Tenant = { ownerId: string; projectId: string; generationId: string; assetId: string };

/** 一个租户：一件上传素材、一张 Generation 行。`understandingInternal` 非 0 时,
 *  那件素材上再挂一行自动理解与它那一笔真账本(reserve + settle)。 */
async function seedTenant(understandingInternal: number): Promise<Tenant> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Uploads" } });
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, ""),
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(1024),
      source: "UPLOAD",
    },
  });
  const generationId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: generationId,
      ownerId,
      projectId,
      assetId,
      source: "UPLOAD",
      entitySnapshot: { entities: [] },
    },
  });
  if (understandingInternal !== 0) {
    const understandingId = `au_${randomUUID()}`;
    const refId = `understanding:${understandingId}`;
    await prisma.assetUnderstanding.create({
      data: { id: understandingId, ownerId, assetId, kind: "image-caption", status: "DONE", moneyRefId: refId },
    });
    await prisma.creditLedger.createMany({
      data: [
        {
          id: `led_${randomUUID()}`,
          orgId: ownerId,
          balanceDelta: -understandingInternal,
          reservedDelta: understandingInternal,
          kind: "RESERVE",
          refId,
          idempotencyKey: `reserve:${refId}`,
        },
        {
          id: `led_${randomUUID()}`,
          orgId: ownerId,
          balanceDelta: 0,
          reservedDelta: -understandingInternal,
          kind: "SETTLE",
          refId,
          idempotencyKey: `settle:${refId}`,
        },
      ],
    });
  }
  return { ownerId, projectId, generationId, assetId };
}

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  // A 上传了一张图,自动理解扣过 1 internal credit(= 0.1 显示 credit)。B 什么都没被读过。
  a = await seedTenant(1);
  b = await seedTenant(0);
});

describe("creation §5 :169 FSE-009 上传理解费的租户边界(真库)", () => {
  it("creation §5 :169 FSE-009 真库双租户:B 拿 A 的 generation 去问费用合计,折出 0 —— 看不到 A 那一笔", async () => {
    // 先证明这笔钱在 A 名下**确实存在** —— 否则下面那个 0 只是「本来就没有」。
    const asOwner = await loadUploadUnderstandingCredits(a.ownerId, [{ id: a.generationId, assetId: a.assetId, mime: "image/png" }]);
    // FSE-203:理解行已经 DONE(终态),这个数是已结清的事实,不是未定论。
    expect(asOwner.get(a.generationId)).toEqual({ creditsCharged: 0.1, pending: false });

    // 同一件素材、同一行 generation,换成 B 的身份去问 —— B 的查询天然看不到 A 名下那一行
    // 理解,折不出 A 的真实数字,一分钱都不泄漏(FSE-203 之后仍是这条不变量)。
    const asOtherTenant = await loadUploadUnderstandingCredits(b.ownerId, [{ id: a.generationId, assetId: a.assetId, mime: "image/png" }]);
    expect(asOtherTenant.get(a.generationId)?.creditsCharged, "越租户读出了 A 的真实数字").toBe(0);
  });

  it("creation §5 :169 FSE-009 真库双租户:B 打开 A 那件上传的资产详情,连血缘都读不到", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: a.ownerId, email: `${a.ownerId}@fikirtive.test` });
    const own = await getGenerationLineage(a.generationId);
    expect("error" in own ? own.error : own.costCredits).toBe(0.1);

    mockRequireOwner.mockResolvedValue({ ownerId: b.ownerId, email: `${b.ownerId}@fikirtive.test` });
    const across = await getGenerationLineage(a.generationId);
    // 越租户读不出这一行本身 —— 费用那一格连算的机会都没有。
    expect(across).toEqual({ error: "Not found." });
  });

  it("creation §5 :169 FSE-009 真库:B 自己那件从没被读过的上传,费用仍是 0(不是「未知」)", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: b.ownerId, email: `${b.ownerId}@fikirtive.test` });
    const lineage = await getGenerationLineage(b.generationId);
    expect("error" in lineage ? lineage.error : lineage.costCredits).toBe(0);
  });
});
