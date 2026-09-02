import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "../ForgotPasswordForm";
import { ResetPasswordForm } from "../../reset-password/ResetPasswordForm";

vi.mock("@/lib/better-auth/client", () => ({
  authClient: {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const WEB_ROOT = path.resolve(__dirname, "../../..");

function readWeb(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("auth recovery design system", () => {
  const forgotPage = readWeb("app/forgot-password/page.tsx");
  const forgotForm = readWeb("app/forgot-password/ForgotPasswordForm.tsx");
  const resetPage = readWeb("app/reset-password/page.tsx");
  const resetForm = readWeb("app/reset-password/ResetPasswordForm.tsx");
  const verifyLanding = readWeb("app/verify-email/VerifyEmailLanding.tsx");
  const authShell = readWeb("components/auth/AuthPageShell.tsx");

  it("uses one Fikirtive-owned shell for all public account recovery states", () => {
    for (const source of [forgotPage, resetPage, verifyLanding]) {
      expect(source).toContain("<AuthPageShell");
      expect(source).not.toContain("<main");
      expect(source).not.toContain("<svg");
      expect(source).not.toContain("style={{");
    }

    expect(authShell).toContain("<FikirtiveMark");
    expect(authShell).not.toContain("OttoMark");
    expect(authShell).toContain("bg-background");
  });

  it("composes both recovery forms from shared shadcn controls", () => {
    for (const source of [forgotForm, resetForm]) {
      expect(source).toContain("<AuthStepCard");
      expect(source).toContain("<FieldGroup");
      expect(source).toContain("<Field");
      expect(source).toContain("<FieldLabel");
      expect(source).toContain("<Alert");
      expect(source).toContain("<Spinner");
      expect(source).not.toContain("<label");
      expect(source).not.toContain("<svg");
      expect(source).not.toContain("style={{");
    }

    expect(resetForm).toContain("<PasswordInput");
    expect(resetForm).not.toContain('type="password"');
  });

  it("renders accessible native form contracts through the shared components", () => {
    const forgotMarkup = renderToStaticMarkup(createElement(ForgotPasswordForm));
    const resetMarkup = renderToStaticMarkup(
      createElement(ResetPasswordForm, { token: "one-time-reset-token", from: "/create" }),
    );

    expect(forgotMarkup).toContain('type="email"');
    expect(forgotMarkup).toContain('autoComplete="email"');
    expect(forgotMarkup).toContain("Email me a reset link");
    expect(resetMarkup).toContain('type="password"');
    expect(resetMarkup).toContain('autoComplete="new-password"');
    expect(resetMarkup).toContain("Save new password");
  });

  it("keeps the existing neutral and one-time-link behavior contracts", () => {
    expect(forgotForm).toContain("authClient.requestPasswordReset");
    expect(forgotForm).toContain('redirectTo: authRouteHref("/reset-password", destination)');
    expect(forgotForm).toContain("If <span");
    expect(forgotForm).toContain("has an account");
    expect(resetForm).toContain("authClient.resetPassword({");
    expect(resetForm).toContain("newPassword: password");
    expect(resetForm).toContain("token,");
    expect(verifyLanding).toContain("new URLSearchParams({ token })");
    expect(verifyLanding).toContain('params.set("callbackURL", destination)');
    expect(verifyLanding).toContain("window.location.replace");
  });

  it("uses the shared loading indicator instead of a page-specific spinner", () => {
    expect(verifyLanding).toContain("<Spinner />");
    expect(verifyLanding).not.toContain("LoaderCircle");
    expect(verifyLanding).not.toContain("animate-spin");
  });
});
