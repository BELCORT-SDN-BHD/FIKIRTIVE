import { describe, it, expect, vi, beforeEach } from "vitest";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

// Unit test (no DB): mock prisma so the invariants hold deterministically —
//  (1) every cross-tenant findMany carries an explicit ownerId predicate (guard-safe),
//  (2) NO storage URL is ever emitted (only safe metadata), and
//  (3) each message kind shapes to the right safe fields.
// Only the methods conversation-admin calls are provided — a stray write throws.

const chatThreadFindMany = vi.fn();
const chatThreadFindUnique = vi.fn();
const projectFindMany = vi.fn();
const projectFindUnique = vi.fn();
const chatMessageFindMany = vi.fn();
const chatMessageGroupBy = vi.fn();
const membershipFindMany = vi.fn();
const genJobFindMany = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatThread: { findMany: chatThreadFindMany, findUnique: chatThreadFindUnique },
    project: { findMany: projectFindMany, findUnique: projectFindUnique },
    chatMessage: { findMany: chatMessageFindMany, groupBy: chatMessageGroupBy },
    membership: { findMany: membershipFindMany },
    genJob: { findMany: genJobFindMany },
  },
}));

const { listConversations, getConversation } = await import("@/lib/conversation-admin");

beforeEach(() => {
  for (const m of [chatThreadFindMany, chatThreadFindUnique, projectFindMany, projectFindUnique, chatMessageFindMany, chatMessageGroupBy, membershipFindMany, genJobFindMany]) m.mockReset();
});

describe("listConversations", () => {
  it("reads threads guard-safe (ownerId predicate, live only) and joins owner+project+count", async () => {
    const now = new Date("2026-06-24T10:00:00Z");
    chatThreadFindMany.mockResolvedValue([
      { id: "t1", ownerId: "org_u1", projectId: "p1", title: "Cat video", updatedAt: now },
      { id: "t2", ownerId: FOUNDER_OWNER_ID, projectId: "p2", title: "Test", updatedAt: now },
    ]);
    projectFindMany.mockResolvedValue([{ id: "p1", name: "Spring promo" }, { id: "p2", name: "Sandbox" }]);
    chatMessageGroupBy.mockResolvedValue([{ threadId: "t1", _count: { _all: 6 } }, { threadId: "t2", _count: { _all: 2 } }]);
    membershipFindMany.mockResolvedValue([{ orgId: "org_u1", user: { email: "merchant@shop.test" } }]);

    const rows = await listConversations();

    // guard-safe: the where carries an ownerId predicate + filters soft-deleted (no unscoped scan)
    expect(chatThreadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: { not: "" }, deletedAt: null } }),
    );
    // project findMany also carries an ownerId predicate (guard-safe); message count filters deleted
    expect(projectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ["org_u1", FOUNDER_OWNER_ID] } }) }),
    );
    expect(chatMessageGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ threadId: "t1", ownerEmail: "merchant@shop.test", projectName: "Spring promo", messageCount: 6 });
    // founder org with no owner-membership email → "founder" label
    expect(rows[1].ownerEmail).toBe("founder");
    expect(rows[1].messageCount).toBe(2);
    expect(rows[0].lastActiveAt).toBe(now.toISOString());
  });

  it("returns [] when there are no threads", async () => {
    chatThreadFindMany.mockResolvedValue([]);
    const rows = await listConversations();
    expect(rows).toEqual([]);
    expect(projectFindMany).not.toHaveBeenCalled();
  });
});

describe("getConversation", () => {
  it("returns null when the thread does not exist", async () => {
    chatThreadFindUnique.mockResolvedValue(null);
    expect(await getConversation("nope")).toBeNull();
    expect(chatMessageFindMany).not.toHaveBeenCalled();
  });

  it("returns null for a soft-deleted thread (not surfaced)", async () => {
    chatThreadFindUnique.mockResolvedValue({ id: "td", ownerId: "org_u1", projectId: "p", title: "t", createdAt: new Date("2026-06-24T00:00:00Z"), deletedAt: new Date("2026-06-24T01:00:00Z") });
    expect(await getConversation("td")).toBeNull();
    expect(chatMessageFindMany).not.toHaveBeenCalled();
  });

  it("pins message + job reads to the thread's owner and shapes every kind safely (no URLs)", async () => {
    const now = new Date("2026-06-24T11:00:00Z");
    chatThreadFindUnique.mockResolvedValue({ id: "t1", ownerId: "org_u1", projectId: "p1", title: "Cat video", createdAt: now });
    projectFindUnique.mockResolvedValue({ name: "Spring promo" });
    chatMessageFindMany.mockResolvedValue([
      { id: "m1", role: "USER", kind: "TEXT", seq: 1, text: "make a cat video", payload: null, genJobId: null, createdAt: now },
      { id: "m2", role: "AGENT", kind: "PLAN", seq: 2, text: "", payload: { planSteps: ["generate keyframe", "animate"] }, genJobId: null, createdAt: now },
      { id: "m3", role: "AGENT", kind: "GEN_CARD", seq: 3, text: "", payload: { model: "seedream", kind: "image", structuredPrompt: "a cat in a forest", estimatedPriceUsd: 0.04, urls: ["/files/u/org_u1/leak.png"] }, genJobId: null, createdAt: now },
      { id: "m4", role: "AGENT", kind: "GEN_RESULT", seq: 4, text: "", payload: { model: "seedream", kind: "image", urls: ["/files/u/org_u1/secret.png"] }, genJobId: "job1", createdAt: now },
    ]);
    genJobFindMany.mockResolvedValue([{ id: "job1", status: "DONE", spentUsd: 0.04 }]);
    membershipFindMany.mockResolvedValue([{ orgId: "org_u1", user: { email: "merchant@shop.test" } }]);

    const detail = await getConversation("t1");
    expect(detail).not.toBeNull();

    // messages pinned to the thread's owner (guard-safe), not the admin's
    expect(chatMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: "t1", ownerId: "org_u1", deletedAt: null } }),
    );
    expect(genJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["job1"] }, ownerId: "org_u1" } }),
    );

    // kind-specific shaping
    expect(detail!.messages[1].planSteps).toEqual(["generate keyframe", "animate"]);
    expect(detail!.messages[2].card).toMatchObject({ model: "seedream", kind: "image", prompt: "a cat in a forest", estimatedPriceUsd: 0.04 });
    expect(detail!.messages[3].result).toMatchObject({ model: "seedream", kind: "image", genJobId: "job1", status: "DONE", spentUsd: 0.04 });
    expect(detail!.projectName).toBe("Spring promo");

    // SAFETY INVARIANT: the shaped output must NEVER carry a storage URL, even though
    // the raw GEN_CARD/GEN_RESULT payloads contained /files/ paths.
    const json = JSON.stringify(detail);
    expect(json).not.toContain("/files/");
    expect(json).not.toContain("leak.png");
    expect(json).not.toContain("secret.png");
    expect(json).not.toMatch(/https?:\/\//);
  });

  it("labels the founder org owner as 'founder' when no owner email exists", async () => {
    const now = new Date("2026-06-24T12:00:00Z");
    chatThreadFindUnique.mockResolvedValue({ id: "tf", ownerId: FOUNDER_OWNER_ID, projectId: "p", title: "t", createdAt: now });
    projectFindUnique.mockResolvedValue({ name: "x" });
    chatMessageFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);
    const detail = await getConversation("tf");
    expect(detail!.ownerEmail).toBe("founder");
  });
});
