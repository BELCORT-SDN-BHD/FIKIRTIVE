import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../../..");

function readWeb(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("auth design system", () => {
  const loginPage = readWeb("app/login/page.tsx");
  const loginForm = readWeb("app/login/LoginForm.tsx");
  const signupPage = readWeb("app/signup/page.tsx");
  const signupForm = readWeb("app/signup/SignupForm.tsx");
  const authShell = readWeb("components/auth/AuthPageShell.tsx");
  const authStepCard = readWeb("components/auth/AuthStepCard.tsx");
  const reviewFixture = readWeb("design-system/patterns/auth/AuthAccessJourneyReference.tsx");

  it("uses one Fikirtive-owned shell and one step card across fixture and production", () => {
    expect(authShell).toContain("<FikirtiveMark");
    expect(authShell).toContain("fikirtive");
    expect(authShell).not.toContain("OttoMark");
    expect(authStepCard).toContain("<Card");

    for (const source of [loginPage, signupPage]) {
      expect(source).toContain("<AuthPageShell>");
      expect(source).not.toContain("<main");
      expect(source).not.toContain("<svg");
    }
    expect(reviewFixture).toContain('AuthStepCard as StepCard');
    expect(reviewFixture).toContain("<AuthPageShell>");
  });

  it("composes production forms from canonical controls", () => {
    for (const source of [loginForm, signupForm]) {
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

    expect(loginForm).toContain("<FieldSeparator>or</FieldSeparator>");
    expect(loginForm).toContain("<InputOTP");
    expect(loginForm).toContain("<InputOTPGroup>");
    expect(loginForm).toContain("<InputOTPSlot");
    expect(signupForm).toContain("<PasswordInput");
  });

  it("keeps the OTP primitive aligned with the light-only design system", () => {
    const inputOtp = readWeb("components/ui/input-otp.tsx");

    expect(inputOtp).toContain("size-9");
    expect(inputOtp).not.toContain("dark:");
  });

  it("keeps signup refusal copy existence-neutral", () => {
    expect(signupForm).toContain('setError("We couldn\'t create the account. Try again.")');
    expect(signupForm).not.toContain("signUpError.message");
  });
});
