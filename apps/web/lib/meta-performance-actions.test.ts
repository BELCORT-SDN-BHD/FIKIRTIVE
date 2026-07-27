import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ requireOwner: vi.fn(), fetch: vi.fn() }));
vi.mock("./auth-guard", async () => ({ requireOwner: h.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("./meta-performance", () => ({ fetchOwnerAdPerformance: h.fetch }));
import { getAdPerformance } from "./meta-performance-actions";
beforeEach(() => vi.clearAllMocks());

describe("getAdPerformance (server action)", () => {
  it("scopes to the session owner (gate.ownerId), never a client-supplied org", async () => {
    h.requireOwner.mockResolvedValue({ ownerId: "owner-session", email: "o@x.com" });
    h.fetch.mockResolvedValue({ ads: [], truncated: false, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "t" });
    const r = await getAdPerformance("last_30d");
    expect(h.fetch).toHaveBeenCalledWith("owner-session", "last_30d");
    expect(r).toMatchObject({ ads: [] });
  });
  it("returns the auth error without fetching when the session is unauthorized", async () => {
    h.requireOwner.mockResolvedValue({ error: "unauthorized" });
    const r = await getAdPerformance("last_30d");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(r).toEqual({ error: "unauthorized" });
  });

  it("rejects a datePreset outside the allowed enum without fetching (#128)", async () => {
    h.requireOwner.mockResolvedValue({ ownerId: "owner-session", email: "o@x.com" });
    for (const bad of ["all_time", "last_365d", "'; DROP", ""]) {
      const r = await getAdPerformance(bad);
      expect(r).toEqual({ error: "Invalid date range." });
    }
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("accepts every allowed preset", async () => {
    h.requireOwner.mockResolvedValue({ ownerId: "owner-session", email: "o@x.com" });
    h.fetch.mockResolvedValue({ ads: [], truncated: false, organic: { status: "pending_permission" }, datePreset: "last_7d", fetchedAt: "t" });
    for (const good of ["last_7d", "last_14d", "last_30d", "last_90d"]) {
      await getAdPerformance(good);
      expect(h.fetch).toHaveBeenCalledWith("owner-session", good);
    }
  });
});
