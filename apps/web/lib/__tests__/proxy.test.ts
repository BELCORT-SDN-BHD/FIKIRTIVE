import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();

vi.mock("@/lib/better-auth/server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

const { default: proxy } = await import("../../proxy");

const STALE_THREAD_ACTIVITY_ACTION_ID = "40e295ab821708676046d9a9ce1d58dca80ea9c87c";

function req(path: string, init?: { method?: string; headers?: HeadersInit }) {
  return {
    method: init?.method ?? "GET",
    nextUrl: new URL(`https://app.test${path}`),
    headers: new Headers(init?.headers),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_ENABLED", "true");
  mockGetSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("no-ops stale Otto thread activity Server Action posts before auth", async () => {
    const res = await proxy(req("/otto?project=project_1", {
      method: "POST",
      headers: { "next-action": STALE_THREAD_ACTIVITY_ACTION_ID },
    }));

    expect(res?.status).toBe(204);
    expect(res?.headers).toMatchObject({
      "cache-control": "no-store",
      "x-fikirtive-stale-client": "otto-thread-activity",
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("does not intercept other Otto Server Action posts", async () => {
    const res = await proxy(req("/otto?project=project_1", {
      method: "POST",
      headers: { "next-action": "other-action" },
    }));

    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("does not intercept the stable thread activity API route", async () => {
    const res = await proxy(req("/api/otto/thread-activity?projectId=project_1", {
      method: "GET",
    }));

    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});
