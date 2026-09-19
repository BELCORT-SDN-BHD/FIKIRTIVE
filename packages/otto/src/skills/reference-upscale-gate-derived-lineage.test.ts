/**
 * reference-upscale-gate-derived-lineage.test.ts —— R3-F30 那条**已披露的行为改变**，
 * 钉在它真正发生的那一格上。
 *
 * 规格 `docs/specs/brand-product-identity.md` §5 2026-09-18 PRODID-R12 行验收⑪。
 *
 * 改变是什么：派生图从此继承源图的记录，于是 `lineageCarriesOfficialActor`（`@fikirtive/core`
 * 的 `generation-reference`）在派生图上**读得到**演员血统 —— 本票之前读不到。付费前那道尺寸闸
 * （本文件被测的 `assertPrePaymentReferenceSizeGate`）拿这一格分岔：
 *   · 血统里有演员 ⇒ 像素完整性铁律，一格不动 ⇒ 对它成立的门槛永远是供应商那道 **300**；
 *   · 只有商品 ⇒ 我们会替它补到 300 ⇒ 门槛是 **100**，短边落在 [100,300) 的照旧放行、
 *     记一张待放大。
 *
 * 所以同一张 200×200 的派生图，本票之后在「继承到的是演员」那一支被**拒**（从前它继承不到
 * 任何东西、一律走商品那一支）。方向是更严、更诚实：那一张送出去会被供应商在建任务前弹回，
 * 而那时钱已经预扣了。
 *
 * 拒绝发生在**预扣之前**（这道闸的调用点 `applyReferenceUpscaleGate` 在 `buildProposeCard`
 * 回来之后、GEN_CARD 落库之前）：$0、零 GEN_CARD、零 GenJob、账本零新增行。本文件把「零
 * GenJob」证成结构性的 —— 假件里 `genJob.create` 是一个会让用例红掉的函数，闸自己一次都不碰它。
 *
 * 变异自查（2026-09-18 亲手跑过）：把 `reference-upscale-gate.ts` 里
 * `const canUpscale = !lineageCarriesOfficialActor(row.entitySnapshot)` 改成 `const canUpscale = true`
 * ⇒ 第一条红（拒绝消失，只剩一张待放大）；第二条仍绿，所以两条一起才说得清这条分岔。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    // 这道闸只读这一张表这一次。
    generation: { findMany: vi.fn() },
    // 绝不许被调用 —— 付费前的闸不建卡、不建任务。
    genJob: { create: vi.fn(() => { throw new Error("pre-payment gate must never create a GenJob"); }) },
    chatMessage: { create: vi.fn(() => { throw new Error("pre-payment gate must never create a card"); }) },
  },
}));

const { assertPrePaymentReferenceSizeGate } = await import("./reference-upscale-gate.js");
const { prisma } = await import("@fikirtive/db");

const OWNER = "org-derived-lineage";
const DERIVED_ID = "gen-derived-200px";

/** 一张 200×200 的派生图。`entitySnapshot` 就是它从源图继承下来的那一份（R3-F30）。 */
function derivedRow(entities: { id: string; name: string; type: "PRODUCT" | "CHARACTER" }[]) {
  return [{
    asset: { width: 200, height: 200 },
    entitySnapshot: { entities: entities.map((e) => ({ ...e, variantId: null, refHashes: [] })) },
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("R3-F30 验收⑪ —— 继承来的演员血统让付费前那道放大闸改判", () => {
  it("继承到的是演员：200×200 的派生图被拒，门槛说 300（像素完整性铁律，我们不替它放大）", async () => {
    vi.mocked(prisma.generation.findMany).mockResolvedValue(
      derivedRow([{ id: "ent-actor", name: "Aisyah", type: "CHARACTER" }]) as never,
    );

    const verdict = await assertPrePaymentReferenceSizeGate({
      ownerId: OWNER,
      upscaleEligibleIds: [DERIVED_ID],
      hardFloorIds: [],
      honestFloorIds: [],
    });

    expect("error" in verdict, "带演员血统的 200×200 派生图必须在花钱之前被拒").toBe(true);
    const sentence = (verdict as { error: string }).error;
    expect(sentence).toContain("200×200");
    expect(sentence, "门槛必须是供应商那道 300，不是我们自己的 100").toContain("at least 300 pixels");
    expect(sentence, "拒绝那一句要明说没花钱").toContain("nothing was sent");
    // 结构性的「零 GenJob」：这道闸根本没有写入面，假件里那两个写方法会抛。
    expect(prisma.genJob.create).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it("继承到的只有商品：同一张 200×200 照旧放行，记一张待放大（门槛 100）", async () => {
    vi.mocked(prisma.generation.findMany).mockResolvedValue(
      derivedRow([{ id: "ent-jar", name: "Pandan kaya jar", type: "PRODUCT" }]) as never,
    );

    const verdict = await assertPrePaymentReferenceSizeGate({
      ownerId: OWNER,
      upscaleEligibleIds: [DERIVED_ID],
      hardFloorIds: [],
      honestFloorIds: [],
    });

    expect(verdict).toEqual({ upscaleCount: 1 });
    expect(prisma.genJob.create).not.toHaveBeenCalled();
  });
});
