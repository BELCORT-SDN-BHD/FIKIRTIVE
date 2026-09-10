/**
 * creation-upload-understanding-cost —— 上传素材那一行费用说的是**含理解费的合计**，
 * 而且**画布卡片信息面与 Library 资产详情说同一个数**。
 *
 * 规格 docs/specs/creation-engine.md §5 :169（FSE-009，Founder 2026-09-10 裁：上传详情费用
 * 只显示含理解费的合计，不拆行）。冻结版 §2 的验收表（CREATE-A1…A12）没有一行讲上传详情的
 * 费用显示，所以这一份**不认领任何 CREATE- 编号**：它的追溯落在上面那条变更登记行上，
 * S5 走查以那一行的裁决口径为准（同 §5 :167 的先例）。要让它进验收表，须新冻结规格版本
 * ——已写进本 PR 的「要登记的事」。
 *
 * 走查现象（证据 `docs/audits/fullstack-staging-2026-09-08/29-upload-detail.png`）：Library →
 * Uploads → Asset details 抽屉写「Cost: no credits charged」，而自动理解那件事扣了 0.1 credit
 * （Billing 里那一行是对的，不是重复收费）。
 *
 * 根因**两处同形**：画布那条读路（`loadCanvasNodeLineages`）只按 GenJob id 查账本；被投诉的
 * 那条读路（`actions.getGenerationLineage`，渲染点 `components/library/AssetLineage.tsx:61`）
 * 干脆写死 `job ? … : 0`。理解任务的账本行挂在**素材**上，两处都够不着。
 *
 * 这一份钉三件事：①那条链本身（generation → 素材 → 理解行的 `moneyRefId` → 账本，净额折成
 * 显示 credits）；②被投诉的那一面真的不再说 "no credits charged"；③两面同一个数（家规 §7.3
 * 单一真相：费用只从 `loadUploadUnderstandingCredits` 一处折出来）。
 *
 * 纯读、零写：整条路不预扣、不结算、不退款。替身是 prisma（这是一次读取形状的证明，不是
 * 账本口径的证明——账本口径由 `netChargedInternalCredits` 自己那份单测钉住）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const genJobFindMany = vi.fn();
const genJobFindFirst = vi.fn();
const generationFindMany = vi.fn();
const generationFindFirst = vi.fn();
const creditLedgerFindMany = vi.fn();
const assetUnderstandingFindMany = vi.fn();
const projectFindFirst = vi.fn();
const requireOwner = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    genJob: { findMany: genJobFindMany, findFirst: genJobFindFirst },
    generation: { findMany: generationFindMany, findFirst: generationFindFirst },
    creditLedger: { findMany: creditLedgerFindMany },
    assetUnderstanding: { findMany: assetUnderstandingFindMany },
    project: { findFirst: projectFindFirst },
    chatThread: { findFirst: vi.fn() },
    shot: { findFirst: vi.fn() },
    campaign: { findFirst: vi.fn() },
  },
  refundReservation: vi.fn(),
}));
vi.mock("@fikirtive/db/principal", () => ({ runAsUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../auth-guard", async () => ({
  requireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("../storage", () => ({
  storage: { put: vi.fn(), get: vi.fn(), del: vi.fn() },
  extFromFilename: () => "png",
  mimeOf: () => "image/png",
}));
vi.mock("../queue", () => ({ getBoss: vi.fn() }));
vi.mock("../asset-purge", () => ({ purgeOrphanedReferenceAssets: vi.fn(), purgeAssetStorage: vi.fn() }));
vi.mock("../data", () => ({ getShots: vi.fn(), getLooseVideoClips: vi.fn(), getMediaPage: vi.fn() }));
vi.mock("../edit", () => ({ buildBoardEdit: vi.fn(), transitionFor: vi.fn() }));

const { loadCanvasNodeLineages } = await import("../canvas-lineage-data");
const { getGenerationLineage } = await import("../actions");

const OWNER = "org_upload_cost";
const PROJECT = "prj_upload_cost";
const GENERATION = "gen_upload";
const ASSET = "ast_1";
const UPLOAD_NODE = { id: "cnd_1", generationId: GENERATION, genJobId: null };

/** 账本按 refId 分发：任务那条查询与理解那条查询各拿各的行。 */
function ledgerBy(rowsByRefId: Record<string, number[]>) {
  return async (args: { where: { refId: { in: string[] } | string } }) => {
    const refId = args.where.refId;
    const ids = typeof refId === "string" ? [refId] : refId.in;
    return ids.flatMap((id) => (rowsByRefId[id] ?? []).map((balanceDelta) => ({ refId: id, balanceDelta })));
  };
}

/** 一件上传素材在两条读路上的费用数字。 */
async function costOnBothSurfaces(): Promise<{ canvasCard: number | null; assetDetail: number | null }> {
  const canvas = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");
  const detail = await getGenerationLineage(GENERATION);
  if ("error" in detail) throw new Error(`资产详情读不到血缘：${detail.error}`);
  return { canvasCard: canvas["cnd_1"]!.costCredits, assetDetail: detail.costCredits };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue({ ownerId: OWNER, email: "founder@example.com" });
  genJobFindMany.mockResolvedValue([]);
  genJobFindFirst.mockResolvedValue(null);
  generationFindMany.mockResolvedValue([
    { id: GENERATION, createdAt: new Date("2026-09-10T02:00:00Z"), source: "UPLOAD", assetId: ASSET },
  ]);
  generationFindFirst.mockResolvedValue({
    projectId: PROJECT,
    threadId: null,
    shotId: null,
    campaignId: null,
    source: "UPLOAD",
    entitySnapshot: { entities: [] },
    assetId: ASSET,
  });
  projectFindFirst.mockResolvedValue({ name: "Hari Raya gifting" });
  assetUnderstandingFindMany.mockResolvedValue([]);
  creditLedgerFindMany.mockImplementation(ledgerBy({}));
});

describe("creation §5 :169 FSE-009 上传素材的费用行", () => {
  it("creation §5 :169 FSE-009 自动理解扣过的那一笔计进合计,画布卡片与资产详情说同一个数,不再显示成零", async () => {
    // 一件素材,一行 image-caption 理解:reserve 1 internal credit(= 0.1 显示 credit),settle 收口。
    assetUnderstandingFindMany.mockResolvedValue([{ assetId: ASSET, moneyRefId: "understanding:u1" }]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 0] }));

    const cost = await costOnBothSurfaces();

    // 被走查投诉的正是 assetDetail 那一面(AssetLineage.tsx:61 的 `costCredits === 0` 分支)。
    expect(cost).toEqual({ canvasCard: 0.1, assetDetail: 0.1 });
  });

  it("creation §5 :169 FSE-009 级联出来的第二段理解也进同一个合计,不拆成两行", async () => {
    // 看图读完才知道这是一份文档,于是再读一次(doc-extract)——两行理解,一个合计。
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1" },
      { assetId: ASSET, moneyRefId: "understanding:u2" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({
      "understanding:u1": [-1, 0],
      "understanding:u2": [-2, 0],
    }));

    const cost = await costOnBothSurfaces();

    expect(cost).toEqual({ canvasCard: 0.3, assetDetail: 0.3 });
  });

  it("creation §5 :169 FSE-009 理解那一笔被退过款:合计折回 0,两面照旧说没收过钱", async () => {
    assetUnderstandingFindMany.mockResolvedValue([{ assetId: ASSET, moneyRefId: "understanding:u1" }]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 1] }));

    const cost = await costOnBothSurfaces();

    expect(cost).toEqual({ canvasCard: 0, assetDetail: 0 });
  });

  it("creation §5 :169 FSE-009 从没被读过的上传:一条理解查询之后就收手,两面费用仍是 0", async () => {
    const cost = await costOnBothSurfaces();

    expect(cost).toEqual({ canvasCard: 0, assetDetail: 0 });
    // 没有理解行 ⇒ 不再为账本多发一条语句(两条读路各查一次理解、各在这里收手)。
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
  });

  it("creation §5 :169 FSE-009 理解费也是一条租户边界:两条读路都只查本租户、只查这件素材", async () => {
    assetUnderstandingFindMany.mockResolvedValue([{ assetId: ASSET, moneyRefId: "understanding:u1" }]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 0] }));

    await costOnBothSurfaces();

    expect(assetUnderstandingFindMany).toHaveBeenCalledTimes(2);
    for (const call of assetUnderstandingFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: OWNER, assetId: { in: [ASSET] } });
    }
    for (const call of creditLedgerFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ orgId: OWNER });
    }
  });

  it("creation §5 :169 FSE-009 非上传来路(RENDER 这类)不受影响:资产详情仍是 0,零理解查询", async () => {
    // 只有 `source === "UPLOAD"` 那一支去问理解费;别的无任务来路一句都不多发。
    // (裁剪 `saveCroppedGeneration` 写的也是 UPLOAD,但它指向一件**新**素材,那上面没有
    //  理解行 ⇒ 照样折出 0 —— 走的是上面第四条用例那条路。)
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "RENDER",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
    });

    const detail = await getGenerationLineage(GENERATION);

    expect("error" in detail ? detail : detail.costCredits).toBe(0);
    expect(assetUnderstandingFindMany).not.toHaveBeenCalled();
  });
});
