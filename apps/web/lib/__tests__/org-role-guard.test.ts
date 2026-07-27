import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMembershipFindFirst } = vi.hoisted(() => ({ mockMembershipFindFirst: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({
  prisma: { membership: { findFirst: mockMembershipFindFirst } },
}));

import { requireOrgRole, type OwnerGate } from "../org-role-guard";
import type { OrgRole } from "@fikirtive/core";

const GATE: OwnerGate = { email: "aisha@example.com", ownerId: "org-a" };
const DENIED = { error: "You don't have access to this." };
const NOT_AUTHORIZED = { error: "Not authorized." };

/** The one row the guard is allowed to read: the caller's own membership in gate.ownerId. */
function seat(role: string) {
  return { id: "mem-1", role };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMembershipFindFirst.mockResolvedValue(null);
});

describe("requireOrgRole — the rank ladder (owner > admin > member)", () => {
  const matrix: Array<{ role: OrgRole; admits: OrgRole[]; denies: OrgRole[] }> = [
    { role: "owner", admits: ["owner", "admin", "member"], denies: [] },
    { role: "admin", admits: ["admin", "member"], denies: ["owner"] },
    { role: "member", admits: ["member"], denies: ["owner", "admin"] },
  ];

  for (const { role, admits, denies } of matrix) {
    for (const minRole of admits) {
      it(`admits ${role} when minRole=${minRole}`, async () => {
        mockMembershipFindFirst.mockResolvedValue(seat(role));
        expect(await requireOrgRole(GATE, minRole)).toEqual({
          orgRole: role,
          membershipId: "mem-1",
        });
      });
    }
    for (const minRole of denies) {
      it(`denies ${role} when minRole=${minRole}`, async () => {
        mockMembershipFindFirst.mockResolvedValue(seat(role));
        expect(await requireOrgRole(GATE, minRole)).toEqual(DENIED);
      });
    }
  }

  it("reports the role the row actually holds — never the threshold that was asked for", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat("admin"));
    const result = await requireOrgRole(GATE, "member");
    expect(result).toMatchObject({ orgRole: "admin" });
  });
});

describe("requireOrgRole — missing identity denies without touching the database", () => {
  const bad: Array<[string, unknown]> = [
    ["undefined gate", undefined],
    ["null gate", null],
    ["no email", { ownerId: "org-a" }],
    ["blank email", { email: "   ", ownerId: "org-a" }],
    ["no ownerId", { email: "aisha@example.com" }],
    ["blank ownerId", { email: "aisha@example.com", ownerId: "" }],
  ];

  for (const [label, gate] of bad) {
    it(`denies with ${label}`, async () => {
      expect(await requireOrgRole(gate as OwnerGate, "member")).toEqual(NOT_AUTHORIZED);
      expect(mockMembershipFindFirst).not.toHaveBeenCalled();
    });
  }
});

describe("requireOrgRole — the role itself must be readable", () => {
  it("denies when the caller holds no membership row in this org (the founder-admin path)", async () => {
    mockMembershipFindFirst.mockResolvedValue(null);
    expect(await requireOrgRole({ email: "founder@example.com", ownerId: "founder" }, "member"))
      .toEqual(DENIED);
  });

  const unreadable: Array<[string, unknown]> = [
    ["an unknown role", "superuser"],
    ["a platform-staff role", "super-admin"],
    ["an empty role", ""],
    ["a null role", null],
    ["a numeric role", 0],
  ];

  for (const [label, role] of unreadable) {
    it(`denies ${label}`, async () => {
      mockMembershipFindFirst.mockResolvedValue({ id: "mem-1", role });
      expect(await requireOrgRole(GATE, "member")).toEqual(DENIED);
    });
  }

  it("denies an unknown minRole without reading anything", async () => {
    expect(await requireOrgRole(GATE, "superuser" as OrgRole)).toEqual(DENIED);
    expect(mockMembershipFindFirst).not.toHaveBeenCalled();
  });
});

describe("requireOrgRole — cross-merchant isolation", () => {
  it("scopes the lookup to gate.ownerId AND the session email, and to live rows only", async () => {
    mockMembershipFindFirst.mockResolvedValue(seat("owner"));
    await requireOrgRole(GATE, "owner");
    expect(mockMembershipFindFirst).toHaveBeenCalledTimes(1);
    expect(mockMembershipFindFirst.mock.calls[0][0]).toEqual({
      where: {
        orgId: "org-a",
        status: "active",
        deletedAt: null,
        user: { email: "aisha@example.com" },
      },
      select: { id: true, role: true },
    });
  });

  it("denies an owner of another merchant — their seat is not in this org, so no row matches", async () => {
    // org-b's owner asking for org-a: the scoped lookup finds nothing.
    mockMembershipFindFirst.mockImplementation(async (args: { where: { orgId: string } }) =>
      args.where.orgId === "org-b" ? seat("owner") : null,
    );
    expect(await requireOrgRole({ email: "bo@example.com", ownerId: "org-a" }, "member"))
      .toEqual(DENIED);
  });

  it("returns the seat only — the tenant scope stays on the caller's requireOwner gate", async () => {
    // #469 provenance: a query scoped by a value laundered through this function reads as
    // `principal-result-unused` to the auth-guard fence, so the seat must not re-emit ownerId.
    mockMembershipFindFirst.mockResolvedValue(seat("owner"));
    const result = await requireOrgRole({ email: "bo@example.com", ownerId: "org-b" }, "owner");
    expect(Object.keys(result).sort()).toEqual(["membershipId", "orgRole"]);
  });
});

describe("requireOrgRole — fail closed on infrastructure failure", () => {
  it("rejects instead of resolving to a permit when the lookup throws", async () => {
    mockMembershipFindFirst.mockRejectedValue(new Error("connection terminated"));
    await expect(requireOrgRole(GATE, "member")).rejects.toThrow("connection terminated");
  });
});
