/**
 * creation-upload-understanding-cost —— 上传详情那一行费用说的是**含理解费的合计**。
 *
 * 规格 docs/specs/creation-engine.md §5 :169（FSE-009，Founder 2026-09-10 裁：上传详情费用
 * 只显示含理解费的合计，不拆行）。
 *
 * 走查现象：上传详情写「Cost: no credits charged」，而自动理解那件事扣了 0.1 credit（Billing
 * 里那一行是对的，不是重复收费）。根因是 `loadCanvasNodeLineages` 只按 GenJob id 查账本，而
 * 理解任务的账本行挂在**素材**上——那条 refId 永远不在集合里，于是上传卡永远折出 0。
 *
 * 这一份钉的是那条链本身：generation → 素材 → 那件素材上的理解行 → 它们的 `moneyRefId` →
 * 账本，净额折成显示 credits。纯读、零写：整个函数不预扣、不结算、不退款。
 * 替身是 prisma（这是一次读取形状的证明，不是账本口径的证明——账本口径由
 * `netChargedInternalCredits` 自己那份单测钉住）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const genJobFindMany = vi.fn();
const generationFindMany = vi.fn();
const creditLedgerFindMany = vi.fn();
const assetUnderstandingFindMany = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    genJob: { findMany: genJobFindMany },
    generation: { findMany: generationFindMany },
    creditLedger: { findMany: creditLedgerFindMany },
    assetUnderstanding: { findMany: assetUnderstandingFindMany },
  },
}));

const { loadCanvasNodeLineages } = await import("../canvas-lineage-data");

const OWNER = "org_upload_cost";
const PROJECT = "prj_upload_cost";
const UPLOAD_NODE = { id: "cnd_1", generationId: "gen_upload", genJobId: null };

/** 账本按 refId 分发：任务那条查询与理解那条查询各拿各的行。 */
function ledgerBy(rowsByRefId: Record<string, number[]>) {
  return async (args: { where: { refId: { in: string[] } } }) =>
    args.where.refId.in.flatMap((refId) =>
      (rowsByRefId[refId] ?? []).map((balanceDelta) => ({ refId, balanceDelta })),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  genJobFindMany.mockResolvedValue([]);
  generationFindMany.mockResolvedValue([
    { id: "gen_upload", createdAt: new Date("2026-09-10T02:00:00Z"), source: "UPLOAD", assetId: "ast_1" },
  ]);
  assetUnderstandingFindMany.mockResolvedValue([]);
  creditLedgerFindMany.mockImplementation(ledgerBy({}));
});

describe("creation §5 :169 FSE-009 上传详情的费用行", () => {
  it("creation §5 :169 FSE-009 CREATE-A10 自动理解扣过的那一笔计进上传卡的费用合计,不再显示成零", async () => {
    // 一件素材,一行 image-caption 理解:reserve 1 credit 的十分之一(1 internal),settle 收口。
    assetUnderstandingFindMany.mockResolvedValue([{ assetId: "ast_1", moneyRefId: "understanding:u1" }]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 0] }));

    const out = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");

    expect(out["cnd_1"]!.costCredits).toBe(0.1);
    // 只查这件素材、只查这个租户 —— 费用行也是一条租户边界。
    expect(assetUnderstandingFindMany.mock.calls[0]![0].where).toMatchObject({
      ownerId: OWNER,
      assetId: { in: ["ast_1"] },
    });
  });

  it("creation §5 :169 FSE-009 CREATE-A10 级联出来的第二段理解也进同一个合计,不拆成两行", async () => {
    // 看图读完才知道这是一份文档,于是再读一次(doc-extract)——两行理解,一个合计。
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: "ast_1", moneyRefId: "understanding:u1" },
      { assetId: "ast_1", moneyRefId: "understanding:u2" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({
      "understanding:u1": [-1, 0],
      "understanding:u2": [-2, 0],
    }));

    const out = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");

    expect(out["cnd_1"]!.costCredits).toBe(0.3);
  });

  it("creation §5 :169 FSE-009 CREATE-A10 理解那一笔被退过款:合计折回 0,卡面照旧说没收过钱", async () => {
    assetUnderstandingFindMany.mockResolvedValue([{ assetId: "ast_1", moneyRefId: "understanding:u1" }]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 1] }));

    const out = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");

    expect(out["cnd_1"]!.costCredits).toBe(0);
  });

  it("creation §5 :169 FSE-009 CREATE-A10 从没被读过的上传:一条理解查询之后就收手,费用仍是 0", async () => {
    const out = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");

    expect(out["cnd_1"]!.costCredits).toBe(0);
    // 没有理解行 ⇒ 不再为账本多发一条语句。
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
  });
});
