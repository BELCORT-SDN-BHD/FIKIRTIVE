import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMembershipFindFirst } = vi.hoisted(() => ({
  mockMembershipFindFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({
  prisma: { membership: { findFirst: mockMembershipFindFirst } },
}));

import { requireOrgPermission, type OwnerGate } from "../org-role-guard";

const GATE: OwnerGate = { email: "aisha@example.com", ownerId: "org-a" };
const DENIED = { error: "You don't have access to this." };

function seat(roles: string[]) {
  return {
    id: "mem-1",
    roles: roles.map((role) => ({ role })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMembershipFindFirst.mockResolvedValue(null);
});

describe("requireOrgPermission", () => {
  it("combines creator and approver assignments", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat(["creator", "approver"]));

    expect(await requireOrgPermission(GATE, "content.create")).toEqual({
      orgRoles: ["creator", "approver"],
      membershipId: "mem-1",
    });
    expect(await requireOrgPermission(GATE, "content.approve")).toEqual({
      orgRoles: ["creator", "approver"],
      membershipId: "mem-1",
    });
  });

  it("checks the capability instead of a minimum role rank", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat(["creator"]));
    expect(await requireOrgPermission(GATE, "content.create")).toMatchObject({
      orgRoles: ["creator"],
    });
    expect(await requireOrgPermission(GATE, "content.approve")).toEqual(DENIED);
  });

  it("does not let the compatibility column grant access", async () => {
    mockMembershipFindFirst.mockResolvedValue({ id: "mem-1", role: "owner", roles: [] });
    expect(await requireOrgPermission(GATE, "workflow.manage")).toEqual(DENIED);
  });

  it("unknown stored roles grant nothing", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat(["superuser"]));
    expect(await requireOrgPermission(GATE, "workspace.read")).toEqual(DENIED);
  });

  it("scopes the lookup to the authenticated org and email", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat(["member"]));
    await requireOrgPermission(GATE, "workspace.read");
    expect(mockMembershipFindFirst).toHaveBeenCalledWith({
      where: {
        orgId: "org-a",
        status: "active",
        deletedAt: null,
        user: { email: "aisha@example.com" },
      },
      select: {
        id: true,
        roles: { select: { role: true } },
      },
    });
  });

  it("denies an invalid identity before querying", async () => {
    expect(
      await requireOrgPermission({ email: "", ownerId: "org-a" }, "workspace.read"),
    ).toEqual({ error: "Not authorized." });
    expect(mockMembershipFindFirst).not.toHaveBeenCalled();
  });

  it("fails closed when the database fails", async () => {
    mockMembershipFindFirst.mockRejectedValue(new Error("connection terminated"));
    await expect(requireOrgPermission(GATE, "workspace.read")).rejects.toThrow(
      "connection terminated",
    );
  });
});
