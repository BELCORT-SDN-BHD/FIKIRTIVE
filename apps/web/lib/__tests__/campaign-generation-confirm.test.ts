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
  const prisma = {
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
const { INTERNAL_PER_DISPLAY } = await import("@fikirtive/core");

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const PROJECT_ID = "prj_c2b";
const IMG = 1;
const VID = 11; // seedance-2-fast 720p/5s(#644 Founder 裁决 2026-08-06:8 → 11 显示 credits)
const VALID_UNKNOWN_FINGERPRINT = "0".repeat(64);

let failPrompts = new Set<string>();

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

async function currentQuote() {
  const quoted = await quoteCampaignGeneration(CAMPAIGN_ID);
  if (!("ok" in quoted)) throw new Error(quoted.error);
  return quoted.quote;
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
  vi.clearAllMocks();
  h.requireOwner.mockResolvedValue({ email: "o@example.test", ownerId: OWNER });
  h.isImpersonating.mockResolvedValue(false);
  h.store.creditAccounts.set(OWNER, 100 * INTERNAL_PER_DISPLAY);

  // Faithful model of startGen's owner+project-scoped, lock-time factory verdict.
  h.startGen.mockImplementation(async (req: Record<string, unknown>) => {
    if (failPrompts.has(req.prompt as string)) return { error: "You've used up your beta credits." };
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
    const exact = priors.find((prior) => prior.idempotencyKey === key);
    if (exact) return { id: exact.id as string, disposition: "reused" as const };
    const nonFailed = priors.find((prior) => prior.status !== "FAILED");
    if (nonFailed) return { id: nonFailed.id as string, disposition: "reused" as const };
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

describe("confirmCampaignGeneration — price consent", () => {
  it("refuses a stale reviewed total before dispatch", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const quote = await currentQuote();
    const stale = await confirmCampaignGeneration(rawRequest(5, quote.contentFingerprint));
    expect("error" in stale && stale.error).toMatch(/changed since you reviewed it/i);
    expect(h.startGen).not.toHaveBeenCalled();
    const ok = await confirmCampaignGeneration(rawRequest(quote.totalDisplayCredits, quote.contentFingerprint));
    if (!("ok" in ok)) throw new Error(ok.error);
    expect(ok.result.dispatched).toBe(2);
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
  const clientCode = readFileSync(
    path.resolve(__dirname, "../../components/campaign/campaign-confirm-page.tsx"),
    "utf8",
  );

  it("opens no ledger/job-create/queue/provider path outside startGen", () => {
    const banned = /reserveCredits|settleCredits|refundReservation|grantCredits|CreditLedger|creditLedger|genJob\s*\.\s*create|generation\s*\.\s*create|boss\s*\.\s*send|GEN_QUEUE|\.\s*\$transaction|provider\s*\./;
    expect(banned.test(confirmCode)).toBe(false);
    expect(banned.test(batchCode)).toBe(false);
    expect(/from\s+["']\.\/gen-actions["']/.test(confirmCode)).toBe(true);
    expect(/orchestrateBatch\s*\(\s*\{\s*startGen\s*,\s*prisma\s*\}/.test(confirmCode)).toBe(true);
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

  it("never claims zero charge from an unconfirmed client transport failure", () => {
    const catchBlock = clientCode.match(/catch\s*\{([\s\S]*?)\}\s*finally/)?.[1] ?? "";
    expect(catchBlock).toMatch(/couldn't confirm the result/i);
    expect(catchBlock).not.toMatch(/nothing was charged/i);
    expect(clientCode).toMatch(/zeroDispatchConfirmed/);
  });
});
