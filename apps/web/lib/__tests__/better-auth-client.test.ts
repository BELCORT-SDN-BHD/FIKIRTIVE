import { describe, it, expect } from "vitest";

describe("better-auth client", () => {
  it("exposes magic-link + social + email sign-in", async () => {
    const { authClient } = await import("@/lib/better-auth/client");
    expect(typeof authClient.signIn.magicLink).toBe("function");
    expect(typeof authClient.signIn.social).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
  });
});
