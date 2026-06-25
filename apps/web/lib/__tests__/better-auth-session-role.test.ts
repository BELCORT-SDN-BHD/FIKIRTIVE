import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({ prisma: { user: { findUnique: mockFindUnique } } }));

const { roleForEmail } = await import("@/lib/better-auth/session-role");

beforeEach(() => mockFindUnique.mockReset());

describe("roleForEmail", () => {
  it("returns the user's role when valid", async () => {
    mockFindUnique.mockResolvedValue({ role: "ops" });
    expect(await roleForEmail("a@x.test")).toBe("ops");
  });
  it("defaults to viewer on missing user, garbage role, no email, or DB error", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    mockFindUnique.mockResolvedValue({ role: "wat" });
    expect(await roleForEmail("a@x.test")).toBe("viewer");
    expect(await roleForEmail(null)).toBe("viewer");
    mockFindUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await roleForEmail("a@x.test")).toBe("viewer");
  });
});
