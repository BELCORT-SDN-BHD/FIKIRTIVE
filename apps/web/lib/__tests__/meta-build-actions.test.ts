import { describe, it, expect, vi, beforeEach } from "vitest";

// runAdBuild is the SOLE Meta-CREATE writer (it is the only code that creates
// campaign/adset/creative/ad objects in the user's real account). Everything it
// creates is status:"PAUSED" ($0). These tests pin its security invariants:
//   - kill-switch refuses (no graph/upload calls)
//   - !canWrite refuses
//   - create-mode builds all 5 objects PAUSED IN ORDER, threading parent ids
//   - into_existing skips campaign+adset
//   - per-step idempotency (an APPLIED row is never re-created)
//   - stop-on-first-failure (partial — no later object attempted)
//   - approveAdBuild: impersonation block, kill-switch-before-consume, gate-before-consume
//   - maybeAutoBuild: AUTO runs / ASK|kill-switch skip / throw → buildOutcome.built=false

const {
  mockConnFindUnique,
  mockMsgFindFirst,
  mockMsgUpdate,
  mockExecFindFirst,
  mockExecCreate,
  mockExecUpdate,
  mockGenFindFirst,
  mockAssetFindUnique,
  mockGraphPost,
  mockUploadImage,
  mockUploadVideo,
  mockStorageGet,
  mockStorageKey,
  mockRequireOwner,
  mockIsImpersonating,
} = vi.hoisted(() => ({
  mockConnFindUnique: vi.fn(),
  mockMsgFindFirst: vi.fn(),
  mockMsgUpdate: vi.fn(),
  mockExecFindFirst: vi.fn(),
  mockExecCreate: vi.fn(),
  mockExecUpdate: vi.fn(),
  mockGenFindFirst: vi.fn(),
  mockAssetFindUnique: vi.fn(),
  mockGraphPost: vi.fn(),
  mockUploadImage: vi.fn(),
  mockUploadVideo: vi.fn(),
  mockStorageGet: vi.fn(),
  mockStorageKey: vi.fn(),
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    metaConnection: { findUnique: mockConnFindUnique },
    chatMessage: { findFirst: mockMsgFindFirst, update: mockMsgUpdate },
    metaActionExecution: { findFirst: mockExecFindFirst, create: mockExecCreate, update: mockExecUpdate },
    generation: { findFirst: mockGenFindFirst },
    asset: { findUnique: mockAssetFindUnique },
  },
  Prisma: {},
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "id-fixed", storageKey: mockStorageKey }));
vi.mock("../meta-graph", () => ({
  metaGraphPost: mockGraphPost,
  uploadAdImage: mockUploadImage,
  uploadAdVideo: mockUploadVideo,
}));
vi.mock("../storage", () => ({
  storage: { get: mockStorageGet },
  mimeOf: (ext: string) => (ext === "mp4" ? "video/mp4" : "image/png"),
}));
vi.mock("../auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
// token-encryption is REAL: decryptToken round-trips a token we encrypt under a fixed key.

import { runAdBuild, approveAdBuild, maybeAutoBuild } from "../meta-build-actions";
import { encryptToken } from "../token-encryption";
import { buildApproval } from "../meta-approval";
import type { MetaAdBuildCardPayload } from "../meta-build-spec";

/** The card payload minus the server-attached approval (the test builds approval separately). */
type BuildPayload = Omit<MetaAdBuildCardPayload, "approval">;

// ── builders ────────────────────────────────────────────────────────────────

function conn(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: "u1",
    accessTokenEnc: encryptToken("LIVE-TOKEN"),
    status: "active",
    adsAutonomy: "AUTO",
    adsWritesPaused: false,
    canWrite: true,
    ...overrides,
  };
}

const NOW = "2026-06-28T00:00:00.000Z";

/** The single build PlanStep approveAdBuild verifies (must mirror buildAdBuildCard). */
function buildStep(p: ReturnType<typeof basePayload>) {
  return {
    index: 0,
    op: "build" as const,
    targetId: p.creative.assetId,
    targetValue: {
      objective: p.objective,
      dailyBudgetMinor: p.dailyBudgetMinor,
      pageId: p.pageId,
      mode: p.mode,
      adsetId: p.intoExisting?.adsetId ?? null,
      startTime: p.startTime ?? null,
      // F17: mirror bindingSteps() — bind creative + schedule + targeting.
      creative: {
        kind: p.creative.kind,
        message: p.creative.message,
        headline: p.creative.headline ?? null,
        cta: p.creative.cta,
        link: p.creative.link,
      },
      targeting: p.targeting,
    },
  };
}

function basePayload(overrides: Partial<BuildPayload> = {}): BuildPayload {
  return {
    goal: "Get traffic",
    reasoning: "r",
    mode: "create",
    objective: "OUTCOME_TRAFFIC",
    accountId: "act_111",
    pageId: "page_42",
    targeting: { geo_locations: { countries: ["MY"] } },
    dailyBudgetMinor: 5000,
    creative: {
      assetId: "gen-1",
      kind: "image",
      message: "Buy now",
      cta: "SHOP_NOW",
      link: "https://example.com",
    },
    ...overrides,
  };
}

/** A BUILD_CARD ChatMessage carrying a MetaAdBuildCardPayload, with a valid approval. */
function card(payloadOverrides: Partial<BuildPayload> = {}) {
  const p = basePayload(payloadOverrides);
  const approval = buildApproval([buildStep(p)], "u1", NOW, 10 * 60 * 1000);
  return { id: "card-1", ownerId: "u1", kind: "BUILD_CARD", payload: { ...p, approval } };
}

/** Per-(stepIndex) execution rows: findFirst returns null (no prior), create echoes. */
function freshExecRows() {
  mockExecFindFirst.mockResolvedValue(null);
  mockExecCreate.mockImplementation(async (args: { data: { stepIndex: number } }) => ({
    id: `exec-${args.data.stepIndex}`,
    stepIndex: args.data.stepIndex,
    status: "PENDING",
  }));
  mockExecUpdate.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);

  freshExecRows();
  mockMsgUpdate.mockResolvedValue({});

  // asset resolution: gen-1 → asset a-1 (image png)
  mockGenFindFirst.mockResolvedValue({ assetId: "a-1" });
  mockAssetFindUnique.mockResolvedValue({
    id: "a-1",
    ownerId: "u1",
    contentHash: "deadbeef",
    ext: "png",
    mime: "image/png",
  });
  mockStorageKey.mockReturnValue("u/u1/deadbeef.png");
  mockStorageGet.mockResolvedValue(new Uint8Array([1, 2, 3]));

  // graph create returns distinct ids per endpoint
  mockUploadImage.mockResolvedValue("IMG_HASH_1");
  mockUploadVideo.mockResolvedValue("VIDEO_ID_1");
  mockGraphPost.mockImplementation(async (_t: string, path: string) => {
    if (path.endsWith("/adcreatives")) return { id: "creative_1" };
    if (path.endsWith("/campaigns")) return { id: "campaign_1" };
    if (path.endsWith("/adsets")) return { id: "adset_1" };
    if (path.endsWith("/ads")) return { id: "ad_1" };
    return { id: "unknown" };
  });

  mockRequireOwner.mockResolvedValue({ email: "u1@x.com", ownerId: "u1" });
  mockIsImpersonating.mockResolvedValue(false);
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — kill-switch / canWrite
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — kill-switch & canWrite", () => {
  it("throws KILL_SWITCH when adsWritesPaused, with NO graph or upload calls", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsWritesPaused: true }));
    mockMsgFindFirst.mockResolvedValue(card());

    await expect(runAdBuild("u1", "card-1")).rejects.toThrow(/KILL_SWITCH/);

    expect(mockGraphPost).not.toHaveBeenCalled();
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockUploadVideo).not.toHaveBeenCalled();
    expect(mockExecCreate).not.toHaveBeenCalled();
  });

  it("refuses (state failed) when canWrite is false — no creates", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ canWrite: false }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(res.createdIds).toEqual({});
    expect(mockGraphPost).not.toHaveBeenCalled();
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it("refuses when there is no connection row", async () => {
    mockConnFindUnique.mockResolvedValue(null);
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — create-mode happy path (5 objects, PAUSED, in order, ids threaded)
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — create mode (image)", () => {
  beforeEach(() => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());
  });

  it("builds upload→creative→campaign→adset→ad IN ORDER, all PAUSED, ids threaded", async () => {
    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("done");
    expect(res.createdIds).toMatchObject({
      imageHash: "IMG_HASH_1",
      creativeId: "creative_1",
      campaignId: "campaign_1",
      adsetId: "adset_1",
      adId: "ad_1",
    });

    // upload happened first (owner asset bytes), image not video
    expect(mockUploadImage).toHaveBeenCalledOnce();
    expect(mockUploadVideo).not.toHaveBeenCalled();
    const [, uploadAccountId, file] = mockUploadImage.mock.calls[0] as [string, string, { bytes: Uint8Array }];
    expect(uploadAccountId).toBe("act_111");
    expect(file.bytes).toBeInstanceOf(Uint8Array);

    // graph POST order: adcreatives → campaigns → adsets → ads
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).toEqual([
      "act_111/adcreatives",
      "act_111/campaigns",
      "act_111/adsets",
      "act_111/ads",
    ]);

    // bodies
    const byPath = (suffix: string) =>
      (mockGraphPost.mock.calls.find((c) => (c[1] as string).endsWith(suffix))![2] ?? {}) as Record<string, unknown>;

    const creative = byPath("/adcreatives");
    expect(typeof creative.object_story_spec).toBe("string"); // JSON-stringified per Meta
    const oss = JSON.parse(creative.object_story_spec as string);
    expect(oss.page_id).toBe("page_42");
    expect(oss.link_data.image_hash).toBe("IMG_HASH_1");
    expect(oss.link_data.call_to_action.type).toBe("SHOP_NOW");

    const campaign = byPath("/campaigns");
    expect(campaign.status).toBe("PAUSED");
    expect(campaign.special_ad_categories).toBe("[]");
    expect(campaign.objective).toBe("OUTCOME_TRAFFIC");

    const adset = byPath("/adsets");
    expect(adset.status).toBe("PAUSED");
    expect(adset.campaign_id).toBe("campaign_1"); // threaded from campaign create
    expect(adset.daily_budget).toBe(5000);
    expect(adset.billing_event).toBe("IMPRESSIONS");
    expect(typeof adset.targeting).toBe("string"); // JSON-stringified
    expect(adset.optimization_goal).toBeTruthy();

    const ad = byPath("/ads");
    expect(ad.status).toBe("PAUSED");
    expect(ad.adset_id).toBe("adset_1"); // threaded from adset create
    const creativeField = JSON.parse(ad.creative as string);
    expect(creativeField.creative_id).toBe("creative_1"); // threaded from creative create
  });

  it("reads the owner's asset bytes owner-scoped (Generation + Asset), not cross-tenant", async () => {
    await runAdBuild("u1", "card-1");
    const genWhere = (mockGenFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(genWhere).toMatchObject({ id: "gen-1", ownerId: "u1" });
    expect(mockStorageKey).toHaveBeenCalledWith("u1", "deadbeef", "png");
  });

  it("fails (no creative) when the asset bytes are missing", async () => {
    mockGenFindFirst.mockResolvedValue(null); // owner has no such generation

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — video creative
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — create mode (video)", () => {
  it("uploads video and builds a video_data creative", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockGenFindFirst.mockResolvedValue({ assetId: "a-2" });
    mockAssetFindUnique.mockResolvedValue({
      id: "a-2",
      ownerId: "u1",
      contentHash: "cafef00d",
      ext: "mp4",
      mime: "video/mp4",
    });
    mockStorageKey.mockReturnValue("u/u1/cafef00d.mp4");
    mockMsgFindFirst.mockResolvedValue(
      card({ creative: { assetId: "gen-2", kind: "video", message: "Watch", cta: "LEARN_MORE", link: "https://e.com" } }),
    );

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("done");
    expect(mockUploadVideo).toHaveBeenCalledOnce();
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(res.createdIds.videoId).toBe("VIDEO_ID_1");

    const creativeCall = mockGraphPost.mock.calls.find((c) => (c[1] as string).endsWith("/adcreatives"))!;
    const oss = JSON.parse((creativeCall[2] as Record<string, string>).object_story_spec);
    expect(oss.video_data.video_id).toBe("VIDEO_ID_1");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — into_existing skips campaign + adset
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — into_existing mode", () => {
  it("skips campaign + adset creates and uses payload.intoExisting.adsetId", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card({ mode: "into_existing", intoExisting: { adsetId: "adset_existing" } }));

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("done");
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).toEqual(["act_111/adcreatives", "act_111/ads"]); // no campaigns/adsets
    expect(paths).not.toContain("act_111/campaigns");
    expect(paths).not.toContain("act_111/adsets");

    const ad = (mockGraphPost.mock.calls.find((c) => (c[1] as string).endsWith("/ads"))![2]) as Record<string, unknown>;
    expect(ad.adset_id).toBe("adset_existing");
    expect(res.createdIds.adsetId).toBe("adset_existing");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — idempotency (an APPLIED step is read, not re-created)
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — idempotency", () => {
  it("an already-APPLIED campaign step reads its id; no second campaign create", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());

    // stepIndex 2 = campaign — pretend it already APPLIED with id campaign_PRIOR.
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        return { id: "exec-2", stepIndex: 2, status: "APPLIED", appliedValue: { id: "campaign_PRIOR" } };
      }
      return null;
    });

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("done");
    // NO campaign POST happened (the applied id was reused)
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).not.toContain("act_111/campaigns");

    // the adset was threaded from the PRIOR campaign id
    const adset = (mockGraphPost.mock.calls.find((c) => (c[1] as string).endsWith("/adsets"))![2]) as Record<string, unknown>;
    expect(adset.campaign_id).toBe("campaign_PRIOR");
    expect(res.createdIds.campaignId).toBe("campaign_PRIOR");
  });

  it("re-claims by findFirst on a P2002 create race and reads the applied id", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());

    // No prior row on the FIRST findFirst for stepIndex 2; create throws P2002;
    // the re-findFirst then returns an APPLIED row.
    let campaignLookups = 0;
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        campaignLookups += 1;
        if (campaignLookups === 1) return null;
        return { id: "exec-2", stepIndex: 2, status: "APPLIED", appliedValue: { id: "campaign_RACED" } };
      }
      return null;
    });
    mockExecCreate.mockImplementation(async (args: { data: { stepIndex: number } }) => {
      if (args.data.stepIndex === 2) {
        const e = new Error("dup") as Error & { code?: string };
        e.code = "P2002";
        throw e;
      }
      return { id: `exec-${args.data.stepIndex}`, stepIndex: args.data.stepIndex, status: "PENDING" };
    });

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("done");
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).not.toContain("act_111/campaigns"); // P2002 → read applied id, no re-create
    expect(res.createdIds.campaignId).toBe("campaign_RACED");
  });

  it("does NOT re-create when a P2002 race finds a CONCURRENT PENDING claimant → needs_review (F13)", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());

    // stepIndex 2 (campaign): no prior row on the first findFirst; create loses the unique
    // insert (P2002); the re-read finds the WINNER's row still PENDING — it is the rightful
    // executor and may already be firing the Meta create. Proceeding here would create a
    // DUPLICATE campaign (double budget). The build must refuse → needs_review.
    let campaignLookups = 0;
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        campaignLookups += 1;
        return campaignLookups === 1 ? null : { id: "exec-2", stepIndex: 2, status: "PENDING" };
      }
      return null;
    });
    mockExecCreate.mockImplementation(async (args: { data: { stepIndex: number } }) => {
      if (args.data.stepIndex === 2) {
        const e = new Error("dup") as Error & { code?: string };
        e.code = "P2002";
        throw e;
      }
      return { id: `exec-${args.data.stepIndex}`, stepIndex: args.data.stepIndex, status: "PENDING" };
    });

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("needs_review");
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).not.toContain("act_111/campaigns"); // never created the duplicate campaign
    expect(paths.some((p) => p.endsWith("/adsets") || p.endsWith("/ads"))).toBe(false); // stopped the batch
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — crash-rebuild reconcile (distinguish PENDING vs APPLYING leftovers)
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — crash-rebuild reconcile", () => {
  beforeEach(() => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());
  });

  it("a leftover PENDING campaign row → SAFE to proceed: re-claims and creates the campaign", async () => {
    // stepIndex 2 = campaign — a PENDING leftover means the claim row was created but the
    // Meta create was NEVER attempted (PENDING never reached APPLYING) → safe to create now.
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        return { id: "exec-2", stepIndex: 2, status: "PENDING", appliedValue: null };
      }
      return null;
    });

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("done");
    // the campaign WAS created (PENDING is safe to re-claim)
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).toContain("act_111/campaigns");
    expect(res.createdIds.campaignId).toBe("campaign_1");
  });

  it("a leftover APPLYING campaign row → AMBIGUOUS: does NOT re-create, marks FAILED, stops with needs_review", async () => {
    // stepIndex 2 = campaign — an APPLYING leftover means the create MAY have fired before a
    // prior crash (no id recorded). Re-creating risks a duplicate → refuse and surface needs_review.
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        return { id: "exec-2", stepIndex: 2, status: "APPLYING", appliedValue: null };
      }
      return null;
    });

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("needs_review");

    // The Meta CREATE for the campaign was NOT called again.
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).not.toContain("act_111/campaigns");
    // And the batch stopped — the ad (step 4) was never attempted.
    expect(paths).not.toContain("act_111/ads");

    // The ambiguous row was marked FAILED.
    const failedUpdate = mockExecUpdate.mock.calls.find(
      (c) => (c[0] as { where: { id: string }; data: { status?: string } }).data.status === "FAILED",
    );
    expect(failedUpdate).toBeDefined();
    expect((failedUpdate![0] as { where: { id: string } }).where.id).toBe("exec-2");
  });

  it("a leftover APPLYING UPLOAD row (step 0) → no upload re-fired, no graph calls, needs_review", async () => {
    // Belt-and-braces: the ambiguity can be the very first step (upload). Assert the upload mock
    // is NOT called again and nothing downstream fires.
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 0) {
        return { id: "exec-0", stepIndex: 0, status: "APPLYING", appliedValue: null };
      }
      return null;
    });

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("needs_review");
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockUploadVideo).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runAdBuild — partial failure (stop-on-first-failure)
// ════════════════════════════════════════════════════════════════════════════

describe("runAdBuild — partial failure", () => {
  it("adset (step 3) create throws → ad (step 4) NOT attempted, state partial, earlier ids returned", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());

    mockGraphPost.mockImplementation(async (_t: string, path: string) => {
      if (path.endsWith("/adcreatives")) return { id: "creative_1" };
      if (path.endsWith("/campaigns")) return { id: "campaign_1" };
      if (path.endsWith("/adsets")) throw new Error("Meta: adset rejected");
      if (path.endsWith("/ads")) return { id: "ad_1" };
      return { id: "x" };
    });

    const res = await runAdBuild("u1", "card-1");

    expect(res.state).toBe("partial");
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).toContain("act_111/adsets");
    expect(paths).not.toContain("act_111/ads"); // step 4 not attempted
    // earlier ids preserved
    expect(res.createdIds.creativeId).toBe("creative_1");
    expect(res.createdIds.campaignId).toBe("campaign_1");
    expect(res.createdIds.adId).toBeUndefined();
  });

  it("returns failed (nothing created) when the very first object — the upload — throws", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());
    mockUploadImage.mockRejectedValue(new Error("upload boom"));

    const res = await runAdBuild("u1", "card-1");
    expect(res.state).toBe("failed");
    expect(res.createdIds).toEqual({});
    expect(mockGraphPost).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// approveAdBuild — '"use server"' human-approve gate
// ════════════════════════════════════════════════════════════════════════════

describe("approveAdBuild", () => {
  it("blocks while impersonating — approval NOT consumed, no build", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    mockMsgFindFirst.mockResolvedValue(card());
    mockConnFindUnique.mockResolvedValue(conn());

    const res = await approveAdBuild("card-1");
    expect("error" in res).toBe(true);
    expect(mockMsgUpdate).not.toHaveBeenCalled(); // approval not consumed
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("kill-switch ON → error, approval NOT consumed (re-approve after un-pause works)", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsWritesPaused: true }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await approveAdBuild("card-1");
    expect("error" in res).toBe(true);
    expect(mockMsgUpdate).not.toHaveBeenCalled(); // approval survives — not burned
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("canWrite false → error, approval NOT consumed", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ canWrite: false }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await approveAdBuild("card-1");
    expect("error" in res).toBe(true);
    expect(mockMsgUpdate).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("invalid approval (hash mismatch) → error, no consume, no build", async () => {
    mockConnFindUnique.mockResolvedValue(conn());
    // tamper: card has a different dailyBudget than the approval was built over
    const c = card();
    (c.payload as { dailyBudgetMinor: number }).dailyBudgetMinor = 999999;
    mockMsgFindFirst.mockResolvedValue(c);

    const res = await approveAdBuild("card-1");
    expect("error" in res).toBe(true);
    expect(mockMsgUpdate).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("invalid approval when startTime drifts → error, no consume, no build", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW)); // within the 10-min TTL; failure must be hash drift.
    mockConnFindUnique.mockResolvedValue(conn());
    const c = card({ startTime: "2026-06-28T01:00:00.000Z" });
    (c.payload as { startTime: string }).startTime = "2026-06-28T02:00:00.000Z";
    mockMsgFindFirst.mockResolvedValue(c);

    const res = await approveAdBuild("card-1");
    expect("error" in res).toBe(true);
    expect(mockMsgUpdate).not.toHaveBeenCalled();
    expect(mockGraphPost).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("valid → consumes the approval THEN runs the build", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW)); // within the 10-min TTL
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await approveAdBuild("card-1");

    expect(res).toMatchObject({ ok: true, state: "done" });
    expect((res as { createdIds: Record<string, string> }).createdIds.adId).toBe("ad_1");
    // approval consumed (chatMessage.update patched consumedAt) BEFORE/with the run
    expect(mockMsgUpdate).toHaveBeenCalled();
    const updateData = (mockMsgUpdate.mock.calls[0][0] as { data: { payload: { approval: { consumedAt?: string } } } }).data;
    expect(updateData.payload.approval.consumedAt).toBeTruthy();
    vi.useRealTimers();
  });

  it("valid done → stamps buildOutcome.built=true and state=done onto the card payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    mockConnFindUnique.mockResolvedValue(conn());
    // card() is needed for both the approve gate findFirst and the record() re-read
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await approveAdBuild("card-1");

    expect(res).toMatchObject({ ok: true, state: "done" });

    // record() does chatMessage.update with buildOutcome — find that update call.
    // There may be two updates: consumeApproval (first) and record (second).
    const buildOutcomeUpdate = mockMsgUpdate.mock.calls.find((c) => {
      const payload = (c[0] as { data?: { payload?: { buildOutcome?: unknown } } })?.data?.payload;
      return payload && "buildOutcome" in payload;
    });
    expect(buildOutcomeUpdate).toBeDefined();
    const bo = (buildOutcomeUpdate![0] as { data: { payload: { buildOutcome: Record<string, unknown> } } }).data.payload.buildOutcome;
    expect(bo.built).toBe(true);
    expect(bo.state).toBe("done");
    expect((bo.createdIds as Record<string, string>).adId).toBe("ad_1");
    vi.useRealTimers();
  });

  it("needs_review outcome (APPLYING leftover) → stamps built=false, state=needs_review, with a reason", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());
    // campaign step (2) has an APPLYING leftover → runAdBuild returns needs_review.
    mockExecFindFirst.mockImplementation(async (args: { where: { stepIndex: number } }) => {
      if (args.where.stepIndex === 2) {
        return { id: "exec-2", stepIndex: 2, status: "APPLYING", appliedValue: null };
      }
      return null;
    });

    const res = await approveAdBuild("card-1");
    expect(res).toMatchObject({ ok: true, state: "needs_review" });

    // the campaign create was NOT re-fired
    const paths = mockGraphPost.mock.calls.map((c) => c[1] as string);
    expect(paths).not.toContain("act_111/campaigns");

    const buildOutcomeUpdate = mockMsgUpdate.mock.calls.find((c) => {
      const payload = (c[0] as { data?: { payload?: { buildOutcome?: unknown } } })?.data?.payload;
      return payload && "buildOutcome" in payload;
    });
    expect(buildOutcomeUpdate).toBeDefined();
    const bo = (buildOutcomeUpdate![0] as { data: { payload: { buildOutcome: Record<string, unknown> } } }).data.payload.buildOutcome;
    expect(bo.built).toBe(false);
    expect(bo.state).toBe("needs_review");
    expect(typeof bo.reason).toBe("string");
    expect(bo.reason as string).toMatch(/interrupted/i);
    vi.useRealTimers();
  });

  it("partial outcome → stamps buildOutcome.built=false and state=partial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    mockConnFindUnique.mockResolvedValue(conn());
    mockMsgFindFirst.mockResolvedValue(card());
    // Make adset throw so build ends up partial
    mockGraphPost.mockImplementation(async (_t: string, path: string) => {
      if (path.endsWith("/adcreatives")) return { id: "creative_1" };
      if (path.endsWith("/campaigns")) return { id: "campaign_1" };
      if (path.endsWith("/adsets")) throw new Error("Meta: adset rejected");
      if (path.endsWith("/ads")) return { id: "ad_1" };
      return { id: "x" };
    });

    const res = await approveAdBuild("card-1");

    expect(res).toMatchObject({ ok: true, state: "partial" });

    const buildOutcomeUpdate = mockMsgUpdate.mock.calls.find((c) => {
      const payload = (c[0] as { data?: { payload?: { buildOutcome?: unknown } } })?.data?.payload;
      return payload && "buildOutcome" in payload;
    });
    expect(buildOutcomeUpdate).toBeDefined();
    const bo = (buildOutcomeUpdate![0] as { data: { payload: { buildOutcome: Record<string, unknown> } } }).data.payload.buildOutcome;
    expect(bo.built).toBe(false);
    expect(bo.state).toBe("partial");
    vi.useRealTimers();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// maybeAutoBuild — the AUTO path
// ════════════════════════════════════════════════════════════════════════════

describe("maybeAutoBuild", () => {
  it("AUTO + canWrite + kill-switch off → consumes + runs", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsAutonomy: "AUTO" }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await maybeAutoBuild("u1", "card-1");
    expect(res).toMatchObject({ built: true, state: "done" });
    expect(mockGraphPost).toHaveBeenCalled();
  });

  it("ASK mode → does NOT run", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsAutonomy: "ASK" }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await maybeAutoBuild("u1", "card-1");
    expect(res).toMatchObject({ built: false });
    expect(mockGraphPost).not.toHaveBeenCalled();
  });

  it("kill-switch ON → does NOT run (and does NOT consume the approval)", async () => {
    mockConnFindUnique.mockResolvedValue(conn({ adsAutonomy: "AUTO", adsWritesPaused: true }));
    mockMsgFindFirst.mockResolvedValue(card());

    const res = await maybeAutoBuild("u1", "card-1");
    expect(res).toMatchObject({ built: false });
    expect(mockGraphPost).not.toHaveBeenCalled();
    // The approval is NOT consumed (never burned) — no chatMessage.update stamps a consumedAt.
    // (A buildOutcome stamp may still write, but it must NOT carry approval.consumedAt.)
    const consumedAStamp = mockMsgUpdate.mock.calls.some(
      (c) => (c[0] as { data?: { payload?: { approval?: { consumedAt?: string } } } })?.data?.payload?.approval?.consumedAt,
    );
    expect(consumedAStamp).toBe(false);
  });

  it("a throw during the build (kill-switch race) → built:false, does NOT re-throw to caller", async () => {
    // AUTO + canWrite at gate time, but runAdBuild re-reads the conn and finds the kill-switch on
    // → it THROWS KILL_SWITCH. maybeAutoBuild's try/catch must swallow it → built:false, no throw.
    mockConnFindUnique
      .mockResolvedValueOnce(conn({ adsAutonomy: "AUTO", adsWritesPaused: false })) // gate read
      .mockResolvedValue(conn({ adsAutonomy: "AUTO", adsWritesPaused: true })); // runAdBuild re-read → throw
    mockMsgFindFirst.mockResolvedValue(card());

    await expect(maybeAutoBuild("u1", "card-1")).resolves.toMatchObject({ built: false });
  });
});
