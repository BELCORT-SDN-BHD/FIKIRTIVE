import { describe, it, expect } from "vitest";
import { publishChainWarning } from "./publish-env-check.js";

const SECRET = "x".repeat(64);

describe("publishChainWarning — L1 publish-chain boot contract (fail-soft)", () => {
  it("is silent when the chain is FULLY configured (ready)", () => {
    expect(
      publishChainWarning({
        MEDIA_PROXY_SECRET: SECRET,
        TOKEN_ENCRYPTION_KEY: SECRET,
        PUBLIC_BASE_URL: "https://app.fikirtive.com",
      }),
    ).toBeNull();
  });

  it("accepts BETTER_AUTH_URL as the base-url fallback (matches publish.ts)", () => {
    expect(
      publishChainWarning({
        MEDIA_PROXY_SECRET: SECRET,
        TOKEN_ENCRYPTION_KEY: SECRET,
        BETTER_AUTH_URL: "https://app.fikirtive.com",
      }),
    ).toBeNull();
  });

  it("is silent when the chain is FULLY absent (inert until App Review — no boot noise)", () => {
    expect(publishChainWarning({})).toBeNull();
  });

  it("WARNS when MEDIA_PROXY_SECRET is the only thing missing (the .env.example-omission scenario)", () => {
    const w = publishChainWarning({
      TOKEN_ENCRYPTION_KEY: SECRET,
      BETTER_AUTH_URL: "https://app.fikirtive.com",
    });
    expect(w).toContain("PARTIALLY configured");
    expect(w).toContain("MEDIA_PROXY_SECRET");
  });

  it("names the missing var but NEVER leaks a secret value", () => {
    const w = publishChainWarning({ MEDIA_PROXY_SECRET: SECRET, PUBLIC_BASE_URL: "https://x" });
    expect(w).toContain("TOKEN_ENCRYPTION_KEY"); // missing
    expect(w).not.toContain(SECRET); // the value of a PRESENT secret must not appear
  });
});
