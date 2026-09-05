import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectThreadActivity: vi.fn(),
  hasPendingPanelThread: vi.fn(),
}));

vi.mock("@/lib/thread-activity", () => ({
  listProjectThreadActivity: mocks.listProjectThreadActivity,
  hasPendingPanelThread: mocks.hasPendingPanelThread,
}));

const { GET } = await import("../route");

function req(url: string) {
  return { nextUrl: new URL(url) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/otto/thread-activity", () => {
  // 不带 projectId 是**面板问的那一句**(FRONT-A14),不再是一个缺参数的请求。它走另一个
  // 数据函数,project 那一条读路一次都不会被碰到。
  it("FRONT-A14: answers the panel's expand signal when no projectId is given", async () => {
    mocks.hasPendingPanelThread.mockResolvedValue({ pending: true });

    const res = await GET(req("https://app.test/api/otto/thread-activity"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: true });
    expect(mocks.hasPendingPanelThread).toHaveBeenCalledWith();
    expect(mocks.listProjectThreadActivity).not.toHaveBeenCalled();
  });

  it("FRONT-A14: maps the expand signal's auth failure to 401", async () => {
    mocks.hasPendingPanelThread.mockResolvedValue({ error: "Not authorized." });

    const res = await GET(req("https://app.test/api/otto/thread-activity"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authorized." });
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
