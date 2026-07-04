import { describe, it, expect, beforeAll } from "vitest";
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});
describe("better-auth server instance", () => {
  it("constructs and exposes the server API", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(typeof auth.handler).toBe("function");
    expect(typeof auth.api.getSession).toBe("function");
  });

  it("registers the admin plugin API", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(typeof auth.api.banUser).toBe("function");
    expect(typeof auth.api.listUsers).toBe("function");
    expect(typeof auth.api.impersonateUser).toBe("function");
  });

  it("configures Google OAuth under the Better Auth callback route", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    const ctx = await auth.$context;
    const provider = ctx.socialProviders.find((p) => p.id === "google");

    expect(ctx.baseURL).toBe("http://localhost:3100/api/better-auth");
    expect(provider?.id).toBe("google");

    const url = await provider?.createAuthorizationURL({
      state: "test-state",
      codeVerifier: "test-code-verifier",
      redirectURI: `${ctx.baseURL}/callback/${provider.id}`,
    });
    expect(url).toBeInstanceOf(URL);
    expect(url?.origin).toBe("https://accounts.google.com");
    expect(url?.searchParams.get("client_id")).toBe("test-client-id");
    expect(url?.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3100/api/better-auth/callback/google",
    );
  });
});
