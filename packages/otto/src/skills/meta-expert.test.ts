import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeMetaExpert, metaExpertSkill } from "./meta-expert.js";
import type { OttoContext } from "../context.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

function makeCtx(over?: Partial<OttoContext>): OttoContext {
  return { orgId: "org-test", userId: "u", projectId: "p", threadId: "t-1", disabledModels: [], sourceGenerationId: null, ...over } as OttoContext;
}

// #692 r3: the port hands over finished money text and a hasSpend flag — never an amount.
const ad = (adId: string, ctr: string | null, roas: string | null = null) => ({
  adId,
  adName: `Ad ${adId}`,
  accountId: "act_1",
  accountName: "Kaia Cafe",
  currency: "MYR",
  moneyBucket: "MYR",
  money: { spend: "MYR 100", cpc: "MYR 0.5", cpm: "—" },
  hasSpend: true,
  metrics: { ctr, purchaseRoas: roas, reach: "1000" } as Record<string, string | null>,
  creative: { imageUrl: `https://img/${adId}.png`, body: null, title: null, videoId: null },
});

describe("metaExpertSkill gate", () => {
  it("free/write/internal → not gated", () => {
    expect(metaExpertSkill.cost).toBe("free");
    expect(metaExpertSkill.effect).toBe("write");
    expect(metaExpertSkill.reach).toBe("internal");
    expect(metaExpertSkill.needsApproval).toBe(false);
  });
});

describe("executeMetaExpert — mock DB + ctx port", () => {
  let m: { chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    vi.clearAllMocks();
    m = (await import("@fikirtive/db")).prisma as unknown as typeof m;
    m.chatMessage.findFirst.mockResolvedValue({ seq: 7 });
    m.chatMessage.create.mockResolvedValue({});
  });

  it("absent metaPerformance port → NOT_CONNECTED message, no prisma write", async () => {
    const res = await executeMetaExpert({ datePreset: "last_30d" }, { context: makeCtx({ metaPerformance: undefined }) });
    expect(res).toEqual({ message: expect.stringContaining("Meta isn't connected") });
    expect(m.chatMessage.create).not.toHaveBeenCalled();
  });

  it("notConnected result → NOT_CONNECTED, no write", async () => {
    const ctx = makeCtx({ metaPerformance: { getAds: vi.fn().mockResolvedValue({ notConnected: true }) } });
    const res = await executeMetaExpert({ datePreset: "last_30d" }, { context: ctx });
    expect(res).toEqual({ message: expect.stringContaining("Meta isn't connected") });
    expect(m.chatMessage.create).not.toHaveBeenCalled();
  });

  it("needsReconnect result → NOT_CONNECTED, no write", async () => {
    const ctx = makeCtx({ metaPerformance: { getAds: vi.fn().mockResolvedValue({ needsReconnect: true }) } });
    const res = await executeMetaExpert({ datePreset: "last_30d" }, { context: ctx });
    expect(res).toEqual({ message: expect.stringContaining("Meta isn't connected") });
    expect(m.chatMessage.create).not.toHaveBeenCalled();
  });

  it("empty ads → honest empty-window message, no write", async () => {
    const ctx = makeCtx({
      metaPerformance: {
        getAds: vi.fn().mockResolvedValue({
          ads: [],
          truncated: false,
          organic: { posts: [] },
          datePreset: "last_30d",
          fetchedAt: "2026-07-03T00:00:00.000Z",
        }),
      },
    });
    const res = await executeMetaExpert({ datePreset: "last_30d" }, { context: ctx });
    expect(res).toEqual({ message: expect.stringContaining("no ads ran in this window") });
    expect(m.chatMessage.create).not.toHaveBeenCalled();
  });

  it("with ads → persists a PERFORMANCE_CARD with seq=last+1, text='', verdicts from the diagnosis engine", async () => {
    const ctx = makeCtx({
      orgId: "org-A",
      threadId: "thr-A",
      metaPerformance: {
        getAds: vi.fn().mockResolvedValue({
          ads: [ad("a1", "3.5"), ad("a2", "0.4")],
          truncated: false,
          organic: { posts: [] },
          datePreset: "last_30d",
          fetchedAt: "2026-07-03T00:00:00.000Z",
        }),
      },
    });
    const res = await executeMetaExpert({ datePreset: "last_30d" }, { context: ctx });

    expect(m.chatMessage.create).toHaveBeenCalledTimes(1);
    const data = (m.chatMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.kind).toBe("PERFORMANCE_CARD");
    expect(data.ownerId).toBe("org-A");
    expect(data.threadId).toBe("thr-A");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(8);
    expect(data.text).toBe("");

    const payload = data.payload as { verdicts: { adId: string; verdict: string }[]; metricUsed: string; ads: { adId: string; imageUrl: string | null }[] };
    expect(Array.isArray(payload.verdicts)).toBe(true);
    expect(payload.verdicts.length).toBe(2);
    // spot-check one verdict came from the diagnosis engine (winner has the higher CTR)
    const winner = payload.verdicts.find((v) => v.adId === "a1")!;
    expect(winner.verdict).toBe("winner");
    expect(payload.ads).toEqual([
      { adId: "a1", imageUrl: "https://img/a1.png", isVideo: false },
      { adId: "a2", imageUrl: "https://img/a2.png", isVideo: false },
    ]);

    expect(res).toEqual({ cardId: expect.any(String), summary: expect.any(String) });
  });

  it("ROAS-present heuristic → objective inferred as conversions, engine uses ROAS", async () => {
    const ctx = makeCtx({
      metaPerformance: {
        getAds: vi.fn().mockResolvedValue({
          ads: [ad("a1", "3.5", "4.0"), ad("a2", "0.4", "0.5")],
          truncated: false,
          organic: { posts: [] },
          datePreset: "last_30d",
          fetchedAt: "2026-07-03T00:00:00.000Z",
        }),
      },
    });
    await executeMetaExpert({ datePreset: "last_30d" }, { context: ctx });
    const data = (m.chatMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    const payload = data.payload as { metricUsed: string };
    expect(payload.metricUsed).toBe("ROAS");
  });
});
