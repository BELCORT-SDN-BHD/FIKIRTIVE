import { describe, expect, it } from "vitest";
import { toVerifyLandingUrl } from "@/lib/better-auth/verify-landing-url";

const RAW = "https://app.fikirtive.test/api/better-auth/verify-email?token=eyJhbGciOi.abc.def&callbackURL=%2Fotto";

describe("toVerifyLandingUrl", () => {
  it("points the link at this app's own /verify-email landing page, same origin", () => {
    const parsed = new URL(toVerifyLandingUrl(RAW));

    expect(parsed.origin).toBe("https://app.fikirtive.test");
    expect(parsed.pathname).toBe("/verify-email");
  });

  it("forwards the token byte for byte", () => {
    const parsed = new URL(toVerifyLandingUrl(RAW));

    expect(parsed.searchParams.get("token")).toBe("eyJhbGciOi.abc.def");
  });

  it("forwards callbackURL byte for byte, whatever value the caller set", () => {
    const withQuery =
      "https://app.fikirtive.test/api/better-auth/verify-email?token=t&callbackURL=%2Fotto%3Fview%3Dotto";

    const parsed = new URL(toVerifyLandingUrl(withQuery));

    expect(parsed.searchParams.get("callbackURL")).toBe("/otto?view=otto");
  });

  it("never inspects or drops the token when it is present alongside other params", () => {
    const parsed = new URL(toVerifyLandingUrl(RAW));

    // Exactly the same two params, nothing added or lost.
    expect([...parsed.searchParams.keys()].sort()).toEqual(["callbackURL", "token"]);
  });
});
