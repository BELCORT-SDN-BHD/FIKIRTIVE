/**
 * campaign-generation-confirm — C2b (issues #395/#403) money-safety proofs.
 *
 * Zero real spend: startGen and prisma are fakes. Proves persisted-plan anti-flip,
 * price+content consent binding, stable-entry exactly-once identity (including legacy
 * positional compatibility), honest partial interruption counts, owner isolation, and
 * that this action opens no second spend path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const OWNER = "org_c2b_owner";
const OTHER_OWNER = "org_c2b_other";

const h = vi.hoisted(() => {
  const store = {
    campaigns: new Map<string, { id: string; ownerId: string; name: string; planJson: unknown; deletedAt: Date | null }>(),
    projects: new Map<string, { id: string; ownerId: string; campaignId: string | null; deletedAt: Date | null }>(),
    creditAccounts: new Map<string, number>(),
    batches: new Map<string, { id: string; ownerId: string }>(),
    jobs: new Map<string, Record<string, unknown>>(),
  };
  const creditAccountFindUnique = vi.fn(async ({ where }: { where: { orgId: string } }) => {
    const balance = store.creditAccounts.get(where.orgId);
    return balance == null ? null : { balance };
  });

  type PrefixClause = { idempotencyKey: { startsWith: string } };
  // #744 判官 r1 P1-2 — every paid dispatch now runs inside the campaign approval lock, which
  // re-reads the PERSISTED plan and re-derives the approval fingerprint from it. The fake client
  // therefore has to serve a transaction and the lock statement; `advisoryLocks` records the keys
  // so the tests can prove the gate was taken and not merely present.
  const advisoryLocks: string[] = [];
  const prisma = {
    $transaction: async (run: (tx: unknown) => unknown) => run(prisma),
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
      advisoryLocks.push(key);
      return 0;
    },
    campaign: {
      findFirst: async ({ where }: { where: { id: string; ownerId: string; deletedAt: null } }) => {
        const row = store.campaigns.get(where.id);
        if (!row || row.ownerId !== where.ownerId || row.deletedAt !== null) return null;
        return { id: row.id, name: row.name, planJson: row.planJson };
      },
    },
    project: {
      findFirst: async ({ where }: { where: { id: string; ownerId: string; deletedAt: null } }) => {
        const row = store.projects.get(where.id);
        if (!row || row.ownerId !== where.ownerId || row.deletedAt !== null) return null;
        return { id: row.id, campaignId: row.campaignId };
      },
    },
    creditAccount: {
      findUnique: creditAccountFindUnique,
    },
    generationBatch: {
      findFirst: async ({ where }: { where: { id: string; ownerId: string } }) => {
        const batch = store.batches.get(where.id);
        return batch && batch.ownerId === where.ownerId ? { id: batch.id } : null;
      },
      create: async ({ data }: { data: { id: string; ownerId: string } }) => {
        if (store.batches.has(data.id)) throw Object.assign(new Error("dup"), { code: "P2002" });
        store.batches.set(data.id, { id: data.id, ownerId: data.ownerId });
        return { id: data.id };
      },
    },
    genJob: {
      findMany: async ({ where }: {
        where: {
          ownerId: string;
          projectId?: string;
          idempotencyKey?: { startsWith: string };
          OR?: PrefixClause[];
        };
      }) => {
        return [...store.jobs.values()]
          .filter((job) => {
            const key = String(job.idempotencyKey ?? "");
            return (
              job.ownerId === where.ownerId &&
              (where.projectId == null || job.projectId === where.projectId) &&
              (where.idempotencyKey == null || key.startsWith(where.idempotencyKey.startsWith)) &&
              (where.OR == null || where.OR.some((clause) => key.startsWith(clause.idempotencyKey.startsWith)))
            );
          })
          .map((job) => ({ ...job }));
      },
      updateMany: async ({ where, data }: { where: { id: string; ownerId: string }; data: { batchId: string } }) => {
        const job = store.jobs.get(where.id);
        if (job && job.ownerId === where.ownerId) job.batchId = data.batchId;
        return { count: job ? 1 : 0 };
      },
    },
  };

  return {
    store,
    prisma,
    advisoryLocks,
    startGen: vi.fn(),
    requireOwner: vi.fn(),
    isImpersonating: vi.fn(async () => false),
    creditAccountFindUnique,
  };
});

vi.mock("../auth-guard", () => ({ requireOwner: h.requireOwner }));
vi.mock("../better-auth/compat", () => ({ isImpersonating: h.isImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startGen: h.startGen }));
vi.mock("@fikirtive/db", () => ({ prisma: h.prisma }));

const { confirmCampaignGeneration, quoteCampaignGeneration } = await import("../campaign-generation-confirm");
const {
  factoryAttemptKey,
  normalizeFactoryMaterial,
  factoryMaterialMatches,
  parseFactoryAttemptKey,
} = await import("../batch-idempotency");
const { INTERNAL_PER_DISPLAY, GEN_VIDEO_MODEL_OPTIONS, activeVideoModel, buildSpecChips } =
  await import("@fikirtive/core");
const {
  applyCampaignApprovalGate,
  applyCampaignDispatchVerdict,
  campaignApprovalGateFor,
  campaignApprovalGateRefusal,
  CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
  CAMPAIGN_DELIVERY_CHANGED_MID_DISPATCH,
  CAMPAIGN_DELIVERY_CHECK_UNKNOWN,
} = await import("../campaign-approval-lock");
const { quoteCell } = await import("../factory-batch");
const { displayCredits } = await import("@fikirtive/core");

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const PROJECT_ID = "prj_c2b";
const IMG = 1;
const VID = 11; // seedance-2-fast 720p/5s(#644 Founder 裁决 2026-08-06:8 → 11 显示 credits)
// #645 T4 价目表(Founder 裁决 2026-08-06):480p = 半价档,5 秒 = 6 显示 credits。
const VID_480 = 6;
const VALID_UNKNOWN_FINGERPRINT = "0".repeat(64);

let failPrompts = new Set<string>();
/**
 * 「引擎在锁里给这一格算出了比卡上更高的价」(#749 判官 r2 P1 的「超批准金额」那一面)。
 *
 * 判决没变(还是新做),变的只有钱 —— 价格配置在报价与扣费之间改过的情形。判决对签拦不住
 * 它,只有**金额上限**拦得住,所以这一档必须单独证。
 */
let lockTimeSurcharge = 0;

/**
 * The one thing the REAL startGen does before anything else in the transaction that commits a
 * charge (#744 判官 r2 P1): it runs the approval gate the request carries, against that
 * transaction's own client, and translates a refusal with the shared translator. Every stand-in
 * for startGen in this file goes through here, so the double can never be more permissive than
 * the real thing.
 *
 * `tx` is the money transaction's client. Passing a broken one is how a test injects the faults
 * that can happen there for real — the lock statement failing, the persisted plan being
 * unreadable, the fingerprint re-derivation throwing.
 */
async function runCarriedGate(
  req: unknown,
  tx: unknown = h.prisma,
): Promise<{ error: string; disposition: "conflict" | "retryable" } | null> {
  const gate = campaignApprovalGateFor(req);
  if (!gate) return null;
  try {
    await applyCampaignApprovalGate(tx as never, gate);
    return null;
  } catch (error) {
    const refusal = campaignApprovalGateRefusal(error);
    if (!refusal) throw error;
    return refusal;
  }
}

/**
 * 门的**后半扇**(#749 判官 r2 P1),真 startGen 在项目锁里算出判决之后、create/reserve
 * 之前跑的那一次。替身也必须走它,否则替身会比真库宽容,这条 TOCTOU 就测不出来。
 */
function runCarriedVerdict(
  req: unknown,
  verdict: { disposition: "fresh" | "reused"; displayCredits: number; exactReplay: boolean },
): { error: string; disposition: "conflict" | "retryable" } | null {
  const gate = campaignApprovalGateFor(req);
  if (!gate) return null;
  try {
    applyCampaignDispatchVerdict(gate, verdict);
    return null;
  } catch (error) {
    const refusal = campaignApprovalGateRefusal(error);
    if (!refusal) throw error;
    return refusal;
  }
}

/** A money-transaction client whose plan re-read is broken the way a database fault breaks it. */
function txWithBrokenPlanRead(): unknown {
  return {
    $executeRaw: h.prisma.$executeRaw,
    campaign: { findFirst: async () => { throw new Error("plan re-read unavailable"); } },
  };
}

/** …and one whose advisory-lock statement fails. */
function txWithBrokenLock(): unknown {
  return {
    $executeRaw: async () => { throw new Error("advisory lock unavailable"); },
    campaign: { findFirst: h.prisma.campaign.findFirst },
  };
}

/** …and one that hands back a plan the REAL fingerprint closure cannot walk, so the closure the
 *  confirm action built throws while re-deriving the approval. */
function txWhereFingerprintThrows(): unknown {
  return {
    $executeRaw: h.prisma.$executeRaw,
    campaign: {
      findFirst: async () => ({
        planJson: { get entries(): unknown { throw new Error("plan entries unreadable"); } },
      }),
    },
  };
}

function entry(id: string, over: Partial<{ format: string; brief: string; hook: string; status: string; platform: string }> = {}) {
  return {
    id,
    date: "2026-07-25",
    platform: over.platform ?? "instagram",
    format: over.format ?? "image",
    hook: over.hook ?? `hook ${id}`,
    brief: over.brief ?? `brief for ${id} with letters`,
    estCredits: 999,
    status: over.status ?? "approved",
  };
}

function seedCampaign(entries: ReturnType<typeof entry>[], ownerId = OWNER) {
  h.store.campaigns.set(CAMPAIGN_ID, {
    id: CAMPAIGN_ID,
    ownerId,
    name: "Raya Sale",
    planJson: { theme: "t", rationale: null, entries, ideas: [] },
    deletedAt: null,
  });
}

function seedProject(campaignId: string | null = CAMPAIGN_ID, ownerId = OWNER, id = PROJECT_ID) {
  h.store.projects.set(id, { id, ownerId, campaignId, deletedAt: null });
}

function rawRequest(expectedTotalCredits: number, expectedContentFingerprint = VALID_UNKNOWN_FINGERPRINT) {
  return { campaignId: CAMPAIGN_ID, projectId: PROJECT_ID, expectedTotalCredits, expectedContentFingerprint };
}

type QuoteOptions = {
  projectId?: string | null;
  videoSpec?: { resolution: string; durationSeconds: number } | null;
};

async function currentQuoteResult(options?: QuoteOptions) {
  const quoted = await quoteCampaignGeneration(CAMPAIGN_ID, options);
  if (!("ok" in quoted)) throw new Error(quoted.error);
  return quoted;
}

async function currentQuote(options?: QuoteOptions) {
  return (await currentQuoteResult(options)).quote;
}

type ReviewedQuote = Awaited<ReturnType<typeof currentQuote>>;

/**
 * 商家**看着卡确认**的那份请求(#708 修复轮 P1-1):价格、内容、以及他复核时会被交付的
 * 那一组条目,三样一起签。`rawRequest` 保留原样,代表「没经过确认卡」的调用方 —— 那一路
 * 按最严处理,是另一条断言。
 */
function signedRequest(quote: ReviewedQuote, over: Record<string, unknown> = {}) {
  return {
    ...rawRequest(quote.totalDisplayCredits, quote.contentFingerprint),
    expectedDeliveryFingerprint: quote.deliveryFingerprint,
    ...over,
  };
}

async function reviewedRequest(over: Partial<ReturnType<typeof rawRequest>> = {}) {
  const quote = await currentQuote();
  return {
    ...rawRequest(quote.totalDisplayCredits, quote.contentFingerprint),
    ...over,
  };
}

function campaignBatchId() {
  return createHash("sha256")
    .update("campaign-gen-batch-v1")
    .update("\0")
    .update(CAMPAIGN_ID)
    .update("\0")
    .update(PROJECT_ID)
    .digest("hex")
    .slice(0, 32);
}

function storedMaterial(prompt: string) {
  return normalizeFactoryMaterial({ prompt, model: "seedream", kind: "image", count: 1, entityIds: [] });
}

beforeEach(() => {
  h.store.campaigns.clear();
  h.store.projects.clear();
  h.store.creditAccounts.clear();
  h.store.batches.clear();
  h.store.jobs.clear();
  failPrompts = new Set();
  lockTimeSurcharge = 0;
  vi.clearAllMocks();
  h.requireOwner.mockResolvedValue({ email: "o@example.test", ownerId: OWNER });
  h.isImpersonating.mockResolvedValue(false);
  h.store.creditAccounts.set(OWNER, 100 * INTERNAL_PER_DISPLAY);

  // Faithful model of startGen's owner+project-scoped, lock-time factory verdict — including
  // the approval gate it now runs first, inside the transaction that commits the charge.
  h.startGen.mockImplementation(async (req: Record<string, unknown>) => {
    const refused = await runCarriedGate(req);
    if (refused) return refused;
    if (failPrompts.has(req.prompt as string)) return { error: "Not enough credits." };
    const key = req.idempotencyKey as string;
    const parsed = parseFactoryAttemptKey(key);
    if (!parsed) return { error: "not a factory key" };
    const material = normalizeFactoryMaterial({
      prompt: req.prompt as string,
      model: req.model as string,
      kind: (req.kind as "image" | "video") ?? "image",
      count: req.count as number,
      entityIds: req.entityIds as string[] | undefined,
      // #643 T2：形状是真 startGen 材料的一部分，替身漏掉它就会比真库宽容，
      // 「换了形状还当成同一份内容」这类缺陷永远测不出来。
      aspectRatio: req.aspectRatio as string | undefined,
      // #709 同理：档位（时长/分辨率）也是材料的一部分，是**冻结形状**里那两格。
      resolution: req.resolution as string | undefined,
      durationSeconds: req.durationSeconds as number | undefined,
    });
    const priors = [...h.store.jobs.values()].filter(
      (job) =>
        job.ownerId === OWNER &&
        job.projectId === req.projectId &&
        String(job.idempotencyKey ?? "").startsWith(parsed.logicalPrefix),
    );
    if (priors.some((prior) => !factoryMaterialMatches(prior as never, material))) {
      return { error: "That batchId is already in use for different content.", disposition: "conflict" as const };
    }
    // #749：复用与新建两条路都要过后半扇门,和真 startGen 逐点对应。
    const exact = priors.find((prior) => prior.idempotencyKey === key);
    if (exact) {
      const refusedReplay = runCarriedVerdict(req, {
        disposition: "reused",
        displayCredits: 0,
        exactReplay: true,
      });
      if (refusedReplay) return refusedReplay;
      return { id: exact.id as string, disposition: "reused" as const };
    }
    const nonFailed = priors.find((prior) => prior.status !== "FAILED");
    if (nonFailed) {
      const refusedReuse = runCarriedVerdict(req, {
        disposition: "reused",
        displayCredits: 0,
        exactReplay: false,
      });
      if (refusedReuse) return refusedReuse;
      return { id: nonFailed.id as string, disposition: "reused" as const };
    }
    // 真 startGen 拿 `pricedGenCredits` 算出这一格真会预扣的数;替身用同一个权威
    // (`quoteCell` 就是它)——对签的若不是真会扣的那个数,这道闸就是装饰品。
    const refusedFresh = runCarriedVerdict(req, {
      disposition: "fresh",
      displayCredits: displayCredits(quoteCell({
        type: "gen",
        prompt: req.prompt as string,
        kind: (req.kind as "image" | "video") ?? "image",
        model: req.model as string,
        count: req.count as number,
        aspectRatio: req.aspectRatio as string | undefined,
        resolution: req.resolution as string | undefined,
        durationSeconds: req.durationSeconds as number | undefined,
      })) + lockTimeSurcharge,
      exactReplay: false,
    });
    if (refusedFresh) return refusedFresh;
    const id = `job-${h.store.jobs.size}`;
    h.store.jobs.set(id, {
      id,
      ownerId: OWNER,
      projectId: req.projectId,
      batchId: null,
      status: "QUEUED",
      idempotencyKey: key,
      ...material,
    });
    return { id, disposition: "fresh" as const };
  });
});

describe("quoteCampaignGeneration — server-recomputed price + content binding", () => {
  it("returns the current display balance from a read scoped to requireOwner's ownerId", async () => {
    seedCampaign([entry("E1")]);
    h.store.creditAccounts.set(OWNER, 37 * INTERNAL_PER_DISPLAY);

    const result = await quoteCampaignGeneration(CAMPAIGN_ID);

    expect(result).toMatchObject({ ok: true, balanceDisplayCredits: 37 });
    expect(h.creditAccountFindUnique).toHaveBeenCalledWith({
      where: { orgId: OWNER },
      select: { balance: true },
    });
  });

  it("returns a zero display balance when the owner's CreditAccount is missing", async () => {
    seedCampaign([entry("E1")]);
    h.store.creditAccounts.delete(OWNER);

    expect(await quoteCampaignGeneration(CAMPAIGN_ID)).toMatchObject({
      ok: true,
      balanceDisplayCredits: 0,
    });
  });

  it("prices only approved entries from config and returns a deterministic fingerprint", async () => {
    seedCampaign([
      entry("E1"),
      entry("E2"),
      entry("E3", { format: "video" }),
      entry("E4", { status: "proposed" }),
    ]);
    const quote = await currentQuote();
    expect(quote.count).toBe(3);
    expect(quote.lines.map((line) => line.kind)).toEqual(["image", "image", "video"]);
    expect(quote.lines.map((line) => line.displayCredits)).toEqual([IMG, IMG, VID]);
    expect(quote.totalDisplayCredits).toBe(IMG + IMG + VID);
    expect(quote.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await currentQuote()).contentFingerprint).toBe(quote.contentFingerprint);
  });

  it("changing format changes the live-config price", async () => {
    seedCampaign([entry("E1", { format: "image" })]);
    const asImage = await currentQuote();
    seedCampaign([entry("E1", { format: "video" })]);
    const asVideo = await currentQuote();
    expect(asImage.totalDisplayCredits).toBe(IMG);
    expect(asVideo.totalDisplayCredits).toBe(VID);
    expect(asVideo.contentFingerprint).not.toBe(asImage.contentFingerprint);
  });

  it("returns an empty quote when nothing is approved", async () => {
    seedCampaign([entry("E1", { status: "proposed" })]);
    const quote = await currentQuote();
    expect(quote.count).toBe(0);
    expect(quote.totalDisplayCredits).toBe(0);
    expect(quote.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is owner-scoped and denies no-session reads", async () => {
    seedCampaign([entry("E1")], OTHER_OWNER);
    expect(await quoteCampaignGeneration(CAMPAIGN_ID)).toEqual({ error: "Campaign not found." });
    h.requireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await quoteCampaignGeneration(CAMPAIGN_ID)).toEqual({ error: "Not authorized." });
  });
});

// ---------------------------------------------------------------------------
// #643 T2 —— 商家在计划里写的格式名，就是他要的东西的形状
// ---------------------------------------------------------------------------
describe("战役格式 → 交付形状(#643 T2)", () => {
  const cellsFor = async (formats: string[]) => {
    seedCampaign(formats.map((format, i) => entry(`E${i + 1}`, { format, brief: `brief ${i} letters` })));
    seedProject();
    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    return h.startGen.mock.calls.map((call) => call[0] as Record<string, unknown>);
  };

  it("竖版格式（story）⇒ 9:16 —— 不再交付一张横竖不分的方图", async () => {
    const [req] = await cellsFor(["story"]);
    expect(req!.kind).toBe("image");
    expect(req!.aspectRatio).toBe("9:16");
  });

  it("Feed / 方图格式 ⇒ 1:1", async () => {
    const reqs = await cellsFor(["feed", "post", "carousel"]);
    expect(reqs.map((r) => r.aspectRatio)).toEqual(["1:1", "1:1", "1:1"]);
  });

  it("横版格式（banner）⇒ 16:9", async () => {
    const [req] = await cellsFor(["banner"]);
    expect(req!.aspectRatio).toBe("16:9");
  });

  it("表上没有的格式 ⇒ 默认方图（不去猜商家的意图）", async () => {
    const [req] = await cellsFor(["something_new"]);
    expect(req!.aspectRatio).toBe("1:1");
  });

  it("#645 T4：竖版片子位（reel）交付 9:16；名字没说形状的片子格式仍由视频侧默认档决定", async () => {
    // #645 T4：片子侧现在也有形状映射 —— "reel" 是平台上的竖版位，所以它交付 9:16。
    // 名字没说形状的片子格式（video）仍然不带形状，由视频侧的默认档决定。
    const [reel, plain] = await cellsFor(["reel", "video"]);
    expect(reel!.kind).toBe("video");
    expect(reel!.aspectRatio).toBe("9:16");
    expect(plain!.kind).toBe("video");
    expect(plain!.aspectRatio).toBeUndefined();
  });

  it("商家复核页看到的形状 = 真发出去的形状（同一个值，不是两次推导）", async () => {
    seedCampaign([entry("E1", { format: "story" }), entry("E2", { format: "banner" })]);
    seedProject();
    const quote = await currentQuote();
    expect(quote.lines.map((line) => line.aspectRatio)).toEqual(["9:16", "16:9"]);

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    const sent = h.startGen.mock.calls.map((call) => (call[0] as Record<string, unknown>).aspectRatio);
    expect(sent).toEqual(quote.lines.map((line) => line.aspectRatio));
  });

  it("形状进内容指纹：复核之后形状被改掉，确认必须被挡下", async () => {
    seedCampaign([entry("E1", { format: "story" })]);
    seedProject();
    const reviewed = await reviewedRequest();

    // 商家复核的是竖版；此刻计划被改成了方图位。
    seedCampaign([entry("E1", { format: "feed" })]);
    const res = await confirmCampaignGeneration(reviewed);
    expect("error" in res && res.error).toMatch(/changed since you reviewed it/);
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

// #744 判官 r1 P1-2, the confirm side of the gate.
//
// The pre-dispatch fingerprint check happens ONCE, before the loop. Everything the loop then
// spends is spent against a plan that may already have moved. These prove the per-cell gate:
// the persisted plan is re-read under the campaign approval lock immediately before each cell,
// so an undo that lands mid-batch stops every cell that has not been charged yet.
describe("confirmCampaignGeneration — an undo landing mid-batch stops the rest", () => {
  it("charges the cell already dispatched and refuses every later one, spending nothing more", async () => {
    seedCampaign([entry("E1"), entry("E2"), entry("E3")]);
    seedProject();
    const reviewed = await reviewedRequest();

    // The merchant presses Undo on E3 while the batch is running: the persisted plan changes
    // after E1 has been dispatched and before E2 is.
    h.startGen.mockImplementation(async (req: Record<string, unknown>) => {
      // Cell 1 passes its gate and commits its charge; the undo lands immediately after.
      const refused = await runCarriedGate(req);
      if (refused) return refused;
      if (h.startGen.mock.calls.length === 1) {
        seedCampaign([entry("E1"), entry("E2"), entry("E3", { status: "proposed" })]);
      }
      return { id: `job-${String(req.prompt)}`, disposition: "fresh" as const };
    });

    const res = await confirmCampaignGeneration(reviewed);
    if (!("ok" in res)) throw new Error(res.error);

    // One cell charged, the other two refused at the gate — not dispatched, not charged.
    // The gate lives inside startGen's money transaction now (#744 判官 r2 P1), so startGen is
    // entered once per cell and turns two of them away before create/reserve; what matters is
    // that exactly ONE call ever got past the gate.
    expect(h.startGen).toHaveBeenCalledTimes(3);
    const outcomes = await Promise.all(
      h.startGen.mock.results.map((result) => result.value as Promise<Record<string, unknown>>),
    );
    expect(outcomes.filter((outcome) => "id" in outcome)).toHaveLength(1);
    expect(res.result.dispatched).toBe(1);
    expect(res.result.failed).toBe(2);
    expect(res.result.cells.filter((cell) => cell.status === "error").map((cell) => cell.credits))
      .toEqual([0, 0]);
    expect(res.result.cells[1].error).toMatch(/approved list changed while this was starting/);
  });

  it("takes the campaign approval lock once per cell, and only that lock", async () => {
    h.advisoryLocks.length = 0;
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    h.startGen.mockImplementation(async (req: Record<string, unknown>) =>
      (await runCarriedGate(req)) ?? { id: "job", disposition: "fresh" as const });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(h.advisoryLocks).toEqual([
      `campaign-approval:${CAMPAIGN_ID}`,
      `campaign-approval:${CAMPAIGN_ID}`,
    ]);
  });

  it("carries the gate on every request handed to startGen — an ungated cell would be an ungated charge", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(h.startGen.mock.calls).toHaveLength(2);
    // Losing the gate on the way to startGen would be silent — the cell would simply dispatch
    // without ever checking the plan. Pin it per call, not once.
    for (const [req] of h.startGen.mock.calls) {
      expect(campaignApprovalGateFor(req)).toBeDefined();
    }
  });

  // #744 判官 r2 P2 — the gate's three failure modes, each injected into the client of the
  // transaction that would commit the charge. None of them may be read as "the approval still
  // stands": a check that could not complete stops the dispatch exactly like a check that said
  // no, and nothing is created and nothing is charged.
  it("dispatches nothing when the approval lock cannot be taken", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    h.startGen.mockImplementation(async (req: Record<string, unknown>) =>
      (await runCarriedGate(req, txWithBrokenLock())) ?? { id: "job", disposition: "fresh" as const });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(0);
    expect(res.result.failed).toBe(2);
    expect(res.result.cells.map((cell) => cell.error)).toEqual([
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
    ]);
    expect(res.result.cells.map((cell) => cell.credits)).toEqual([0, 0]);
    expect(h.store.jobs.size).toBe(0);
  });

  it("dispatches nothing when the persisted plan cannot be re-read under the lock", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    h.startGen.mockImplementation(async (req: Record<string, unknown>) =>
      (await runCarriedGate(req, txWithBrokenPlanRead())) ?? { id: "job", disposition: "fresh" as const });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(0);
    expect(res.result.cells.map((cell) => cell.error)).toEqual([
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
    ]);
    expect(h.store.jobs.size).toBe(0);
  });

  it("dispatches nothing when re-deriving the approval fingerprint throws", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    h.startGen.mockImplementation(async (req: Record<string, unknown>) =>
      (await runCarriedGate(req, txWhereFingerprintThrows())) ?? { id: "job", disposition: "fresh" as const });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(0);
    expect(res.result.cells.map((cell) => cell.error)).toEqual([
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
      CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
    ]);
    expect(h.store.jobs.size).toBe(0);
  });
});

describe("confirmCampaignGeneration — persisted plan and strict approval binding", () => {
  it("dispatches only approved persisted briefs through parseable 79-char factory keys", async () => {
    seedCampaign([
      entry("E1", { brief: "sunset product shot" }),
      entry("E2", { status: "proposed", brief: "should never generate" }),
      entry("E3", { brief: "flat lay on marble" }),
    ]);
    seedProject();
    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.cells).toHaveLength(2);
    expect(res.result.dispatched).toBe(2);
    expect(h.startGen.mock.calls.map((call) => (call[0] as Record<string, unknown>).prompt))
      .toEqual(["sunset product shot", "flat lay on marble"]);
    for (const call of h.startGen.mock.calls) {
      const key = (call[0] as Record<string, unknown>).idempotencyKey as string;
      expect(key).toHaveLength(79);
      expect(parseFactoryAttemptKey(key)).not.toBeNull();
    }
  });

  it("rejects missing/forged fingerprints before batch creation or dispatch", async () => {
    seedCampaign([entry("E1")]);
    seedProject();
    const quote = await currentQuote();
    expect(await confirmCampaignGeneration({
      campaignId: CAMPAIGN_ID,
      projectId: PROJECT_ID,
      expectedTotalCredits: quote.totalDisplayCredits,
    })).toEqual({ error: "That generation request is out of bounds." });
    const forged = await confirmCampaignGeneration(rawRequest(quote.totalDisplayCredits, "f".repeat(64)));
    expect("error" in forged && forged.error).toMatch(/plan changed/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.jobs.size).toBe(0);
    expect(h.store.batches.size).toBe(0);
  });

  it("rejects equal-total brief drift and requires re-review — zero dispatch", async () => {
    seedCampaign([entry("E1", { brief: "red product on marble" })]);
    seedProject();
    const reviewed = await currentQuote();
    seedCampaign([entry("E1", { brief: "blue product on marble" })]);
    const changed = await currentQuote();
    expect(changed.totalDisplayCredits).toBe(reviewed.totalDisplayCredits);
    expect(changed.contentFingerprint).not.toBe(reviewed.contentFingerprint);

    const res = await confirmCampaignGeneration(
      rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint),
    );
    expect("error" in res && res.error).toMatch(/plan changed since you reviewed/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.jobs.size).toBe(0);
    expect(h.store.batches.size).toBe(0);
  });

  it("rejects duplicate approved entry ids before dispatch", async () => {
    seedCampaign([
      entry("DUP", { brief: "first material" }),
      entry("DUP", { brief: "second material" }),
    ]);
    seedProject();
    const res = await confirmCampaignGeneration(await reviewedRequest());
    expect("error" in res && res.error).toMatch(/stable cell ids must be unique/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.batches.size).toBe(0);
  });

  it("returns empty-plan and impersonation blocks before spend", async () => {
    seedCampaign([entry("E1", { status: "proposed" })]);
    seedProject();
    expect(await confirmCampaignGeneration(await reviewedRequest()))
      .toEqual({ error: "Approve at least one plan entry before generating." });
    seedCampaign([entry("E1")]);
    h.isImpersonating.mockResolvedValue(true);
    const blocked = await confirmCampaignGeneration(await reviewedRequest());
    expect("error" in blocked && blocked.error).toMatch(/impersonating/i);
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

describe("confirmCampaignGeneration — order-independent exactly-once + migration", () => {
  it("late approval shifts the filtered order but charges only the newly approved entry", async () => {
    seedCampaign([
      entry("E1", { status: "proposed", brief: "newly approved later" }),
      entry("E2", { brief: "already generated" }),
    ]);
    seedProject();
    const first = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result).toMatchObject({ dispatched: 1, reused: 0 });
    const originalE2Job = first.result.cells[0].jobId;

    seedCampaign([
      entry("E1", { brief: "newly approved later" }),
      entry("E2", { brief: "already generated" }),
    ]);
    const second = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in second)) throw new Error(second.error);
    expect(second.result).toMatchObject({
      dispatched: 1,
      reused: 1,
      failed: 0,
      totalCredits: INTERNAL_PER_DISPLAY,
    });
    expect(second.result.cells[1].jobId).toBe(originalE2Job);
    expect(h.store.jobs.size).toBe(2);
  });

  it("reordering approved entries reuses entry-bound jobs with zero new charge", async () => {
    seedCampaign([
      entry("E1", { brief: "material A" }),
      entry("E2", { brief: "material B" }),
    ]);
    seedProject();
    const firstQuote = await currentQuote();
    const first = await confirmCampaignGeneration(rawRequest(firstQuote.totalDisplayCredits, firstQuote.contentFingerprint));
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);
    const jobsByPrompt = new Map([...h.store.jobs.values()].map((job) => [job.prompt, job.id]));

    seedCampaign([
      entry("E2", { brief: "material B" }),
      entry("E1", { brief: "material A" }),
    ]);
    const reorderedQuote = await currentQuote();
    expect(reorderedQuote.contentFingerprint).toBe(firstQuote.contentFingerprint);
    const second = await confirmCampaignGeneration(
      rawRequest(reorderedQuote.totalDisplayCredits, reorderedQuote.contentFingerprint),
    );
    if (!("ok" in second)) throw new Error(second.error);
    expect(second.result).toMatchObject({ dispatched: 0, reused: 2, failed: 0, totalCredits: 0 });
    expect(second.result.cells.map((cell) => cell.jobId))
      .toEqual([jobsByPrompt.get("material B"), jobsByPrompt.get("material A")]);
    expect(h.store.jobs.size).toBe(2);
  });

  it("replays pre-deployment positional DONE jobs after order drift — zero recharge", async () => {
    seedCampaign([
      entry("E2", { brief: "legacy B" }),
      entry("E1", { brief: "legacy A" }),
    ]);
    seedProject();
    const batchId = campaignBatchId();
    h.store.batches.set(batchId, { id: batchId, ownerId: OWNER });
    h.store.jobs.set("legacy-a", {
      id: "legacy-a", ownerId: OWNER, projectId: PROJECT_ID, batchId, status: "DONE",
      idempotencyKey: factoryAttemptKey(batchId, 0, "old-attempt").key,
      ...storedMaterial("legacy A"),
    });
    h.store.jobs.set("legacy-b", {
      id: "legacy-b", ownerId: OWNER, projectId: PROJECT_ID, batchId, status: "DONE",
      idempotencyKey: factoryAttemptKey(batchId, 1, "old-attempt").key,
      ...storedMaterial("legacy B"),
    });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 0, reused: 2, failed: 0, totalCredits: 0 });
    expect(res.result.cells.map((cell) => cell.jobId)).toEqual(["legacy-b", "legacy-a"]);
    expect(h.store.jobs.size).toBe(2);
  });

  it("fails closed when legacy rows cannot be mapped to a current stable entry", async () => {
    seedCampaign([entry("E1", { brief: "edited legacy material" })]);
    seedProject();
    const batchId = campaignBatchId();
    h.store.jobs.set("legacy-original", {
      id: "legacy-original", ownerId: OWNER, projectId: PROJECT_ID, batchId, status: "DONE",
      idempotencyKey: factoryAttemptKey(batchId, 0, "old-attempt").key,
      ...storedMaterial("original legacy material"),
    });
    const res = await confirmCampaignGeneration(await reviewedRequest());
    expect("error" in res && res.error).toMatch(/cannot safely match/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.jobs.size).toBe(1);
    expect(h.store.batches.size).toBe(0);
  });

  it("concurrent opposite-order confirms create one job per stable entry", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const reviewed = await reviewedRequest();
    const [first, second] = await Promise.all([
      confirmCampaignGeneration(reviewed),
      confirmCampaignGeneration(reviewed),
    ]);
    if (!("ok" in first) || !("ok" in second)) throw new Error("confirm failed");
    expect(h.store.jobs.size).toBe(2);
    expect(first.result.dispatched + second.result.dispatched).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #708 —— 卡上写的那个数，就是确认之后真会离开余额的那个数
// ---------------------------------------------------------------------------
describe("#708 战役确认卡报的是真会收的钱", () => {
  it("已生成的条目计 0：实收 1 credit 的动作不再被报成 12 credits", async () => {
    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P1", { brief: "old post with letters" }),
    ]);
    seedProject();
    const first = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);

    // 计划里换掉那张图：片子已经生成过（复用、不再收费），图是全新的。
    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P2", { brief: "brand new post with letters" }),
    ]);

    const quote = await currentQuote({ projectId: PROJECT_ID });
    expect(quote.lines.map((line) => line.charge)).toEqual(["reused", "new"]);
    expect(quote.lines.map((line) => line.displayCredits)).toEqual([0, IMG]);
    // 全价照旧说得出口 —— 商家有权知道那 11 credits 的差额是怎么回事。
    expect(quote.lines.map((line) => line.fullDisplayCredits)).toEqual([VID, IMG]);
    expect(quote.reusedCount).toBe(1);
    expect(quote.blockedCount).toBe(0);
    expect(quote.totalDisplayCredits).toBe(IMG); // 修前:VID + IMG = 12
  });

  it("确认之后真会扣的,就是卡上那个数(报价 == 这一趟的预扣)", async () => {
    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P1", { brief: "old post with letters" }),
    ]);
    seedProject();
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");

    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P2", { brief: "brand new post with letters" }),
    ]);
    const quote = await currentQuote({ projectId: PROJECT_ID });
    const res = await confirmCampaignGeneration(
      rawRequest(quote.totalDisplayCredits, quote.contentFingerprint),
    );
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 1, reused: 1, failed: 0 });
    // BatchResult.totalCredits = 这一趟真正预扣的内部 credits。
    expect(res.result.totalCredits).toBe(quote.totalDisplayCredits * INTERNAL_PER_DISPLAY);
  });

  it("余额只够那笔新费用时,报价与余额同侧 —— 商家不再被一个他不用付的差额挡住", async () => {
    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P1", { brief: "old post with letters" }),
    ]);
    seedProject();
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");

    seedCampaign([
      entry("V1", { format: "reel", brief: "reel brief with letters" }),
      entry("P2", { brief: "brand new post with letters" }),
    ]);
    h.store.creditAccounts.set(OWNER, 5 * INTERNAL_PER_DISPLAY);
    const quoted = await currentQuoteResult({ projectId: PROJECT_ID });
    expect(quoted.balanceDisplayCredits).toBe(5);
    expect(quoted.quote.totalDisplayCredits).toBeLessThanOrEqual(quoted.balanceDisplayCredits);
  });

  it("内容改过、这一趟不会被受理的条目也计 0(收不了的钱不许报出来)", async () => {
    seedCampaign([entry("E1", { brief: "original brief with letters" })]);
    seedProject();
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");

    seedCampaign([entry("E1", { brief: "edited brief with letters" })]);
    const quote = await currentQuote({ projectId: PROJECT_ID });
    expect(quote.lines[0].charge).toBe("blocked");
    expect(quote.blockedCount).toBe(1);
    expect(quote.totalDisplayCredits).toBe(0);
  });

  it("目的项目未知时按全价报 —— 宁可多报,绝不少报", async () => {
    seedCampaign([entry("E1", { brief: "already generated letters" })]);
    seedProject();
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");

    const blind = await currentQuote();
    expect(blind.lines[0].charge).toBe("new");
    expect(blind.totalDisplayCredits).toBe(IMG);
  });

  it("换目的项目会重新报价 —— 另一个项目里没有这份历史,价就该回到全价", async () => {
    seedCampaign([entry("E1", { brief: "already generated letters" })]);
    seedProject();
    seedProject(CAMPAIGN_ID, OWNER, "prj_other");
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");

    expect((await currentQuote({ projectId: PROJECT_ID })).totalDisplayCredits).toBe(0);
    expect((await currentQuote({ projectId: "prj_other" })).totalDisplayCredits).toBe(IMG);
  });
});

// ---------------------------------------------------------------------------
// #709 —— 11 credits 买的是哪一档，卡上得有字；半价档要选得到
// ---------------------------------------------------------------------------
describe("#709 战役确认卡说清片子的规格,并且能选半价档", () => {
  it("视频行写明形状 / 时长 / 分辨率 / 声音 —— 修前一个规格字段都没有", async () => {
    seedCampaign([entry("V1", { format: "reel" }), entry("V2", { format: "video" })]);
    const quote = await currentQuote();
    expect(quote.lines[0].specChips).toEqual(["9:16", "5s", "720p", "With sound"]);
    // 名字没说形状的片子格式(video)走默认档形状 —— 那个形状也必须被说出口，
    // 而不是像修前那样卡上一个字都没有。
    expect(quote.lines[1].specChips).toEqual(["16:9", "5s", "720p", "With sound"]);
    expect(quote.lines.map((line) => line.displayCredits)).toEqual([VID, VID]);
  });

  it("图片行不重复第二套规格话术(形状已在 aspectRatio 上说过)", async () => {
    seedCampaign([entry("E1", { format: "story" })]);
    const quote = await currentQuote();
    expect(quote.lines[0].specChips).toEqual([]);
    expect(quote.lines[0].aspectRatio).toBe("9:16");
  });

  it("选 480p 半价档:报价按中央价目表减半,而且这一档真送进付费请求", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    seedProject();
    const videoSpec = { resolution: "480p", durationSeconds: 5 };
    const quote = await currentQuote({ projectId: PROJECT_ID, videoSpec });
    expect(quote.totalDisplayCredits).toBe(VID_480);
    expect(quote.lines[0].specChips).toEqual(["9:16", "5s", "480p", "With sound"]);

    const res = await confirmCampaignGeneration({
      ...rawRequest(quote.totalDisplayCredits, quote.contentFingerprint),
      videoSpec,
    });
    if (!("ok" in res)) throw new Error(res.error);
    const req = h.startGen.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.resolution).toBe("480p");
    expect(req.durationSeconds).toBe(5);
    expect(res.result.totalCredits).toBe(VID_480 * INTERNAL_PER_DISPLAY);
  });

  it("时长也选得到,价按秒表走(10s 720p = 已裁的 22 credits)", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    const quote = await currentQuote({ videoSpec: { resolution: "720p", durationSeconds: 10 } });
    expect(quote.totalDisplayCredits).toBe(22);
    expect(quote.lines[0].specChips).toContain("10s");
  });

  it("档位菜单与默认档来自中央配置,不是这条路自己发明的", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    const menu = (await currentQuoteResult()).videoMenu;
    const options = GEN_VIDEO_MODEL_OPTIONS[activeVideoModel() as keyof typeof GEN_VIDEO_MODEL_OPTIONS];
    expect(menu.resolutions).toEqual(options.resolutions);
    expect(menu.durations).toEqual(options.durations);
    expect(menu.selected).toEqual({
      resolution: options.defaults?.resolution,
      durationSeconds: options.defaults?.seconds,
    });
  });

  it("菜单外的档一律拒绝,绝不悄悄回落默认档然后按另一个价收钱", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    seedProject();
    const offMenu = { resolution: "1080p", durationSeconds: 5 };
    expect(await quoteCampaignGeneration(CAMPAIGN_ID, { videoSpec: offMenu }))
      .toMatchObject({ error: expect.stringMatching(/isn't available/i) });

    const reviewed = await currentQuote();
    const res = await confirmCampaignGeneration({
      ...rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint),
      videoSpec: offMenu,
    });
    expect("error" in res && res.error).toMatch(/isn't available/i);
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("档位进内容指纹:复核的是 720p、确认送的是 480p,必须被挡在花钱之前", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    seedProject();
    const reviewed = await currentQuote();
    const cheaper = await currentQuote({ videoSpec: { resolution: "480p", durationSeconds: 5 } });
    expect(cheaper.contentFingerprint).not.toBe(reviewed.contentFingerprint);

    const res = await confirmCampaignGeneration({
      ...rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint),
      videoSpec: { resolution: "480p", durationSeconds: 5 },
    });
    expect("error" in res && res.error).toMatch(/plan changed since you reviewed/i);
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("确认冻结档位:那一单的快照留在 720p,事后改档不动它,也不再收一次钱(#657 先例)", async () => {
    seedCampaign([entry("V1", { format: "reel" })]);
    seedProject();
    const reviewed = await currentQuote();
    if (!("ok" in (await confirmCampaignGeneration(rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint))))) {
      throw new Error("first confirm failed");
    }
    const frozen = [...h.store.jobs.values()][0]!;
    expect(frozen.videoOptions).toMatchObject({ resolution: "720p", seconds: 5 });

    const cheaper = await currentQuote({
      projectId: PROJECT_ID,
      videoSpec: { resolution: "480p", durationSeconds: 5 },
    });
    // 冻结的那一单是 720p：换档 = 换内容，这一趟不会被受理，收 0。
    expect(cheaper.lines[0].charge).toBe("blocked");
    expect(cheaper.totalDisplayCredits).toBe(0);

    // #708 修复轮 P1-1：卡上已经如实写着「这条不会开始」，商家是被问过的 —— 他签的就是
    // 这一组交付面，所以确认得下去。没签交付面的调用方走的是另一条路（一律拒），见下面
    // 那个 describe。
    const res = await confirmCampaignGeneration(
      signedRequest(cheaper, { videoSpec: { resolution: "480p", durationSeconds: 5 } }),
    );
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 0, failed: 1, totalCredits: 0 });
    expect(h.store.jobs.size).toBe(1);
    expect([...h.store.jobs.values()][0]!.videoOptions).toMatchObject({ resolution: "720p", seconds: 5 });
  });
});

// ---------------------------------------------------------------------------
// #708 修复轮 P1-1 —— 少付不等于少交付
// ---------------------------------------------------------------------------
describe("#708 修复轮 P1-1 少付不等于少交付", () => {
  const REEL = "A vertical clip with letters";
  const POST = "A festive still with letters";
  const SPEC_480 = { resolution: "480p", durationSeconds: 5 };

  /**
   * 判官 r1 的那条路,原样搭出来:
   *   ① 商家在这一页复核 —— 两条都会交付,片子是 720p 那一档,合计 12 credits;
   *   ② 另一个标签页先按 480p 确认了同一份计划 —— 片子被冻结在 480p;那张图当时没做成
   *      (FAILED,已退款),所以它这一趟还是新的;
   *   ③ 回到这一页重算:片子这一条已经**不会开始**了,图还是新的 —— 总额从 12 掉到 1。
   * 修之前:1 ≤ 12,价格闸一路放行,商家为一份缩水的交付付了钱,而且从没被问过。
   */
  async function shrunkDelivery() {
    seedCampaign([entry("V1", { format: "reel", brief: REEL }), entry("P1", { brief: POST })]);
    seedProject();
    const reviewed = await currentQuote({ projectId: PROJECT_ID });
    expect(reviewed.lines.map((line) => line.charge)).toEqual(["new", "new"]);
    expect(reviewed.totalDisplayCredits).toBe(VID + IMG);

    const otherTab = await currentQuote({ projectId: PROJECT_ID, videoSpec: SPEC_480 });
    const first = await confirmCampaignGeneration(signedRequest(otherTab, { videoSpec: SPEC_480 }));
    if (!("ok" in first)) throw new Error(first.error);
    [...h.store.jobs.values()].find((job) => job.prompt === POST)!.status = "FAILED";

    const now = await currentQuote({ projectId: PROJECT_ID });
    expect(now.lines.map((line) => line.charge)).toEqual(["blocked", "new"]);
    expect(now.totalDisplayCredits).toBe(IMG);
    // 内容一个字没改 —— 所以旧的两道闸(总额上限、内容指纹)都拦不住它。
    expect(now.contentFingerprint).toBe(reviewed.contentFingerprint);
    expect(now.deliveryFingerprint).not.toBe(reviewed.deliveryFingerprint);

    h.startGen.mockClear();
    return { reviewed, jobsBefore: h.store.jobs.size };
  }

  it("复核之后掉队的条目:停在花钱之前,一格都不派发", async () => {
    const { reviewed, jobsBefore } = await shrunkDelivery();

    const res = await confirmCampaignGeneration(signedRequest(reviewed));

    expect("error" in res && res.error).toMatch(/can no longer be created as reviewed/i);
    expect("error" in res && res.error).toMatch(/nothing was started and nothing was charged/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.jobs.size).toBe(jobsBefore);
  });

  it("没带交付面签名的调用方按最严处理:只要有条目不会开始,一律拒", async () => {
    const { reviewed, jobsBefore } = await shrunkDelivery();

    const res = await confirmCampaignGeneration(
      rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint),
    );

    expect("error" in res && res.error).toMatch(/can no longer be created as reviewed/i);
    expect(h.startGen).not.toHaveBeenCalled();
    expect(h.store.jobs.size).toBe(jobsBefore);
  });

  it("复核时就已如实告知的掉队条目:签的是同一组交付面,确认得下去", async () => {
    await shrunkDelivery();
    // 商家看着更新后的卡重新复核:片子那行写着「不会开始」,图会交付。他签的就是这一组。
    const rechecked = await currentQuote({ projectId: PROJECT_ID });

    const res = await confirmCampaignGeneration(signedRequest(rechecked));

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 1, failed: 1 });
    expect(res.result.totalCredits).toBe(IMG * INTERNAL_PER_DISPLAY);
  });

  it("合法复用不动交付面:重放同一份签名 —— 派发 0 / 复用 2 / 收 0,交付指纹逐字相同", async () => {
    seedCampaign([
      entry("E1", { brief: "material A with letters" }),
      entry("E2", { brief: "material B with letters" }),
    ]);
    seedProject();
    const reviewed = await currentQuote({ projectId: PROJECT_ID });
    const signed = signedRequest(reviewed);

    const first = await confirmCampaignGeneration(signed);
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);

    const replay = await confirmCampaignGeneration(signed);
    if (!("ok" in replay)) throw new Error(replay.error);
    expect(replay.result).toMatchObject({ dispatched: 0, reused: 2, failed: 0, totalCredits: 0 });
    expect(replay.quote.lines.map((line) => line.charge)).toEqual(["reused", "reused"]);
    expect(replay.quote.deliveryFingerprint).toBe(reviewed.deliveryFingerprint);
    expect(h.store.jobs.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #749 判官 r2 P1 —— 锁内对签:签名对得上,不等于花钱那一刻还对得上
// ---------------------------------------------------------------------------
/**
 * 全真账本那一侧的证据在 `campaign-confirm-ledger.test.ts`(真 Postgres、真 startGen、
 * 真 ledger)。这一组补的是**金额上限**那一档:判决没变、钱变了 —— 只有上限拦得住,
 * 而它在真账本里没法自然造出来(价格是中央配置,不许在测试里改)。
 */
describe("#749 判官 r2 P1 锁内对签:金额上限", () => {
  it("锁内这一格的费用高过商家签名时那一格:不派发、不建任务", async () => {
    seedCampaign([entry("P1")]);
    seedProject();
    const reviewed = await currentQuote({ projectId: PROJECT_ID });
    expect(reviewed.lines[0].displayCredits).toBe(IMG);
    expect(reviewed.lines[0].charge).toBe("new");

    // 商家按下确认之后、这一格真扣钱之前,引擎给出的价变高了。
    lockTimeSurcharge = 5;
    const res = await confirmCampaignGeneration(signedRequest(reviewed));

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 0, failed: 1, totalCredits: 0 });
    expect(res.result.cells[0].error).toMatch(/price changed while it was starting/i);
    // 停在 create/reserve 之前 —— 一个任务都没建。
    expect(h.store.jobs.size).toBe(0);
  });

  it("少收照旧放行:锁内更便宜不算超批准", async () => {
    seedCampaign([entry("P1")]);
    seedProject();
    const reviewed = await currentQuote({ projectId: PROJECT_ID });

    lockTimeSurcharge = -1;
    const res = await confirmCampaignGeneration(signedRequest(reviewed));

    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result).toMatchObject({ dispatched: 1, failed: 0 });
    expect(h.store.jobs.size).toBe(1);
  });

  it("对客文案说人话:没有机器码、没有供应商名,而且没有谎称整批都没扣钱", async () => {
    seedCampaign([entry("P1")]);
    seedProject();
    const reviewed = await currentQuote({ projectId: PROJECT_ID });
    lockTimeSurcharge = 5;
    const res = await confirmCampaignGeneration(signedRequest(reviewed));
    if (!("ok" in res)) throw new Error(res.error);

    const copy = res.result.cells[0].error as string;
    expect(copy).not.toMatch(/seedream|seedance|byteplus|kling|CAMPAIGN_|_MID_DISPATCH|undefined|null/i);
    // 说的是「这一件」,不是「整批」—— 同一批里更早派发出去的格是真开始、真扣了钱的。
    expect(copy).toMatch(/this item/i);
  });
});

// ---------------------------------------------------------------------------
// #709 修复轮 P1-2 —— 指纹覆盖面 = 卡面承诺面
// ---------------------------------------------------------------------------
describe("#709 修复轮 P1-2 指纹覆盖面 = 卡面承诺面", () => {
  it("卡面承诺的是**整份**解析后的规格 —— 含 audio 与解析出来的默认画幅", async () => {
    // 名字没说形状的片子格式:cell 上根本没有 aspectRatio,解析之后才有。
    seedCampaign([entry("V1", { format: "video" })]);
    const spec = (await currentQuote()).lines[0].promisedSpec;

    expect(spec).toEqual({
      aspectRatio: "16:9",
      count: 1,
      resolution: "720p",
      durationSeconds: 5,
      // 这台在产引擎不开放帧率控制,解析结果就是 0(= 不指定)。它照样进指纹:承诺面收窄
      // 靠的是「整份都在里面」,不是靠挑出卡上说得出口的那几格。
      fps: 0,
      audio: true,
    });
  });

  it("卡上说得出口的每一格都从 promisedSpec 派生,不是第二次推导", async () => {
    seedCampaign([entry("V1", { format: "reel" }), entry("E1", { format: "story" })]);
    const quote = await currentQuote();

    expect(quote.lines[0].specChips).toEqual(buildSpecChips("video", quote.lines[0].promisedSpec, false));
    expect(quote.lines[1].aspectRatio).toBe(quote.lines[1].promisedSpec.aspectRatio);
    expect(quote.lines[1].promisedSpec).toEqual({ aspectRatio: "9:16", count: 1 });
  });
});

// ---------------------------------------------------------------------------
// #708 修复轮 P2-1 —— 复用不等于做完
// ---------------------------------------------------------------------------
describe("#708 修复轮 P2-1 复用不等于做完", () => {
  async function reusedLineAfterFirstRun(status: string) {
    seedCampaign([entry("E1", { brief: "one reusable material with letters" })]);
    seedProject();
    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("first confirm failed");
    [...h.store.jobs.values()][0]!.status = status;
    return (await currentQuote({ projectId: PROJECT_ID })).lines[0];
  }

  it("还在跑的那一单:复用不收钱,但状态是「还在做」,不是「已完成」", async () => {
    for (const status of ["QUEUED", "GENERATING"]) {
      h.store.jobs.clear();
      const line = await reusedLineAfterFirstRun(status);
      expect(line.charge).toBe("reused");
      expect(line.displayCredits).toBe(0);
      expect(line.reuseState).toBe("in_progress");
    }
  });

  it("真做完了(DONE)才算做完", async () => {
    const line = await reusedLineAfterFirstRun("DONE");
    expect(line.charge).toBe("reused");
    expect(line.reuseState).toBe("done");
  });

  it("没复用的行不带这一格 —— 新建与被挡下的条目都是 null", async () => {
    seedCampaign([entry("E1", { brief: "brand new material with letters" })]);
    seedProject();
    const fresh = await currentQuote({ projectId: PROJECT_ID });
    expect(fresh.lines[0]).toMatchObject({ charge: "new", reuseState: null });

    if (!("ok" in (await confirmCampaignGeneration(await reviewedRequest())))) throw new Error("confirm failed");
    seedCampaign([entry("E1", { brief: "edited material with letters" })]);
    const blocked = await currentQuote({ projectId: PROJECT_ID });
    expect(blocked.lines[0]).toMatchObject({ charge: "blocked", reuseState: null });
  });
});

describe("confirmCampaignGeneration — price consent", () => {
  it("refuses to charge more than the reviewed total before dispatch", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const quote = await currentQuote();
    const stale = await confirmCampaignGeneration(rawRequest(1, quote.contentFingerprint));
    expect("error" in stale && stale.error).toMatch(/changed since you reviewed it/i);
    expect(h.startGen).not.toHaveBeenCalled();
    const ok = await confirmCampaignGeneration(rawRequest(quote.totalDisplayCredits, quote.contentFingerprint));
    if (!("ok" in ok)) throw new Error(ok.error);
    expect(ok.result.dispatched).toBe(2);
  });

  it("#708:收得比批准的少永远放行 —— 否则耐久重试永远走不通", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const reviewed = await currentQuote();
    if (!("ok" in (await confirmCampaignGeneration(rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint))))) {
      throw new Error("first confirm failed");
    }
    // 重放同一份已复核的请求:此刻真会收的是 0(两条都复用),批准的是 2。
    const replay = await confirmCampaignGeneration(rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint));
    if (!("ok" in replay)) throw new Error(replay.error);
    expect(replay.result).toMatchObject({ dispatched: 0, reused: 2, totalCredits: 0 });
    expect(h.store.jobs.size).toBe(2);
  });

  it("catches a post-review format flip", async () => {
    seedCampaign([entry("E1", { format: "image" })]);
    seedProject();
    const reviewed = await currentQuote();
    seedCampaign([entry("E1", { format: "video" })]);
    const res = await confirmCampaignGeneration(
      rawRequest(reviewed.totalDisplayCredits, reviewed.contentFingerprint),
    );
    expect("error" in res && res.error).toMatch(new RegExp(`was 1, now ${VID} credits`, "i"));
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

describe("confirmCampaignGeneration — honest partial failure", () => {
  it("reports returned cell failures as zero-charge and sums only dispatched cells", async () => {
    seedCampaign([
      entry("E1", { brief: "ok one" }),
      entry("E2", { brief: "fails here" }),
      entry("E3", { brief: "ok three" }),
    ]);
    seedProject();
    failPrompts = new Set(["fails here"]);
    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.cells.map((cell) => cell.status)).toEqual(["queued", "error", "queued"]);
    expect(res.result.dispatched).toBe(res.result.cells.filter((cell) => cell.status === "queued").length);
    expect(res.result.dispatched).toBe(2);
    expect(res.result.failed).toBe(1);
    expect(res.result.cells[1]).toMatchObject({ status: "error", credits: 0 });
    expect(res.result.totalCredits).toBe(res.result.cells.reduce((sum, cell) => sum + cell.credits, 0));
    expect(res.result.totalCredits).toBe(2 * INTERNAL_PER_DISPLAY);
    expect(h.startGen).toHaveBeenCalledTimes(3);
    expect(h.store.jobs.size).toBe(2);
  });

  it("returns confirmed dispatch/credit counts when a later startGen outcome is unknown", async () => {
    seedCampaign([
      entry("E1", { brief: "commits first" }),
      entry("E2", { brief: "throws second" }),
      entry("E3", { brief: "never reached" }),
    ]);
    seedProject();
    const normal = h.startGen.getMockImplementation();
    if (!normal) throw new Error("missing startGen implementation");
    let call = 0;
    h.startGen.mockImplementation(async (req: Record<string, unknown>) => {
      if (call++ === 1) throw new Error("connection outcome unknown");
      return normal(req);
    });

    const res = await confirmCampaignGeneration(await reviewedRequest());
    if (!("error" in res) || !res.partial) throw new Error("expected structured partial failure");
    expect(res.partial.current).toBe("unknown");
    expect(res.partial.atIndex).toBe(1);
    expect(res.partial.notStarted).toBe(1);
    expect(res.partial.partial.dispatched).toBe(1);
    expect(res.partial.partial.totalCredits).toBe(INTERNAL_PER_DISPLAY);
    expect(res.partial.partial.cells).toHaveLength(1);
    expect(h.store.jobs.size).toBe(1);
  });
});

describe("confirmCampaignGeneration — RBAC owner-only + fail-closed", () => {
  it("denies no-session and cross-tenant campaigns", async () => {
    h.requireOwner.mockResolvedValue({ error: "Not authorized." });
    seedCampaign([entry("E1")]);
    seedProject();
    expect(await confirmCampaignGeneration(rawRequest(0))).toEqual({ error: "Not authorized." });
    expect(h.startGen).not.toHaveBeenCalled();

    h.requireOwner.mockResolvedValue({ email: "o@example.test", ownerId: OWNER });
    seedCampaign([entry("E1")], OTHER_OWNER);
    expect(await confirmCampaignGeneration(rawRequest(0))).toEqual({ error: "Campaign not found." });
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("rejects ungrouped and cross-tenant projects", async () => {
    seedCampaign([entry("E1")]);
    const quote = await currentQuote();
    seedProject(null);
    expect(await confirmCampaignGeneration(rawRequest(quote.totalDisplayCredits, quote.contentFingerprint)))
      .toEqual({ error: "Choose a project that belongs to this campaign." });
    h.store.projects.set(PROJECT_ID, {
      id: PROJECT_ID, ownerId: OTHER_OWNER, campaignId: CAMPAIGN_ID, deletedAt: null,
    });
    expect(await confirmCampaignGeneration(rawRequest(quote.totalDisplayCredits, quote.contentFingerprint)))
      .toEqual({ error: "Project not found." });
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

describe("money-safety static guards", () => {
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const confirmCode = stripComments(
    readFileSync(path.resolve(__dirname, "../campaign-generation-confirm.ts"), "utf8"),
  );
  const batchCode = stripComments(readFileSync(path.resolve(__dirname, "../factory-batch.ts"), "utf8"));
  const lockCode = stripComments(readFileSync(path.resolve(__dirname, "../campaign-approval-lock.ts"), "utf8"));
  const genCode = stripComments(readFileSync(path.resolve(__dirname, "../gen-actions.ts"), "utf8"));
  const clientCode = readFileSync(
    path.resolve(__dirname, "../../components/campaign/campaign-confirm-page.tsx"),
    "utf8",
  );

  it("opens no ledger/job-create/queue/provider path outside startGen", () => {
    const banned = /reserveCredits|settleCredits|refundReservation|grantCredits|CreditLedger|creditLedger|genJob\s*\.\s*create|generation\s*\.\s*create|boss\s*\.\s*send|GEN_QUEUE|\.\s*\$transaction|provider\s*\./;
    expect(banned.test(confirmCode)).toBe(false);
    expect(banned.test(batchCode)).toBe(false);
    expect(/from\s+["']\.\/gen-actions["']/.test(confirmCode)).toBe(true);
  });

  // #744 判官 r1 P1-2 / r2 P1 — the batch is handed a GUARDED port instead of startGen directly.
  // The guarantee this file has always pinned is unchanged and is now pinned tighter: the wrapper
  // attaches the approval gate and nothing else, and the ONE thing it can call to spend is the
  // real startGen. A wrapper that quietly grew a second spend path would fail here.
  it("hands the batch a gate-carrying port whose only spend call is the real startGen", () => {
    expect(confirmCode).toMatch(
      /orchestrateBatch\(\s*\{\s*startGen:\s*guardedStartGen,\s*prisma\s*\}/,
    );
    expect(confirmCode).toMatch(
      // #749：端口多收一个「这是第几格」的下标(锁内对签要钉到正确的那一行),包装体照旧
      // 只做一件事 —— 把门挂到这一格的请求上,再交给真 startGen。
      /const guardedStartGen: StartGenPort = \(req, cellIndex\) =>\s*startGen\(\s*attachCampaignApprovalGate\(req,/,
    );
    // Exactly one call of the real startGen, and the gate rides on the request it is given.
    expect(confirmCode.match(/(?<![A-Za-z])startGen\(/g)).toHaveLength(1);
  });

  // #744 判官 r2 P1 — PLACEMENT, asserted where it lives. The gate must be applied by the
  // transaction that commits the charge, before the project lock and before create/reserve:
  // that is what makes it impossible for an undo to land between "lock released" and "charge
  // committed". Behaviour is pinned in gen-actions.test.ts; this pins the code shape so the call
  // cannot drift back out of the money transaction unnoticed.
  it("applies the gate inside startGen's money transaction, before the project lock", () => {
    const txStart = genCode.indexOf("decision = await prisma.$transaction");
    const gateAt = genCode.indexOf("applyCampaignApprovalGate(tx");
    const projectLockAt = genCode.indexOf("const projectLockKey");
    const createAt = genCode.indexOf("await tx.genJob.create");
    expect(txStart).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(txStart);
    expect(gateAt).toBeLessThan(projectLockAt);
    expect(gateAt).toBeLessThan(createAt);
    // The gate is never wrapped around startGen from outside — that was the r2 defect.
    expect(confirmCode).not.toMatch(/applyCampaignApprovalGate/);
  });

  it("keeps the approval gate a gate — it re-reads and serializes, it never spends", () => {
    // The gate module opens no transaction of its own any more: it runs inside the caller's.
    // Everything that could move money stays banned, so the serialization point cannot quietly
    // become a second spend path.
    const bannedInLock = /reserveCredits|settleCredits|refundReservation|grantCredits|CreditLedger|creditLedger|genJob\s*\.\s*create|generation\s*\.\s*create|boss\s*\.\s*send|GEN_QUEUE|provider\s*\.|\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\.\s*\$transaction/;
    expect(bannedInLock.test(lockCode)).toBe(false);
    expect(lockCode).toMatch(/pg_advisory_xact_lock/);
    expect(lockCode).toMatch(/stillApproved\(campaign\.planJson\)/);
  });

  it("keeps the balance addition read-only and owner-scoped", () => {
    const creditAccountWrite =
      /(?:CreditAccount|creditAccount)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
    expect(confirmCode).toMatch(
      /prisma\s*\.\s*creditAccount\s*\.\s*findUnique\s*\(\s*\{\s*where:\s*\{\s*orgId:\s*gate\.ownerId\s*\},\s*select:\s*\{\s*balance:\s*true\s*\}/,
    );
    expect(confirmCode).not.toMatch(creditAccountWrite);
    expect(batchCode).not.toMatch(creditAccountWrite);
  });

  it("#709 修复轮 P1-2 钉板:内容指纹整份哈希卡面承诺的规格,不许挑字段", () => {
    // 这一条是结构性的,不是文字洁癖:漏掉 audio / 默认画幅那一版之所以能过测试,正是因为
    // 「卡上说什么」与「指纹哈什么」是两份各自维护的字段清单。整份哈希之后两者不可能分家,
    // 而这个钉板保证没有人再把它拆回去。
    const payload = confirmCode.slice(
      confirmCode.indexOf("const fingerprintPayload"),
      confirmCode.indexOf("const contentFingerprint"),
    );
    expect(payload).toContain("canonicalSpec(line.promisedSpec)");
    expect(payload).not.toMatch(/cell\.(aspectRatio|resolution|durationSeconds|fps|audio)/);
    expect(confirmCode).toMatch(/function canonicalSpec[\s\S]*?Object\.entries\(spec\)/);
    // 卡面那两格也必须从同一份规格派生,否则「承诺面」又会长出第二个来源。
    expect(confirmCode).toContain("specChips: campaignSpecChips(cell, promisedSpec)");
    expect(confirmCode).toContain('aspectRatio: kind === "image" ? promisedSpec.aspectRatio : null');
  });

  it("never claims zero charge from an unconfirmed client transport failure", () => {
    // 卡面上不止一个 catch/finally(#709 的重报价也有一个),所以判据是**每一个** catch
    // 都不许宣称没扣钱,并且确认那条路上确实有那句「结果不明」。只看第一个 catch 会在
    // 有人新增一个更早的 catch 时判到错的块上。
    const catchBlocks = [...clientCode.matchAll(/catch\s*\{([\s\S]*?)\}\s*finally/g)].map((match) => match[1]);
    expect(catchBlocks.length).toBeGreaterThan(0);
    expect(catchBlocks.some((block) => /couldn't confirm the result/i.test(block))).toBe(true);
    for (const block of catchBlocks) expect(block).not.toMatch(/nothing was charged/i);
    expect(clientCode).toMatch(/zeroDispatchConfirmed/);
  });
});
