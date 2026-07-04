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
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
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
    expect(location.pathname).toBe("/otto");
    expect(location.searchParams.get("view")).toBe("connections");
    expect(location.searchParams.get("error")).toBe("not_configured");
  });

  it("builds a Meta OAuth URL with a signed state for the resolved owner", async () => {
    const res = await authorizeGET(req("https://app.test/api/meta/authorize"));
    const location = new URL(res.headers.get("location")!);

    expect(location.origin).toBe("https://www.facebook.com");
    expect(location.pathname).toBe(`/${META_GRAPH_VERSION}/dialog/oauth`);
    expect(location.searchParams.get("client_id")).toBe("meta-app-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.test/api/meta/callback");
    expect(location.searchParams.get("scope")).toContain("ads_management");
    expect(location.searchParams.get("scope")).toContain("pages_show_list");
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
    expect(location.pathname).toBe("/otto");
    expect(location.searchParams.get("view")).toBe("connections");
    expect(location.searchParams.get("error")).toBe("missing");
    expect(mocks.completeMetaConnect).not.toHaveBeenCalled();
  });

  it("rejects a valid signed state for a different owner", async () => {
    const state = signState("other_org");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=c&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    expect(location.pathname).toBe("/otto");
    expect(location.searchParams.get("view")).toBe("connections");
    expect(location.searchParams.get("error")).toBe("state");
    expect(mocks.completeMetaConnect).not.toHaveBeenCalled();
  });

  it("completes the connection with the exact callback redirect URI and returns connected=meta", async () => {
    const state = signState("org_meta");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=auth-code&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    expect(mocks.completeMetaConnect).toHaveBeenCalledWith("auth-code", "https://app.test/api/meta/callback");
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/otto");
    expect(location.searchParams.get("view")).toBe("connections");
    expect(location.searchParams.get("connected")).toBe("meta");
  });

  it("passes completeMetaConnect errors back to Connections", async () => {
    mocks.completeMetaConnect.mockResolvedValue({ error: "exchange" });
    const state = signState("org_meta");

    const res = await callbackGET(req(`https://app.test/api/meta/callback?code=auth-code&state=${encodeURIComponent(state)}`));
    const location = new URL(res.headers.get("location")!);

    expect(location.pathname).toBe("/otto");
    expect(location.searchParams.get("view")).toBe("connections");
    expect(location.searchParams.get("error")).toBe("exchange");
  });
});
