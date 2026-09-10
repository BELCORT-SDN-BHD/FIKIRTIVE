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
    expect(loginStepHref("code", "javascript:alert(1)")).toBe("/login?step=code");
  });

  it("accepts only production login steps", () => {
    expect(parseLoginStep("email")).toBe("email");
    expect(parseLoginStep("code")).toBe("code");
    // SIGNIN-A4 —— 密码那一步退役了，旧链接 `?step=password` 归 hub，不再是一个可进的步骤。
    expect(parseLoginStep("password")).toBe("hub");
    expect(parseLoginStep("provider")).toBe("hub");
    expect(parseLoginStep(undefined)).toBe("hub");
  });
});
