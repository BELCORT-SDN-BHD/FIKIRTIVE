import { describe, it, expect } from "vitest";

describe("better-auth client", () => {
  it("exposes sign-in code + social + email sign-in", async () => {
    const { authClient } = await import("@/lib/better-auth/client");
    expect(typeof authClient.signIn.emailOtp).toBe("function");
    expect(typeof authClient.signIn.social).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
  });

  /**
   * The magic-link client plugin is gone.
   *
   * ASSERTED ON THE SOURCE, not by poking the object, and the reason is worth writing down: the
   * Better Auth client is a PROXY that turns any property access into a call to the matching
   * path. `authClient.signIn.magicLink` is therefore never `undefined` — reading it happily
   * builds a caller for `/sign-in/magic-link`, whether or not the plugin exists. What actually
   * stops that caller is the server, where the route is unregistered (asserted against the real
   * instance in signin-code-door.test.ts); what stops it being WRITTEN is that the plugin is not
   * registered here.
   */
  it("registers only the email-OTP client plugin", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../better-auth/client.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain("emailOTPClient()");
    expect(source).not.toContain("magicLink");
  });
});
