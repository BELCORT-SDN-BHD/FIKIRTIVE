import { describe, it, expect, vi, beforeEach } from "vitest";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

// Unit test (no DB): mock prisma so the invariants hold deterministically —
//  (1) every cross-tenant findMany carries an explicit ownerId predicate (guard-safe), and
//  (2) the rows carry METADATA ONLY (title/owner/project/count/time — no message bodies).
// Only the methods conversation-admin calls are provided — a stray write throws.

const chatThreadFindMany = vi.fn();
const projectFindMany = vi.fn();
const chatMessageGroupBy = vi.fn();
const membershipFindMany = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatThread: { findMany: chatThreadFindMany },
    project: { findMany: projectFindMany },
    chatMessage: { groupBy: chatMessageGroupBy },
    membership: { findMany: membershipFindMany },
  },
}));

const { listConversations } = await import("@/lib/conversation-admin");

beforeEach(() => {
  for (const m of [chatThreadFindMany, projectFindMany, chatMessageGroupBy, membershipFindMany]) m.mockReset();
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

// There is deliberately NO transcript-reader test here: `getConversation` (the cross-tenant
// message-body reader) was removed in C2b as a zero-caller export. This module is metadata-only,
// which is what the privacy page's "founder cannot read your messages" claim rests on.
