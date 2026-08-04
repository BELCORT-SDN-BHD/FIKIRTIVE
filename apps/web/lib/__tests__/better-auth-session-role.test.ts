import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { user: { findUnique: mockFindUnique } } }));

const { roleForEmail } = await import("@/lib/better-auth/session-role");

beforeEach(() => mockFindUnique.mockReset());

describe("roleForEmail", () => {
  it("returns the deterministic primary assigned role", async () => {
    mockFindUnique.mockResolvedValue({
      role: "viewer",
      roles: [{ role: "finance" }, { role: "ops" }],
    });
    expect(await roleForEmail("a@x.test")).toBe("ops");
  });

  it("does not let the legacy compatibility column grant access", async () => {
    mockFindUnique.mockResolvedValue({ role: "super-admin", roles: [] });
    expect(await roleForEmail("a@x.test")).toBe("viewer");
  });

  it("defaults to viewer on missing user, garbage assignments, no email, or DB error", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    mockFindUnique.mockResolvedValue({ role: "ops", roles: [{ role: "wat" }] });
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    expect(await roleForEmail(null)).toBe("viewer");
    mockFindUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await roleForEmail("a@x.test")).toBe("viewer");
  });
});
