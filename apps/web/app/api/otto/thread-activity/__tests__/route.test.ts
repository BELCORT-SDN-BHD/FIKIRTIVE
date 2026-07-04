import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectThreadActivity: vi.fn(),
}));

vi.mock("@/lib/thread-activity", () => ({
  listProjectThreadActivity: mocks.listProjectThreadActivity,
}));

const { GET } = await import("../route");

function req(url: string) {
  return { nextUrl: new URL(url) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/otto/thread-activity", () => {
  it("rejects a request without projectId before touching the data helper", async () => {
    const res = await GET(req("https://app.test/api/otto/thread-activity"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Project required." });
    expect(mocks.listProjectThreadActivity).not.toHaveBeenCalled();
  });

  it("maps auth failures to 401", async () => {
    mocks.listProjectThreadActivity.mockResolvedValue({ error: "Not authorized." });

    const res = await GET(req("https://app.test/api/otto/thread-activity?projectId=p1"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authorized." });
    expect(mocks.listProjectThreadActivity).toHaveBeenCalledWith("p1");
  });

  it("maps owner-scoped project misses to 404", async () => {
    mocks.listProjectThreadActivity.mockResolvedValue({ error: "Project not found." });

    const res = await GET(req("https://app.test/api/otto/thread-activity?projectId=p-other"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found." });
    expect(mocks.listProjectThreadActivity).toHaveBeenCalledWith("p-other");
  });

  it("returns activity rows on success", async () => {
    mocks.listProjectThreadActivity.mockResolvedValue([{ threadId: "t1", pending: true }]);

    const res = await GET(req("https://app.test/api/otto/thread-activity?projectId=p1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activity: [{ threadId: "t1", pending: true }] });
    expect(mocks.listProjectThreadActivity).toHaveBeenCalledWith("p1");
  });
});
