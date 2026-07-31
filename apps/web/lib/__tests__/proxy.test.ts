import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();

vi.mock("@/lib/better-auth/server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

const { default: proxy, config } = await import("../../proxy");

const STALE_THREAD_ACTIVITY_ACTION_ID = "40e295ab821708676046d9a9ce1d58dca80ea9c87c";

// Next runs proxy() ONLY for a pathname that matches config.matcher; an excluded path never even
// reaches the auth wall. So exercise the REAL matcher regex (the same source Next compiles) to
// prove the exclusion, rather than trusting proxy() alone (which the harness can call directly).
function matcherRuns(pathname: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(pathname);
}

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

// H1: the signed media proxy is fetched by Meta's servers with NO session. If the auth wall
// redirected it to /login, every published post's media would 404 at Meta → publish fails. The
// matcher must exclude EXACTLY /api/media/pub/* (HMAC is its sole auth), and nothing else.
describe("proxy — public signed media route (/api/media/pub)", () => {
  it("the matcher does NOT run the auth wall for /api/media/pub/<token> (Meta fetches it, no session)", () => {
    expect(matcherRuns("/api/media/pub/eyJvIjoib3JnQSJ9.deadbeef")).toBe(false);
  });

  it("boundary (契约5): a same-prefix sibling /api/media/pubfoo stays WALLED, not bypassed", () => {
    // Regression for the v0.2-flagged matcher gap: the exclusion was an UN-bounded prefix
    // (api/media/pub), so /api/media/pubfoo escaped the wall by merely sharing the prefix. The
    // exclusion is now anchored to exactly the /api/media/pub/* [token] route.
    expect(matcherRuns("/api/media/pubfoo")).toBe(true); // walled — NOT the signed-media route
    expect(matcherRuns("/api/media/pub/abc.def")).toBe(false); // real token route stays excluded
  });

  it("keeps the wall on other protected routes → an unauthenticated request still redirects", async () => {
    // The exception is scoped: siblings of the media route are still walled by the matcher.
    expect(matcherRuns("/dashboard")).toBe(true);
    expect(matcherRuns("/api/otto/thread-activity")).toBe(true);
    expect(matcherRuns("/api/media/other")).toBe(true); // ONLY api/media/pub is public, not all api/media

    // And a route the matcher DOES run redirects a session-less request (proves the wall still bites).
    const res = await proxy(req("/dashboard"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #563: /legal/data-deletion is the URL filed with Meta as the app's Data deletion URL
// (app/api/meta/data-deletion/route.ts:76 returns `${origin}/legal/data-deletion?code=…`).
// Meta's reviewer opens it with NO session, so it must render outside the auth wall — if it
// ever redirected to /login, App Review would fail the Data deletion requirement. The wall
// itself is what these assertions pin: the page's own reachability, and the fact that the
// exemption did not quietly widen into the authenticated app.
describe("proxy — public data-deletion page (/legal/data-deletion)", () => {
  it("the matcher does NOT run the auth wall for /legal/data-deletion (Meta's reviewer has no session)", () => {
    expect(matcherRuns("/legal/data-deletion")).toBe(false);
  });

  it("does not open the authenticated app: the walled routes around it stay walled", () => {
    // Scope check. /legal is the ONLY public prefix this page needs; the product's own
    // surfaces — including the ones that perform the self-service deletions the page
    // describes — must still require a session.
    expect(matcherRuns("/otto")).toBe(true); // campaigns, conversations, Connections → Disconnect
    expect(matcherRuns("/library")).toBe(true); // library asset deletion
    expect(matcherRuns("/crm/contacts")).toBe(true);
    expect(matcherRuns("/billing")).toBe(true);
  });

  it("a session-less request to a walled route still redirects to /login", async () => {
    // Proves the wall is live in this test's env, so the `false` assertions above mean
    // "exempted", not "wall switched off".
    const res = await proxy(req("/crm/contacts"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});
