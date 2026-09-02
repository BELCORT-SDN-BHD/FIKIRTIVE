import { describe, expect, it } from "vitest";

import {
  authDestination,
  authRouteHref,
  loginStepHref,
  parseLoginStep,
} from "@/lib/auth-journey";

describe("Auth journey routing", () => {
  it("sanitizes one destination for every Auth route", () => {
    expect(authDestination("/create?canvas=one")).toBe("/create?canvas=one");
    expect(authDestination("https://evil.example")).toBe("/");
    expect(authRouteHref("/signup", "/create")).toBe("/signup?from=%2Fcreate");
    expect(authRouteHref("/forgot-password", "//evil.example")).toBe("/forgot-password");
  });

  it("keeps login steps in browser history without duplicating the default destination", () => {
    expect(loginStepHref("hub", "/")).toBe("/login");
    expect(loginStepHref("email", "/create")).toBe("/login?step=email&from=%2Fcreate");
    expect(loginStepHref("password", "javascript:alert(1)")).toBe("/login?step=password");
  });

  it("accepts only production login steps", () => {
    expect(parseLoginStep("email")).toBe("email");
    expect(parseLoginStep("code")).toBe("code");
    expect(parseLoginStep("password")).toBe("password");
    expect(parseLoginStep("provider")).toBe("hub");
    expect(parseLoginStep(undefined)).toBe("hub");
  });
});
