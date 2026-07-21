/**
 * campaign-generation-confirm — C2b (issue #395) money-safety proofs.
 *
 * Zero real spend: startGen and prisma are fakes (the existing test-infra pattern — a spy
 * that models startGen's factory once-ever verdict against an in-memory job store). Proves the
 * confirm action builds cells from the PERSISTED plan (anti-flip), prices from the live config,
 * dedups a replay / re-confirm to exactly-once (zero double charge), is owner-only + cross-tenant
 * fail-closed, reports partial failure honestly with $0 for failed cells, and — statically —
 * opens NO second spend path (no credit-ledger write, no GenJob create, no queue send).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const OWNER = "org_c2b_owner";
const OTHER_OWNER = "org_c2b_other";

// Shared in-memory store + mock fns. Built in vi.hoisted so the vi.mock factories can see them.
const h = vi.hoisted(() => {
  const store = {
    campaigns: new Map<string, { id: string; ownerId: string; name: string; planJson: unknown; deletedAt: Date | null }>(),
    projects: new Map<string, { id: string; ownerId: string; campaignId: string | null; deletedAt: Date | null }>(),
    batches: new Map<string, { id: string; ownerId: string }>(),
    jobs: new Map<string, Record<string, unknown>>(),
  };

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
    generationBatch: {
      findFirst: async ({ where }: { where: { id: string; ownerId: string } }) => {
        const b = store.batches.get(where.id);
        return b && b.ownerId === where.ownerId ? { id: b.id } : null;
      },
      create: async ({ data }: { data: { id: string; ownerId: string } }) => {
        if (store.batches.has(data.id)) throw Object.assign(new Error("dup"), { code: "P2002" });
        store.batches.set(data.id, { id: data.id, ownerId: data.ownerId });
        return { id: data.id };
      },
    },
    genJob: {
      findMany: async ({ where }: { where: { ownerId: string; projectId?: string; idempotencyKey?: { startsWith: string } } }) => {
        return [...store.jobs.values()]
          .filter((j) =>
            j.ownerId === where.ownerId &&
            (where.projectId == null || j.projectId === where.projectId) &&
            (where.idempotencyKey == null || String(j.idempotencyKey ?? "").startsWith(where.idempotencyKey.startsWith)))
          .map((j) => ({ ...j }));
      },
      updateMany: async ({ where, data }: { where: { id: string; ownerId: string }; data: { batchId: string } }) => {
        const j = store.jobs.get(where.id);
        if (j && j.ownerId === where.ownerId) j.batchId = data.batchId;
        return { count: j ? 1 : 0 };
      },
    },
  };

  return {
    store,
    prisma,
    startGen: vi.fn(),
    requireOwner: vi.fn(),
    isImpersonating: vi.fn(async () => false),
  };
});

vi.mock("../auth-guard", () => ({ requireOwner: h.requireOwner }));
vi.mock("../better-auth/compat", () => ({ isImpersonating: h.isImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startGen: h.startGen }));
vi.mock("@fikirtive/db", () => ({ prisma: h.prisma }));

const { confirmCampaignGeneration, quoteCampaignGeneration } = await import("../campaign-generation-confirm");
const { normalizeFactoryMaterial, factoryMaterialMatches, parseFactoryAttemptKey } = await import("../batch-idempotency");
const { INTERNAL_PER_DISPLAY } = await import("@fikirtive/core");

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // 26-char ULID alphabet
const PROJECT_ID = "prj_c2b";
const IMG = 1; // seedream image = 1 displayed credit
const VID = 8; // seedance-2-fast 720p/5s = 8 displayed credits (flat-priced video)

/** Prompts the fake startGen should refuse (partial-failure simulation). */
let failPrompts = new Set<string>();

function entry(id: string, over: Partial<{ format: string; brief: string; hook: string; status: string; platform: string }> = {}) {
  return {
    id,
    date: "2026-07-25",
    platform: over.platform ?? "instagram",
    format: over.format ?? "image",
    hook: over.hook ?? `hook ${id}`,
    brief: over.brief ?? `brief for ${id} with letters`,
    estCredits: 999, // display-only junk — must never influence the real charge
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

beforeEach(() => {
  h.store.campaigns.clear();
  h.store.projects.clear();
  h.store.batches.clear();
  h.store.jobs.clear();
  failPrompts = new Set();
  vi.clearAllMocks();
  h.requireOwner.mockResolvedValue({ email: "o@example.test", ownerId: OWNER });
  h.isImpersonating.mockResolvedValue(false);

  // Faithful model of startGen's factory verdict (per logical cell, across attempts):
  // material mismatch → conflict; exact/any-non-FAILED prior → reused; else create+reserve.
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
    });
    const priors = [...h.store.jobs.values()].filter(
      (j) => j.projectId === req.projectId && String(j.idempotencyKey ?? "").startsWith(parsed.logicalPrefix),
    );
    if (priors.some((p) => !factoryMaterialMatches(p as never, material))) {
      return { error: "That batchId is already in use for different content.", disposition: "conflict" as const };
    }
    const exact = priors.find((p) => p.idempotencyKey === key);
    if (exact) return { id: exact.id as string, disposition: "reused" as const };
    const nonFailed = priors.find((p) => p.status !== "FAILED");
    if (nonFailed) return { id: nonFailed.id as string, disposition: "reused" as const };
    const id = `job-${h.store.jobs.size}`;
    h.store.jobs.set(id, { id, ownerId: OWNER, projectId: req.projectId, batchId: null, status: "QUEUED", idempotencyKey: key, ...material });
    return { id, disposition: "fresh" as const };
  });
});

describe("quoteCampaignGeneration — server-recomputed price from the live config (§7.2.1)", () => {
  it("prices only APPROVED entries, image vs video from the config table (never estCredits)", async () => {
    seedCampaign([
      entry("E1"),
      entry("E2"),
      entry("E3", { format: "video" }),
      entry("E4", { status: "proposed" }), // excluded
    ]);
    const res = await quoteCampaignGeneration(CAMPAIGN_ID);
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.quote.count).toBe(3);
    expect(res.quote.lines.map((l) => l.kind)).toEqual(["image", "image", "video"]);
    expect(res.quote.lines.map((l) => l.displayCredits)).toEqual([IMG, IMG, VID]);
    // total is DERIVED (sum of the per-cell config price), not a literal and not estCredits (999).
    expect(res.quote.totalDisplayCredits).toBe(IMG + IMG + VID);
  });

  it("changing an entry's format flips its price via the config table (改配置→总价变)", async () => {
    seedCampaign([entry("E1", { format: "image" })]);
    const asImage = await quoteCampaignGeneration(CAMPAIGN_ID);
    seedCampaign([entry("E1", { format: "video" })]);
    const asVideo = await quoteCampaignGeneration(CAMPAIGN_ID);
    if (!("ok" in asImage) || !("ok" in asVideo)) throw new Error("quote failed");
    expect(asImage.quote.totalDisplayCredits).toBe(IMG);
    expect(asVideo.quote.totalDisplayCredits).toBe(VID);
    expect(asVideo.quote.totalDisplayCredits).not.toBe(asImage.quote.totalDisplayCredits);
  });

  it("returns an empty quote (not an error) when nothing is approved yet", async () => {
    seedCampaign([entry("E1", { status: "proposed" })]);
    const res = await quoteCampaignGeneration(CAMPAIGN_ID);
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.quote.count).toBe(0);
    expect(res.quote.totalDisplayCredits).toBe(0);
  });

  it("cross-tenant campaign is not found", async () => {
    seedCampaign([entry("E1")], OTHER_OWNER);
    expect(await quoteCampaignGeneration(CAMPAIGN_ID)).toEqual({ error: "Campaign not found." });
  });

  it("denies with no session", async () => {
    h.requireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await quoteCampaignGeneration(CAMPAIGN_ID)).toEqual({ error: "Not authorized." });
  });
});

describe("confirmCampaignGeneration — builds cells from the PERSISTED plan (anti-flip)", () => {
  it("dispatches ONLY approved entries, with the persisted brief as the prompt (never client input)", async () => {
    seedCampaign([
      entry("E1", { brief: "sunset product shot" }),
      entry("E2", { status: "proposed", brief: "should never generate" }),
      entry("E3", { brief: "flat lay on marble" }),
    ]);
    seedProject();
    const res = await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID });
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.cells).toHaveLength(2);
    expect(res.result.dispatched).toBe(2);
    const prompts = h.startGen.mock.calls.map((c) => (c[0] as Record<string, unknown>).prompt);
    expect(prompts).toEqual(["sunset product shot", "flat lay on marble"]);
    // every cell carries a REQUIRED 79-char factory idempotency key (goes through the dedup gate).
    for (const call of h.startGen.mock.calls) {
      const key = (call[0] as Record<string, unknown>).idempotencyKey as string;
      expect(key).toHaveLength(79);
      expect(parseFactoryAttemptKey(key)).not.toBeNull();
    }
    expect(res.quote.totalDisplayCredits).toBe(IMG + IMG);
  });

  it("empty when nothing is approved; blocked while impersonating", async () => {
    seedCampaign([entry("E1", { status: "proposed" })]);
    seedProject();
    expect(await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }))
      .toEqual({ error: "Approve at least one plan entry before generating." });
    expect(h.startGen).not.toHaveBeenCalled();

    seedCampaign([entry("E1")]);
    h.isImpersonating.mockResolvedValue(true);
    const blocked = await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID });
    expect("error" in blocked && blocked.error).toMatch(/impersonating/i);
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

describe("confirmCampaignGeneration — exactly-once / zero double charge", () => {
  it("a replay / re-confirm reuses the same logical cells — zero new charge", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const first = await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID });
    if (!("ok" in first)) throw new Error(first.error);
    expect(first.result.dispatched).toBe(2);
    expect(h.store.jobs.size).toBe(2);
    const firstKeys = h.startGen.mock.calls.map((c) => (c[0] as Record<string, unknown>).idempotencyKey as string);

    const second = await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID });
    if (!("ok" in second)) throw new Error(second.error);
    expect(second.result.dispatched).toBe(0);
    expect(second.result.reused).toBe(2);
    expect(second.result.totalCredits).toBe(0); // nothing new reserved
    expect(h.store.jobs.size).toBe(2); // NO second job minted — exactly once

    // The dedup anchor: both confirmations derive the SAME per-cell logical prefix (stable
    // batchId from campaign+project) even though the fresh attempt hash differs.
    const secondKeys = h.startGen.mock.calls.slice(2).map((c) => (c[0] as Record<string, unknown>).idempotencyKey as string);
    expect(secondKeys.map((k) => parseFactoryAttemptKey(k)!.logicalPrefix))
      .toEqual(firstKeys.map((k) => parseFactoryAttemptKey(k)!.logicalPrefix));
  });

  it("concurrent double-confirm resolves to exactly one job set", async () => {
    seedCampaign([entry("E1"), entry("E2")]);
    seedProject();
    const [a, b] = await Promise.all([
      confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }),
      confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }),
    ]);
    if (!("ok" in a) || !("ok" in b)) throw new Error("confirm failed");
    // Across both runs, each of the two logical cells minted exactly one job (no duplicate).
    expect(h.store.jobs.size).toBe(2);
    expect(a.result.dispatched + b.result.dispatched).toBe(2);
  });
});

describe("confirmCampaignGeneration — honest partial failure, $0 for failed cells", () => {
  it("reports the failed cell as error/0 and dispatches the rest; no job minted for the failure", async () => {
    seedCampaign([
      entry("E1", { brief: "ok one" }),
      entry("E2", { brief: "fails here" }),
      entry("E3", { brief: "ok three" }),
    ]);
    seedProject();
    failPrompts = new Set(["fails here"]);
    const res = await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID });
    if (!("ok" in res)) throw new Error(res.error);
    expect(res.result.dispatched).toBe(2);
    expect(res.result.failed).toBe(1);
    expect(res.result.cells[1]).toMatchObject({ status: "error", credits: 0 });
    expect(res.result.totalCredits).toBe(2 * INTERNAL_PER_DISPLAY); // only the 2 that dispatched
    expect(h.store.jobs.size).toBe(2); // the failed cell reserved nothing
  });
});

describe("confirmCampaignGeneration — RBAC owner-only + fail-closed", () => {
  it("denies a non-owner and dispatches nothing", async () => {
    h.requireOwner.mockResolvedValue({ error: "Not authorized." });
    seedCampaign([entry("E1")]);
    seedProject();
    expect(await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }))
      .toEqual({ error: "Not authorized." });
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("a cross-tenant campaign is not found (owner-scoped query)", async () => {
    seedCampaign([entry("E1")], OTHER_OWNER);
    seedProject(CAMPAIGN_ID, OTHER_OWNER);
    expect(await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }))
      .toEqual({ error: "Campaign not found." });
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("a project not grouped under this campaign is refused before any dispatch", async () => {
    seedCampaign([entry("E1")]);
    seedProject(null); // owned, but campaignId null
    expect(await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }))
      .toEqual({ error: "Choose a project that belongs to this campaign." });
    expect(h.startGen).not.toHaveBeenCalled();
  });

  it("a project owned by another tenant is not found", async () => {
    seedCampaign([entry("E1")]);
    h.store.projects.set(PROJECT_ID, { id: PROJECT_ID, ownerId: OTHER_OWNER, campaignId: CAMPAIGN_ID, deletedAt: null });
    expect(await confirmCampaignGeneration({ campaignId: CAMPAIGN_ID, projectId: PROJECT_ID }))
      .toEqual({ error: "Project not found." });
    expect(h.startGen).not.toHaveBeenCalled();
  });
});

describe("money-safety: this file opens NO second spend path (mutation guard)", () => {
  // Strip comments first — the file DOCUMENTS (in prose) that it moves no money; the invariant
  // is about executable CODE only (no-second-send-path style).
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const code = stripComments(readFileSync(path.resolve(__dirname, "../campaign-generation-confirm.ts"), "utf8"));

  it("has zero credit-ledger / GenJob-create / queue-send symbols", () => {
    const banned = /reserveCredits|settleCredits|refundReservation|grantCredits|CreditLedger|creditLedger|CreditAccount|creditAccount|genJob\s*\.\s*create|generation\s*\.\s*create|boss\s*\.\s*send|GEN_QUEUE|\.\s*\$transaction/;
    expect(banned.test(code), "confirm file must not open a spend/ledger path directly").toBe(false);
  });

  it("dispatches ONLY through the existing startGen authority (via orchestrateBatch)", () => {
    expect(/from\s+["']\.\/gen-actions["']/.test(code)).toBe(true);
    expect(/orchestrateBatch\s*\(\s*\{\s*startGen\s*,\s*prisma\s*\}/.test(code)).toBe(true);
  });
});
