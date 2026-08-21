import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  completeMetaConnect: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    redirect: (url: URL | string, init?: { status?: number }) =>
      new Response(null, { status: init?.status ?? 307, headers: { location: String(url) } }),
    json: (body: unknown, init?: { status?: number }) =>
      Response.json(body, { status: init?.status ?? 200 }),
  },
}));
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mocks.requireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/meta-actions", () => ({ completeMetaConnect: mocks.completeMetaConnect }));

const { GET: authorizeGET } = await import("@/app/api/meta/authorize/route");
const { GET: callbackGET } = await import("@/app/api/meta/callback/route");
const { signState, verifyState, META_GRAPH_VERSION } = await import("@/lib/meta-oauth");

function req(url: string) {
  return { url } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = "meta-route-test-secret";
  process.env.BETTER_AUTH_URL = "https://app.test";
  process.env.META_APP_ID = "meta-app-id";
  process.env.META_LOGIN_CONFIG_ID = "meta-login-config-id";
  mocks.requireOwner.mockResolvedValue({ ownerId: "org_meta", email: "owner@example.com" });
  mocks.completeMetaConnect.mockResolvedValue({ ok: true });
});

describe("GET /api/meta/authorize", () => {
  it("redirects unauthenticated users to login without building a Meta URL", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Sign in required." });

    const res = await authorizeGET(req("https://app.test/api/meta/authorize"));

    expect(res.headers.get("location")).toBe("https://app.test/login");
  });

  it("redirects to Connections with not_configured when META_APP_ID is absent", async () => {
    delete process.env.META_APP_ID;

    const res = await authorizeGET(req("https://app.test/api/meta/authorize"));
    const location = new URL(res.headers.get("location")!);

    expect(location.origin).toBe("https://app.test");
    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("error")).toBe("not_configured");
  });

  it("redirects to Connections with not_configured when META_LOGIN_CONFIG_ID is absent", async () => {
    delete process.env.META_LOGIN_CONFIG_ID;

    const res = await authorizeGET(req("https://app.test/api/meta/authorize"));
    const location = new URL(res.headers.get("location")!);

    expect(location.origin).toBe("https://app.test");
    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("error")).toBe("not_configured");
    expect(res.headers.get("location")).not.toContain("facebook.com");
  });

  it("builds a Meta OAuth URL with a signed state for the resolved owner", async () => {
    const res = await authorizeGET(req("https://app.test/api/meta/authorize"));
    const location = new URL(res.headers.get("location")!);

    expect(location.origin).toBe("https://www.facebook.com");
    expect(location.pathname).toBe(`/${META_GRAPH_VERSION}/dialog/oauth`);
    expect(location.searchParams.get("client_id")).toBe("meta-app-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.test/api/meta/callback");
    expect(location.searchParams.get("config_id")).toBe("meta-login-config-id");
    expect(location.searchParams.has("scope")).toBe(false);
    expect(verifyState(location.searchParams.get("state")!)).toEqual({ ownerId: "org_meta" });
  });
});

describe("GET /api/meta/callback", () => {
  it("redirects unauthenticated users to login before reading callback params", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Sign in required." });

    const res = await callbackGET(req("https://app.test/api/meta/callback?code=c&state=s"));

    expect(res.headers.get("location")).toBe("https://app.test/login");
    expect(mocks.completeMetaConnect).not.toHaveBeenCalled();
  });

  it("redirects back with error=missing when code or state is absent", async () => {
    const res = await callbackGET(req("https://app.test/api/meta/callback?code=c"));
    const location = new URL(res.headers.get("location")!);

    expect(location.origin).toBe("https://app.test");
    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("error")).toBe("missing");
    expect(mocks.completeMetaConnect).not.toHaveBeenCalled();
  });

  it("rejects a valid signed state for a different owner", async () => {
    const state = signState("other_org");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=c&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("error")).toBe("state");
    expect(mocks.completeMetaConnect).not.toHaveBeenCalled();
  });

  it("completes the connection with the exact callback redirect URI and returns connected=meta", async () => {
    const state = signState("org_meta");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=auth-code&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    expect(mocks.completeMetaConnect).toHaveBeenCalledWith("auth-code", "https://app.test/api/meta/callback");
    expect(location.origin).toBe("https://app.test");
    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("connected")).toBe("meta");
  });

  it("passes completeMetaConnect errors back to Connections", async () => {
    mocks.completeMetaConnect.mockResolvedValue({ error: "exchange" });
    const state = signState("org_meta");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=auth-code&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    // W2-11:落地地址从旧壳的 /otto?view=connections 换成真路由 SHELL_ROUTES.connections
    // (/settings/connections)——OAuth 回跳语义(error=/connected= 这些 query)没变,只换了
    // 地址本身,回跳逻辑一个字都没碰。
    expect(location.pathname).toBe("/settings/connections");
    expect(location.searchParams.get("error")).toBe("exchange");
  });
});
