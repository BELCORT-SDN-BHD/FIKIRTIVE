import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "../LoginForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../actions", () => ({
  requestSignInCode: vi.fn(),
}));

vi.mock("@/lib/better-auth/client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
      emailOtp: vi.fn(),
      social: vi.fn(),
    },
  },
}));

describe("LoginForm", () => {
  it("starts with the approved minimal login hub", () => {
    const markup = renderToStaticMarkup(
      createElement(LoginForm, { from: "/create", googleEnabled: true }),
    );

    expect(markup).toContain("Log in to Fikirtive");
    expect(markup).toContain("Continue with email");
    expect(markup).toContain("Continue with Google");
    expect(markup).toContain("Create an account");
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('type="email"');
  });

  it("renders email as its own step with code first and password second", () => {
    const markup = renderToStaticMarkup(
      createElement(LoginForm, {
        from: "/create",
        googleEnabled: true,
        initialStep: "email",
      }),
    );

    expect(markup).toContain("your email address?");
    expect(markup).toContain('type="email"');
    expect(markup).toContain("required");
    expect(markup).toContain("Continue with email");
    expect(markup).toContain("Use password instead");
    expect(markup).not.toContain('type="password"');
  });

  it("keeps password recovery and destination in the password branch", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");

    expect(source).toContain('authRouteHref("/forgot-password", callbackURL)');
    expect(source).toContain("Forgot password?");
    expect(source).toContain("authClient.signIn.email");
    expect(source).toContain("window.location.assign(callbackURL)");
  });

  it("clears address-bound values before returning to the email step", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");
    const handler = source.match(/function useDifferentEmail\(\) \{([\s\S]*?)\n  \}/)?.[1];

    expect(handler).toBeDefined();
    expect(handler).toContain('setEmail("")');
    expect(handler).toContain('setPassword("")');
    expect(handler).toContain('setCode("")');
    expect(handler).toContain("focusEmailAfterReset.current = true");
    expect(handler).toContain('go("email")');
    expect(source).toContain("emailInputRef.current?.focus()");
  });

  it("uses the accessible six-digit Better Auth code path", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");

    expect(source).toContain('inputMode="numeric"');
    expect(source).toContain('autoComplete="one-time-code"');
    expect(source).toContain("maxLength={SIGN_IN_CODE_LENGTH}");
    expect(source).toContain('replace(/\\D/g, "")');
    expect(source).toContain("authClient.signIn.emailOtp({ email: normalizedEmail, otp })");
    expect(source).toContain("window.location.assign(callbackURL)");
  });

  it("never keeps explicit allowlist-membership copy on the surface", async () => {
    const [form, page] = await Promise.all([
      readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
      readFile(new URL("../page.tsx", import.meta.url), "utf8"),
    ]);

    expect(`${form}\n${page}`).not.toContain("isn't on the allowlist");
  });

  describe("the Google door follows server capability", () => {
    it("renders when configured", () => {
      const markup = renderToStaticMarkup(
        createElement(LoginForm, { from: "/", googleEnabled: true }),
      );
      expect(markup).toContain("Continue with Google");
    });

    it("disappears completely when missing", () => {
      const markup = renderToStaticMarkup(
        createElement(LoginForm, { from: "/", googleEnabled: false }),
      );
      expect(markup).not.toContain("Continue with Google");
      expect(markup).not.toContain(">G<");
      expect(markup).toContain("Continue with email");
    });

    it("is decided by the shared server predicate", async () => {
      const [form, page] = await Promise.all([
        readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
        readFile(new URL("../page.tsx", import.meta.url), "utf8"),
      ]);

      expect(form).not.toContain("process.env");
      expect(form).not.toContain("NEXT_PUBLIC_");
      expect(page).toContain("googleSignInConfigured");
      expect(page).toContain("googleEnabled={googleSignInConfigured()}");
    });
  });
});
