import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ requireOwner: vi.fn(), fetch: vi.fn() }));
vi.mock("./auth-guard", () => ({ requireOwner: h.requireOwner }));
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
});
