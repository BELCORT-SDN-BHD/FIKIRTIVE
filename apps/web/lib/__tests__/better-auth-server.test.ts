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

  /**
   * The sign-in-code plugin's configuration, on the pin board.
   *
   * Every line asserted here is a one-line option that fails SILENTLY when it is deleted: the
   * flow keeps working and only the security argument stops being true. `allowedAttempts` gone
   * means a live code can be guessed without limit; `storeOTP` back to its default means the
   * database holds live sign-in codes in the clear; `overrideDefaultEmailVerification` switched
   * on would quietly replace the signup verification LINK (#940/#969's landing page) with a code
   * and leave that page unreachable.
   */
  it("configures the sign-in code as the security argument describes it", async () => {
    const { auth } = await import("@/lib/better-auth/server");
    const { AUTH_EMAIL_CODE_TTL_SECONDS } = await import("@/lib/better-auth/sender");
    const options = auth.options.plugins?.find((p) => p.id === "email-otp")?.options as
      | Record<string, unknown>
      | undefined;

    expect(options).toBeDefined();
    expect(options!.otpLength).toBe(6);
    expect(options!.allowedAttempts).toBe(3);
    expect(options!.storeOTP).toBe("encrypted");
    // ONE source for the lifetime, shared with the queue's capacity arithmetic (#757).
    expect(options!.expiresIn).toBe(AUTH_EMAIL_CODE_TTL_SECONDS);
    // Signup verification stays a link to our own landing page — this plugin owns sign-in only.
    expect(options!.overrideDefaultEmailVerification).toBeFalsy();
    expect(options!.sendVerificationOnSignUp).toBeFalsy();
    expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe("function");
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
