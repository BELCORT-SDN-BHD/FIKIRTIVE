import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "../LoginForm";

vi.mock("../actions", () => ({ requestSignInCode: vi.fn() }));
vi.mock("@/lib/better-auth/client", () => ({ authClient: { signIn: { emailOtp: vi.fn() } } }));

describe("R22 LoginForm", () => {
  it("renders the canonical email-first door with no competing password or social surface", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));
    expect(markup).toContain("Sign in to Fikirtive");
    expect(markup).toContain('type="email"');
    expect(markup).toContain("Continue");
    expect(markup).toContain("One email carries both a link and a six-digit code");
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain("Google");
    expect(markup).not.toContain("Forgot your password?");
  });

  it("keeps the different-email path and clears the address-specific code", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");
    const handler = source.match(/function useDifferentEmail\(\) \{([\s\S]*?)\n  \}/)?.[1];
    expect(handler).toContain('setEmail("")');
    expect(handler).toContain('setCode("")');
    expect(handler).toContain("focusEmailAfterReset.current = true");
    expect(handler).toContain("setCodeSent(false)");
    expect(source).toContain("emailInputRef.current?.focus()");
  });

  it("uses six separate numeric OTP cells with paste, auto-advance, and Better Auth verification", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");
    expect(source).toContain("Array.from({ length: SIGN_IN_CODE_LENGTH }");
    expect(source).toContain('inputMode="numeric"');
    expect(source).toContain('autoComplete={index === 0 ? "one-time-code" : "off"}');
    expect(source).toContain("handleCodePaste");
    expect(source).toContain("digitRefs.current[index + 1]?.focus()");
    expect(source).toContain("authClient.signIn.emailOtp({ email: normalizedEmail, otp })");
    expect(source).toContain("window.location.assign(callbackURL)");
  });

  it("keeps account-enumeration copy neutral and reads no browser environment", async () => {
    const [form, page] = await Promise.all([
      readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
      readFile(new URL("../page.tsx", import.meta.url), "utf8"),
    ]);
    expect(`${form}\n${page}`).not.toContain("isn't on the allowlist");
    expect(form).not.toContain("process.env");
    expect(form).not.toContain("NEXT_PUBLIC_");
  });

  it("keeps the real server-side Google capability read without exposing a non-R22 button", async () => {
    const page = await readFile(new URL("../page.tsx", import.meta.url), "utf8");
    expect(page).toContain("googleSignInConfigured");
    expect(page).toContain("googleEnabled={googleSignInConfigured()}");
  });
});
