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

// #606 (T7 第二刀):`northstar` 曾整个前缀免认证 —— 那条豁免存在的唯一理由是设计稿画廊与
// 6 页 mock「反正生产 404」。假页删净、预览开关删除之后,这个前缀下只剩两条真产品路由
// (Home + Canvas),它们读的是商家自己的项目与画布。所以豁免收回:northstar 回到登录墙内。
describe("proxy — the northstar prefix is back inside the login wall (#606)", () => {
  it("runs the auth wall for the two real northstar routes", () => {
    expect(matcherRuns("/northstar-immersive")).toBe(true);
    expect(matcherRuns("/northstar-immersive/create/canvas")).toBe(true);
  });

  it("runs the auth wall for anything else under the prefix (no mock page can slip back out)", () => {
    expect(matcherRuns("/northstar")).toBe(true);
    expect(matcherRuns("/northstar-immersive/cityhall/admin")).toBe(true);
    expect(matcherRuns("/northstar-immersive/onboarding/login")).toBe(true);
  });

  it("a session-less request to the northstar canvas redirects to /login, keeping the deep link", async () => {
    const res = await proxy(req("/northstar-immersive/create/canvas?project=p-1"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("the exemptions that must stay are untouched", () => {
    // Scope check: pulling northstar back in must not disturb the doors that are public by design.
    expect(matcherRuns("/login")).toBe(false);
    expect(matcherRuns("/signup")).toBe(false);
    expect(matcherRuns("/legal/data-deletion")).toBe(false);
    expect(matcherRuns("/api/better-auth/callback/google")).toBe(false);
  });
});

// #940: the sign-up verification mail lands on /verify-email (lib/better-auth/verify-landing-url.ts
// builds that link; lib/better-auth/server.ts mails it). Everyone who clicks it is BY DEFINITION
// session-less — verifying is how they get a session — so the wall must not run there. It did:
// the page was missing from the exclusion list, so every new merchant was redirected to /login
// and the token in the link never reached Better Auth.
describe("proxy — email verification landing page (/verify-email)", () => {
  it("the matcher does NOT run the auth wall for /verify-email (the mail's reader has no session)", () => {
    // The matcher decides on the pathname alone; the link's ?token=…&callbackURL=… rides along
    // and is read by the page itself, which forwards it untouched.
    expect(matcherRuns("/verify-email")).toBe(false);
  });

  it("the endpoint the landing page forwards to stays outside the wall too", () => {
    // The page only hands `token` on to this route; if THAT were walled the fix would be half done.
    expect(matcherRuns("/api/better-auth/verify-email")).toBe(false);
  });

  it("opens nothing else: the app behind the door stays walled", async () => {
    expect(matcherRuns("/otto")).toBe(true);
    expect(matcherRuns("/billing")).toBe(true);

    // Proves the wall is live in this env, so the `false` assertions above mean "exempted".
    const res = await proxy(req("/otto"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #793: the dead-letter probe is pulled by an external uptime service, which has no session.
// It answers clear/backed-up/unknown and nothing else, so it joins /api/health outside the wall —
// and the exemption must not quietly become "everything under /api/ops is public".
describe("proxy — dead-letter probe (/api/ops/dlq)", () => {
  it("the matcher does NOT run the auth wall for /api/ops/dlq (the uptime probe has no session)", () => {
    expect(matcherRuns("/api/ops/dlq")).toBe(false);
    // Next normalizes the trailing slash away, but a monitor URL may still carry one.
    expect(matcherRuns("/api/ops/dlq/")).toBe(false);
  });

  it("does not open /api/ops as a public prefix", () => {
    expect(matcherRuns("/api/ops")).toBe(true);
    expect(matcherRuns("/api/ops/queues")).toBe(true);
    expect(matcherRuns("/api/ops/tenants")).toBe(true);
  });

  /**
   * r2 (judge r1 P1): the exemption used to be an UNBOUNDED PREFIX. `/api/ops/dlqx`,
   * `/api/ops/dlq-admin` and `/api/ops/dlq/tenants` all skipped the wall — they 404 today,
   * so nothing leaked, but the next route whose name merely starts the same way would have
   * shipped public with no one deciding that. The exemption is now the exact path.
   */
  it.each([
    "/api/ops/dlqx",
    "/api/ops/dlq-admin",
    "/api/ops/dlq2",
    "/api/ops/dlq/tenants",
    "/api/ops/dlq/purge",
  ])("runs the auth wall for %s — the exemption is one path, not a prefix", (path) => {
    expect(matcherRuns(path)).toBe(true);
  });

  it("a session-less request to a same-prefix path still redirects to /login", async () => {
    const res = await proxy(req("/api/ops/dlq-admin"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("a session-less request to a sibling ops path still redirects to /login", async () => {
    const res = await proxy(req("/api/ops/queues"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});
