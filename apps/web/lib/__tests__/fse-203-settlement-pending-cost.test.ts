/**
 * FSE-203 —— 结算没定论前不能说「没花钱」。
 *
 * 规格 `docs/specs/creation-engine.md` §5 :169 登记行（FSE-203，S5 批量裁决 2026-09-12，
 * #1358）：图片上传成功到「理解费」结算之间那几十秒，Library 资产详情写
 * 「Cost: no credits charged」，而这笔钱随后一定会收。根因：费用行读的是**已结算**的
 * 账本行，理解未结算时自然为空，落到默认的「没花钱」文案。裁决：未结算窗口改成诚实中间
 * 态；复测＝上传后立刻看详情，不得出现「no credits charged」。
 *
 * 复现路径（先坐实再修）：`AssetUnderstanding` 行已经建下（甚至已经预扣），但**还没有任何
 * 一条终态**（QUEUED / RUNNING / PAUSED / PAUSED_BALANCE）—— 这时费用行读到的账本查询恒
 * 为空，从前会折出 0。修法（单一源头 `loadUploadUnderstandingCredits`，
 * `apps/web/lib/canvas-lineage-data.ts`）：新增 `pending` 信号——一行理解都不到终态，或
 * 一行理解都还没建但这件素材的 mime 迟早会被扫描器读到（`understandingKindForMime`，与
 * 扫描器 `scanAssetsNeedingUnderstanding` 同一个函数）——两面（画布卡片信息面 `costCredits`
 * 保持逐字不变，本票不动它；Library 资产详情新增 `costPending`）读的是同一次判定。
 *
 * 纯读、零写：替身是 prisma。
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

const OWNER = "org_pending_cost";
const PROJECT = "prj_pending_cost";
const GENERATION = "gen_upload_pending";
const ASSET = "ast_pending_1";
const UPLOAD_NODE = { id: "cnd_1", generationId: GENERATION, genJobId: null };

function ledgerBy(rowsByRefId: Record<string, number[]>) {
  return async (args: { where: { refId: { in: string[] } | string } }) => {
    const refId = args.where.refId;
    const ids = typeof refId === "string" ? [refId] : refId.in;
    return ids.flatMap((id) => (rowsByRefId[id] ?? []).map((balanceDelta) => ({ refId: id, balanceDelta })));
  };
}

/** 一件上传素材在两条读路上的费用与「有没有定论」。 */
async function costOnBothSurfaces(): Promise<{
  canvasCard: number | null;
  assetDetailCredits: number | null;
  assetDetailPending: boolean;
  assetDetailPendingReason: "waiting_for_credits" | "provider_paused" | undefined;
}> {
  const canvas = await loadCanvasNodeLineages(OWNER, PROJECT, [UPLOAD_NODE], "Asia/Kuala_Lumpur");
  const detail = await getGenerationLineage(GENERATION);
  if ("error" in detail) throw new Error(`资产详情读不到血缘：${detail.error}`);
  return {
    canvasCard: canvas["cnd_1"]!.costCredits,
    assetDetailCredits: detail.costCredits,
    assetDetailPending: detail.costPending,
    assetDetailPendingReason: detail.costPendingReason,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue({ ownerId: OWNER, email: "founder@example.com" });
  genJobFindMany.mockResolvedValue([]);
  genJobFindFirst.mockResolvedValue(null);
  generationFindMany.mockResolvedValue([
    {
      id: GENERATION,
      createdAt: new Date("2026-09-12T02:00:00Z"),
      source: "UPLOAD",
      assetId: ASSET,
      // width/height 已就绪、source=UPLOAD、没被软删 —— 这件素材此刻真的会被扫描器捞走
      // (P1-1 修根后的准入门槛,见 canvas-lineage-data.ts 的 wouldBeScannedForUnderstanding)。
      asset: { mime: "image/png", source: "UPLOAD", deletedAt: null, width: 800, height: 600, durationS: null },
    },
  ]);
  generationFindFirst.mockResolvedValue({
    projectId: PROJECT,
    threadId: null,
    shotId: null,
    campaignId: null,
    source: "UPLOAD",
    entitySnapshot: { entities: [] },
    assetId: ASSET,
    asset: { mime: "image/png", source: "UPLOAD", deletedAt: null, width: 800, height: 600, durationS: null },
  });
  projectFindFirst.mockResolvedValue({ name: "Hari Raya gifting" });
  assetUnderstandingFindMany.mockResolvedValue([]);
  creditLedgerFindMany.mockImplementation(ledgerBy({}));
});

describe("creation §5 :169 FSE-203 结算没定论前的诚实中间态", () => {
  it("FSE-203 理解行已建但还是 QUEUED(还没进钱路)⇒ 两面都说这笔钱还没有定论,不是 0", async () => {
    // 上传成功到扫描器建行、reserve 之间那几十秒:行已经建下,状态还是 QUEUED,moneyRefId
    // 还是 null —— 旧代码的查询(只挑 moneyRefId 不为空的行)看不到这一行,折出 0。
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: null, status: "QUEUED" },
    ]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits, "结算没定论前不该显示一个确定的数").toBe(0);
    expect(cost.assetDetailPending, "QUEUED 还没到终态,这笔钱应该算没定论").toBe(true);
    // 账本一条都没查过(QUEUED 行还没有 moneyRefId 可查)——纯读,不因为这次多查而多花一分钱。
    expect(creditLedgerFindMany).not.toHaveBeenCalled();
  });

  it("FSE-203 理解行已经 RUNNING(预扣过、供应商还没回话)⇒ 同样是未定论,不是 0", async () => {
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1", status: "RUNNING" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1] }));

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailPending).toBe(true);
  });

  it("FSE-203 一行理解都还没建,但这件素材是图片(迟早会被扫描器读到)⇒ 未定论,不许说没花钱", async () => {
    // 复现现场：上传刚成功,扫描器(每分钟一轮)还没轮到这件素材,连 QUEUED 行都还没有。
    assetUnderstandingFindMany.mockResolvedValue([]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(cost.assetDetailPending, "图片迟早会被理解,这个 0 还没定论").toBe(true);
  });

  it("FSE-203 一行理解都没建,而且这件素材是音频(理解三件套不收音频,永远不会建行)⇒ 真的没花钱,不是 pending", async () => {
    generationFindMany.mockResolvedValue([
      { id: GENERATION, createdAt: new Date("2026-09-12T02:00:00Z"), source: "UPLOAD", assetId: ASSET, asset: { mime: "audio/mpeg" } },
    ]);
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "UPLOAD",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
      asset: { mime: "audio/mpeg" },
    });
    assetUnderstandingFindMany.mockResolvedValue([]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(cost.assetDetailPending, "音频不进理解三件套,0 是事实不是未定论").toBe(false);
  });

  it("FSE-203 理解已经 DONE、账本已结清(收了 0.1 credit)⇒ 不是 pending,费用行显示那个真数", async () => {
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1", status: "DONE" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 0] }));

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0.1);
    expect(cost.assetDetailPending, "已经结清了,不该还说未定论").toBe(false);
    expect(cost.canvasCard, "画布卡这一面本票不改数字,与资产详情同一个数").toBe(0.1);
  });

  it("FSE-203 理解 SKIPPED 且退过款(净额折回 0)⇒ 终局的 0,不是 pending,照旧说没花钱", async () => {
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1", status: "SKIPPED" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1, 1] }));

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(cost.assetDetailPending, "SKIPPED 是终态,这个 0 是事实").toBe(false);
  });

  it("FSE-203 非上传来路(有付费任务)恒不是 pending —— 结算与产出落盘同一个事务,没有这个窗口", async () => {
    genJobFindFirst.mockResolvedValue({ id: "job_1", status: "DONE" });
    creditLedgerFindMany.mockImplementation(ledgerBy({ job_1: [-8] }));
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "RENDER",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
      asset: { mime: "image/png" },
    });

    const detail = await getGenerationLineage(GENERATION);
    if ("error" in detail) throw new Error("资产详情读不到血缘");

    expect(detail.costCredits).toBe(0.8);
    expect(detail.costPending).toBe(false);
    expect(assetUnderstandingFindMany, "有付费任务的那一支一次理解查询都不该发").not.toHaveBeenCalled();
  });
});

/**
 * 判官修根 P1-1（PR #1415，FSE-203/205/211 复审）——旧判据（0 行理解时只看
 * `understandingKindForMime(mime) !== null`）把三类「扫描器其实永远不会捞走」的素材标成
 * 永久 pending，诚实中间态变成永久假话：① PAUSED_BALANCE 无限期等充值（本该点名 credits，
 * 不该说「快」）；② 元数据永远补不齐的素材（ffprobe 失败/24h 超龄，understand.ts:388-391
 * 明写这是刻意选的那一边，宽高/时长恒 null）；③ 扫描器永远不会再捞的素材（同一道
 * `deletedAt == null` 门槛——素材软删之后，与「ASSET_UNDERSTANDING=off 期间上传、扫描器
 * 从未建行」是同一个后果：这件素材此刻起不会再被任何一轮扫描捞走）。
 *
 * 修法（`canvas-lineage-data.ts` 的 `wouldBeScannedForUnderstanding`）：0 行理解时改问
 * 「扫描器此刻真的会捞走这件素材吗」——来路对 + 没被软删 + 元数据已经齐了 + mime 路由得出
 * kind，四条缺一都不行。PAUSED_BALANCE / PAUSED 的文案信号另起一条（`stalledReason` /
 * `costPendingReason`），沿用既有权威口径，不再共用会撒谎的「settles shortly」。
 */
describe("判官修根 P1-1 —— pending 判据认扫描器真准入门槛，别永久撒谎", () => {
  it("① PAUSED_BALANCE 无限期等充值 —— 信号必须点名 credits，不是通用的「快」", async () => {
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1", status: "PAUSED_BALANCE" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1] }));

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailPending, "PAUSED_BALANCE 不是终态,仍然是未定论").toBe(true);
    expect(
      cost.assetDetailPendingReason,
      "必须是 waiting_for_credits——不能落回 QUEUED/RUNNING 那句「快有结果」的默认文案",
    ).toBe("waiting_for_credits");
  });

  it("① PAUSED(我方配置/请求坏了)同理不是「快」—— 信号是 provider_paused", async () => {
    assetUnderstandingFindMany.mockResolvedValue([
      { assetId: ASSET, moneyRefId: "understanding:u1", status: "PAUSED" },
    ]);
    creditLedgerFindMany.mockImplementation(ledgerBy({ "understanding:u1": [-1] }));

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailPending).toBe(true);
    expect(cost.assetDetailPendingReason).toBe("provider_paused");
  });

  it("② 元数据永远补不齐(ffprobe 失败/24h 超龄,宽高恒 null)—— 折出真的 0,不许永久说还在读", async () => {
    // 复现 understand.ts:388-391 明写的那个饿死口:ingest 的 ffprobe 一直没有成功,
    // Asset.width/height 卡在 null —— 扫描器的 METADATA_READY_FOR_UNDERSTANDING 那道 OR
    // 永远不会放行这件素材,它根本不会建行。旧判据只看 mime,会把这个 0 永久标成「未定论」。
    generationFindMany.mockResolvedValue([
      {
        id: GENERATION,
        createdAt: new Date("2026-09-12T02:00:00Z"),
        source: "UPLOAD",
        assetId: ASSET,
        asset: { mime: "image/png", source: "UPLOAD", deletedAt: null, width: null, height: null, durationS: null },
      },
    ]);
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "UPLOAD",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
      asset: { mime: "image/png", source: "UPLOAD", deletedAt: null, width: null, height: null, durationS: null },
    });
    assetUnderstandingFindMany.mockResolvedValue([]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(
      cost.assetDetailPending,
      "扫描器这道元数据闸永远不会放行,这个 0 是事实不是未定论 —— 不许永久假装快有结果",
    ).toBe(false);
  });

  it("② 视频版同一个饿死口(durationS 恒 null)—— 同样折出真的 0", async () => {
    generationFindMany.mockResolvedValue([
      {
        id: GENERATION,
        createdAt: new Date("2026-09-12T02:00:00Z"),
        source: "UPLOAD",
        assetId: ASSET,
        asset: { mime: "video/mp4", source: "UPLOAD", deletedAt: null, width: null, height: null, durationS: null },
      },
    ]);
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "UPLOAD",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
      asset: { mime: "video/mp4", source: "UPLOAD", deletedAt: null, width: null, height: null, durationS: null },
    });
    assetUnderstandingFindMany.mockResolvedValue([]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(cost.assetDetailPending).toBe(false);
  });

  it("③ 素材已经被软删(与「扫描器从未建行、以后也不会」同一个后果)—— 不许还说「还在读」", async () => {
    // 扫描器的准入查询本身要求 `deletedAt: null`(understand.ts `scanAssetsNeedingUnderstanding`
    // 第①段)——元数据齐了也没用,这一条闸单独就能让这件素材永远出局,与「ASSET_UNDERSTANDING
    // 关闭期间上传、从未被扫描器建过行」是同一类「不会再被捞走」的后果。
    generationFindMany.mockResolvedValue([
      {
        id: GENERATION,
        createdAt: new Date("2026-09-12T02:00:00Z"),
        source: "UPLOAD",
        assetId: ASSET,
        asset: {
          mime: "image/png",
          source: "UPLOAD",
          deletedAt: new Date("2026-09-12T03:00:00Z"),
          width: 800,
          height: 600,
          durationS: null,
        },
      },
    ]);
    generationFindFirst.mockResolvedValue({
      projectId: PROJECT,
      threadId: null,
      shotId: null,
      campaignId: null,
      source: "UPLOAD",
      entitySnapshot: { entities: [] },
      assetId: ASSET,
      asset: {
        mime: "image/png",
        source: "UPLOAD",
        deletedAt: new Date("2026-09-12T03:00:00Z"),
        width: 800,
        height: 600,
        durationS: null,
      },
    });
    assetUnderstandingFindMany.mockResolvedValue([]);

    const cost = await costOnBothSurfaces();

    expect(cost.assetDetailCredits).toBe(0);
    expect(cost.assetDetailPending, "软删的素材扫描器永远不会再捞——这个 0 是事实").toBe(false);
  });
});
