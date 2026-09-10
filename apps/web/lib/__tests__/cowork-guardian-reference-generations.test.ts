/**
 * cowork-guardian —— creation §5 :162⑤ 的守卫面。
 *
 * 钉的是一件事:**挂上路的那几张原件(`videoOptions.referenceGenerationIds`)在花钱之前
 * 就被查过**。PR #1273 的正路让商品图经这条快照送到 worker,而这道付费前守卫当时只查
 * 首帧/末帧那两张 —— 商品图删掉之后那一趟走到 worker 才 fail closed,钱先预扣、事后退。
 *
 * 这里只跑纯守卫(prisma 全 mock):它到底查了什么 where、拒不拒、拒的时候有没有多查一步,
 * 都是这一层自己的事实。真扣款那一条链由 gen-ledger 的 DB 测试盯着。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerationFindFirst, mockEntityFindMany, mockVariantFindFirst, mockActionEventCreate } = vi.hoisted(() => ({
  mockGenerationFindFirst: vi.fn(),
  mockEntityFindMany: vi.fn(),
  mockVariantFindFirst: vi.fn(),
  mockActionEventCreate: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    generation: { findFirst: mockGenerationFindFirst },
    entity: { findMany: mockEntityFindMany },
    entityVariant: { findFirst: mockVariantFindFirst },
    actionEvent: { create: mockActionEventCreate },
  },
}));

vi.mock("../cowork-knowledge", () => ({ getCastRule: vi.fn(async () => undefined) }));

const { checkCast } = await import("../cowork-guardian");

const OWNER = "owner-1";

function req(over: Partial<Parameters<typeof checkCast>[0]> = {}): Parameters<typeof checkCast>[0] {
  return {
    ownerId: OWNER,
    projectId: "proj-1",
    entityIds: [],
    model: "seedance-2-mini",
    kind: "video",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntityFindMany.mockResolvedValue([]);
});

describe("creation §5 :162⑤ —— 付费前守卫覆盖 referenceGenerationIds", () => {
  it("creation §5 :162⑤ / CREATE-A10: 挂上路的原件取不到 ⇒ 付费前就拒,一句人话", async () => {
    mockGenerationFindFirst.mockResolvedValue(null); // 删了 / 不是这家店的 / 不是图片

    const block = await checkCast(req({ referenceGenerationIds: ["gen-gone"] }));

    expect(block).not.toBeNull();
    expect(block?.error).toBe("One of the reference images isn't one of your images any more — pick another.");
    expect(block?.report.findings[0]?.kind).toBe("missing-source");
  });

  it("creation §5 :162⑤ / CREATE-A10: 取原件按 ownerId + 活着 + 图片扩展名(画布不是权限边界)", async () => {
    mockGenerationFindFirst.mockResolvedValue({ id: "gen-1" });

    const block = await checkCast(req({ referenceGenerationIds: ["gen-1"] }));

    expect(block).toBeNull();
    const where = mockGenerationFindFirst.mock.calls[0]![0].where;
    expect(where.id).toBe("gen-1");
    expect(where.ownerId).toBe(OWNER);
    expect(where.deletedAt).toBeNull();
    expect(where.asset.ext.in).toContain("png");
    // 画布是出处,不是权限边界(QA-CRE-FE9-013)——多写一格 projectId 就会拒掉合法引用。
    expect("projectId" in where).toBe(false);
  });

  it("creation §5 :162⑤ / CREATE-A10: 双租户 —— 别家的那张原件在这家店取不到 ⇒ 同样拒,零放行", async () => {
    // 真库里那一行属于 owner-2;守卫查的是 owner-1 的 scope,所以读回 null。
    mockGenerationFindFirst.mockImplementation(async (args: { where: { ownerId: string } }) =>
      args.where.ownerId === "owner-2" ? { id: "gen-of-owner-2" } : null,
    );

    const block = await checkCast(req({ referenceGenerationIds: ["gen-of-owner-2"] }));

    expect(block).not.toBeNull();
    expect(mockGenerationFindFirst.mock.calls[0]![0].where.ownerId).toBe(OWNER);
  });

  it("creation §5 :162⑤ / CREATE-A2: 没有挂原件的那一趟一格没动 —— 一次多余的查询都不发", async () => {
    expect(await checkCast(req())).toBeNull();
    expect(await checkCast(req({ referenceGenerationIds: [] }))).toBeNull();
    expect(mockGenerationFindFirst).not.toHaveBeenCalled();
  });
});
