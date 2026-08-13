/**
 * #779 — `/admin/queue` opens, and it is gated.
 *
 * Kept in its own file rather than appended to `admin-routes-load.test.ts`: that file's two
 * arrays are documented as "the eight routes that render the v2 dashboard" and "the nine
 * legacy redirects", and this route is neither — it renders its own board and never calls
 * `getAdminV2Data()`. The guarantee that file exists for (the route actually opens) is
 * asserted here for this route instead of blurred into its lists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireRole, mockFetch } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireRole: mockRequireRole }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  delete process.env.QUEUE_METRICS_QUERY_URL;
});

/** next/navigation signals a redirect by throwing; the destination rides in the digest. */
async function landingOf(page: () => Promise<unknown>): Promise<{ rendered: unknown; redirectedTo: string | null }> {
  try {
    return { rendered: await page(), redirectedTo: null };
  } catch (error) {
    const parts = ((error as { digest?: string }).digest ?? "").split(";");
    return { rendered: null, redirectedTo: parts.length > 2 ? parts[2] : null };
  }
}

describe("#779 /admin/queue", () => {
  it("renders for a session that holds system.read", async () => {
    mockRequireRole.mockResolvedValue({ email: "founder@fikirtive.test", roles: ["super-admin"], role: "super-admin" });
    const page = (await import("../queue/page")).default;

    const { rendered, redirectedTo } = await landingOf(page);

    expect(redirectedTo).toBeNull();
    expect(rendered, "the route produced nothing to render").toBeTruthy();
    expect(mockRequireRole).toHaveBeenCalledWith("system", "read");
  });

  it("redirects a session without the capability instead of rendering the board", async () => {
    mockRequireRole.mockResolvedValue({ error: "You don't have access to this." });
    const page = (await import("../queue/page")).default;

    const { rendered, redirectedTo } = await landingOf(page);

    expect(rendered).toBeNull();
    expect(redirectedTo).toBe("/login?from=/admin/queue");
  });

  it("reads no tenant data and calls nothing remote when the store is unconfigured", async () => {
    mockRequireRole.mockResolvedValue({ email: "founder@fikirtive.test", roles: ["super-admin"], role: "super-admin" });
    const page = (await import("../queue/page")).default;

    await landingOf(page);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
