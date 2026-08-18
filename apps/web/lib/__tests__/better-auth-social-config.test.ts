/**
 * #681 — an unconfigured Google door must be CLOSED, not merely advertised.
 *
 * The login page offered "Continue with Google" unconditionally while the auth config
 * registered the provider with `process.env.GOOGLE_CLIENT_ID ?? ""`. On an environment
 * with no credentials the click reached a provider that could never complete, and the
 * merchant got HTTP 500 plus a generic "Sign-in failed. Try again."
 *
 * Two halves of one fact are pinned here: the predicate itself, and that the auth config
 * actually obeys it. (The button half is pinned in app/login/__tests__/LoginForm.test.ts.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { googleSignInConfigured } from "@/lib/better-auth/social-config";

describe("googleSignInConfigured", () => {
  it("both credentials present → configured", () => {
    expect(googleSignInConfigured({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toBe(true);
  });

  it("neither present → not configured", () => {
    expect(googleSignInConfigured({})).toBe(false);
  });

  it("half a pair cannot complete a sign-in, so it is not configured", () => {
    expect(googleSignInConfigured({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(googleSignInConfigured({ GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });

  it("blank or whitespace is not a credential", () => {
    expect(googleSignInConfigured({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" })).toBe(false);
    expect(googleSignInConfigured({ GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });
});

// This file deliberately runs with the Google variables UNSET (vitest isolates the module
// registry per file, so the auth config is built here from this environment). The configured
// shape is covered by better-auth-server.test.ts, which sets them before importing.
describe("the auth config obeys the predicate", () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "x".repeat(40);
    process.env.BETTER_AUTH_URL = "http://localhost:3100";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("no credentials → Google is not registered at all (so it cannot 500 mid-handshake)", async () => {
    expect(googleSignInConfigured()).toBe(false);

    const { auth } = await import("@/lib/better-auth/server");
    const ctx = await auth.$context;

    expect(ctx.socialProviders.find((p) => p.id === "google")).toBeUndefined();
  });

  it("closing that door leaves every other sign-in path and guard in place", async () => {
    const { auth } = await import("@/lib/better-auth/server");

    // The email/password and sign-in-code doors are untouched...
    expect(typeof auth.api.signInEmail).toBe("function");
    expect(typeof auth.api.signInEmailOTP).toBe("function");
    expect(typeof auth.api.sendVerificationOTP).toBe("function");
    // ...and so is the operator console the admin plugin backs.
    expect(typeof auth.api.banUser).toBe("function");
  });
});
