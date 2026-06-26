import { describe, it, expect, vi, beforeEach } from "vitest";
const mockGetSession = vi.fn();
vi.mock("@/lib/better-auth/server", () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const mockRoleForEmail = vi.fn();
vi.mock("@/lib/better-auth/session-role", () => ({ roleForEmail: mockRoleForEmail }));
const { auth } = await import("@/lib/better-auth/compat");

beforeEach(() => { mockGetSession.mockReset(); mockRoleForEmail.mockReset(); });

describe("compat auth()", () => {
  it("returns null when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await auth()).toBeNull();
  });
  it("returns the NextAuth-shaped session with role", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "a@x.test", name: "A", image: null } });
    mockRoleForEmail.mockResolvedValue("ops");
    expect(await auth()).toEqual({ user: { email: "a@x.test", name: "A", image: null, role: "ops" } });
  });
});

describe("isImpersonating", () => {
  it("true when the raw session has impersonatedBy", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "x@t.test" }, session: { impersonatedBy: "admin_1" } });
    const { isImpersonating } = await import("@/lib/better-auth/compat");
    expect(await isImpersonating()).toBe(true);
  });
  it("false when not impersonating / no session", async () => {
    mockGetSession.mockResolvedValue({ user: { email: "x@t.test" }, session: { impersonatedBy: null } });
    const { isImpersonating } = await import("@/lib/better-auth/compat");
    expect(await isImpersonating()).toBe(false);
    mockGetSession.mockResolvedValue(null);
    expect(await isImpersonating()).toBe(false);
  });
});
