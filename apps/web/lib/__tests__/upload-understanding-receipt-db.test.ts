/**
 * 上传理解回执的**读路**,用真库钉(Founder 2026-09-16 裁决,规格
 * `docs/specs/money-engine.md` §5 2026-09-16 行)。
 *
 * 展示那一半在 `upload-understanding-receipt.test.tsx`(两面各跑一遍,纯 jsdom)。这一份只
 * 回答展示那一半问不出来的那个问题:**面板拿到的那三格,是不是真的从账本与理解行读出来的**。
 * 兄弟票 FSE-009 的真库证据(`creation-upload-understanding-tenant.test.ts`)已经钉过租户
 * 边界与金额,这里补的是回执新加的两格:
 *   ① `costIsUnderstanding` —— 这一笔费用是不是自动理解(而不是一单付费生成)。判错的代价
 *      是把「Understood · …」挂到一张真的花钱生成出来的卡上,或者反过来让上传卡继续只说一个
 *      光秃秃的 "Cost";
 *   ② `costPendingCopy` —— PAUSED_BALANCE 那一句必须逐字等于 `@fikirtive/core` 的权威文案。
 *      映射从 `lib/actions.ts` 搬到读模型那一刻起,这是它唯一的看守者(jsdom 那一份刻意用
 *      夹具句,不抄权威文案)。
 *
 * 纯读、零写钱路:这里不预扣、不结算、不退款 —— 账本行是直接插进去的固定夹具。
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

const { getGenerationLineage } = await import("../actions");
const { prisma } = await import("@fikirtive/db");
const { UNDERSTANDING_WAITING_FOR_CREDITS, displayCredits, pricedUnderstandingCredits } =
  await import("@fikirtive/core");

/** 一件图片素材的理解价,现算 —— 与 worker 落快照、与 Billing 价目区同一个函数。 */
const IMAGE_CAPTION_INTERNAL = pricedUnderstandingCredits("image-caption");

type Seeded = { ownerId: string; generationId: string };

/**
 * 一个租户 + 一件素材 + 一行 Generation。
 * `understanding` 为 null = 这件素材从没被读过;否则按给的状态建理解行,`settled` 时再补上
 * 那一笔真账本(RESERVE + SETTLE,与 worker 写的形状同构)。
 */
async function seed(options: {
  source: "UPLOAD" | "GENERATED";
  understanding?: { status: string; settled: boolean };
}): Promise<Seeded> {
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
      source: options.source,
      width: 800,
      height: 600,
    },
  });
  const generationId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: generationId,
      ownerId,
      projectId,
      assetId,
      source: options.source,
      entitySnapshot: { entities: [] },
    },
  });
  if (options.understanding) {
    const understandingId = `au_${randomUUID()}`;
    const refId = `understanding:${understandingId}`;
    await prisma.assetUnderstanding.create({
      data: {
        id: understandingId,
        ownerId,
        assetId,
        kind: "image-caption",
        status: options.understanding.status,
        priceInternalSnapshot: IMAGE_CAPTION_INTERNAL,
        moneyRefId: refId,
      },
    });
    if (options.understanding.settled) {
      await prisma.creditLedger.createMany({
        data: [
          {
            id: `led_${randomUUID()}`,
            orgId: ownerId,
            balanceDelta: -IMAGE_CAPTION_INTERNAL,
            reservedDelta: IMAGE_CAPTION_INTERNAL,
            kind: "RESERVE",
            refId,
            idempotencyKey: `reserve:${refId}`,
          },
          {
            id: `led_${randomUUID()}`,
            orgId: ownerId,
            balanceDelta: 0,
            reservedDelta: -IMAGE_CAPTION_INTERNAL,
            kind: "SETTLE",
            refId,
            idempotencyKey: `settle:${refId}`,
          },
        ],
      });
    }
  }
  return { ownerId, generationId };
}

let settled: Seeded;
let waitingForCredits: Seeded;
let generated: Seeded;

beforeAll(async () => {
  settled = await seed({ source: "UPLOAD", understanding: { status: "DONE", settled: true } });
  waitingForCredits = await seed({
    source: "UPLOAD",
    understanding: { status: "PAUSED_BALANCE", settled: false },
  });
  generated = await seed({ source: "GENERATED" });
});

const lineageAs = async (seeded: Seeded) => {
  mockRequireOwner.mockResolvedValue({ ownerId: seeded.ownerId, email: `${seeded.ownerId}@fikirtive.test` });
  const lineage = await getGenerationLineage(seeded.generationId);
  if ("error" in lineage) throw new Error(`读不到血缘:${lineage.error}`);
  return lineage;
};

describe("MONEY-A9 · 2026-09-16 回执读路(真库)", () => {
  it("结清的上传:三格齐了 —— 是理解费、不再未定论、金额就是账本上那一笔", async () => {
    const lineage = await lineageAs(settled);
    expect(lineage.costIsUnderstanding, "上传卡的费用没被认成理解费 —— 回执那一行不会出现").toBe(true);
    expect(lineage.costPending).toBe(false);
    expect(lineage.costCredits).toBe(displayCredits(IMAGE_CAPTION_INTERNAL));
  });

  it("等充值的上传:金额尚无定论,而那一句是 @fikirtive/core 的权威文案(逐字)", async () => {
    const lineage = await lineageAs(waitingForCredits);
    expect(lineage.costIsUnderstanding).toBe(true);
    expect(lineage.costPending, "PAUSED_BALANCE 被当成了终态 —— 面上会说「没花钱」").toBe(true);
    expect(lineage.costPendingReason).toBe("waiting_for_credits");
    expect(lineage.costPendingCopy, "映射搬家之后指向了另一句话").toBe(UNDERSTANDING_WAITING_FOR_CREDITS);
  });

  it("引擎产物:不是理解费 —— 回执不会挂到一张真的花钱生成出来的卡上", async () => {
    const lineage = await lineageAs(generated);
    expect(lineage.costIsUnderstanding).toBe(false);
    expect(lineage.costPending).toBe(false);
  });
});
