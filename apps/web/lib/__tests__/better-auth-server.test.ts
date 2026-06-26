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

  it("registers the admin plugin API and keeps getSession", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    expect(typeof auth.api.getSession).toBe("function");
    expect(typeof auth.api.banUser).toBe("function");
    expect(typeof auth.api.listUsers).toBe("function");
    expect(typeof auth.api.impersonateUser).toBe("function");
  });
});
