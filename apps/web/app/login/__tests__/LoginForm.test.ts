import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "../LoginForm";

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
  it("renders client-validatable email controls with honest sign-in-code labels", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));

    expect(markup).toContain('type="email"');
    expect(markup).toContain("required");
    expect(markup).toContain("Email me a sign-in code");
    expect(markup).not.toContain("Email me a magic link");
    expect(markup).not.toContain("sign-in link");
  });

  /**
   * The page used to offer the passwordless door TWICE — a link beside the Password label and a
   * button under the divider — for one flow. Two controls for one action is two things to keep in
   * step and one more place for the copy to drift, so exactly one survives, and it sits with the
   * other alternative doors under the divider where Google already lives.
   */
  it("offers the passwordless door exactly once", async () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));

    expect(markup.split("Email me a sign-in code")).toHaveLength(2); // one occurrence
  });

  it("offers password recovery only because the reset flow now exists (#543)", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));

    expect(markup).toContain("Forgot your password?");
    expect(markup).toContain('href="/forgot-password"');
  });

  it("wires Use a different email to clear the address and focus the remounted input", async () => {
    // apps/web intentionally has no DOM component harness. Follow the existing component-wiring
    // convention by checking the component source that owns this event, alongside the SSR smoke.
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");
    const handler = source.match(
      /function useDifferentEmail\(\) \{([\s\S]*?)\n  \}/,
    )?.[1];

    expect(handler).toBeDefined();
    expect(handler).toContain('setEmail("")');
    expect(handler).toContain('setPassword("")');
    // The typed code belongs to the address that was left behind — carrying it forward would put
    // a dead value in the box for the next merchant to wonder about.
    expect(handler).toContain('setCode("")');
    expect(handler).toContain("focusEmailAfterReset.current = true");
    expect(handler).toContain("setCodeSent(false)");
    expect(source).toContain("emailInputRef.current?.focus()");
    expect(source).toContain("ref={emailInputRef}");
  });

  /**
   * The second step. It is a source check for the same reason as the case above (no DOM harness),
   * and what it pins is the part a merchant feels: a numeric box the phone keyboard and the
   * one-time-code autofill both recognise, capped at the real code length, and a verify call that
   * goes to Better Auth's code door rather than anywhere else.
   */
  it("takes the code on the page itself, in a box built for six digits", async () => {
    const source = await readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8");

    expect(source).toContain('inputMode="numeric"');
    expect(source).toContain('autoComplete="one-time-code"');
    expect(source).toContain("maxLength={SIGN_IN_CODE_LENGTH}");
    // Digits only, so a pasted code with spaces around it is not submitted as-is and refused for
    // a reason the merchant cannot see.
    expect(source).toContain('replace(/\\D/g, "")');
    expect(source).toContain("authClient.signIn.emailOtp({ email: normalizedEmail, otp })");
    // The redirect is the page's own, exactly as on the password path — a code carries no
    // destination, so nothing about `from` is ever mailed.
    expect(source).toContain("window.location.assign(callbackURL)");
  });

  it("does not keep explicit allowlist-membership copy on the login surface", async () => {
    const [form, page] = await Promise.all([
      readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
      readFile(new URL("../page.tsx", import.meta.url), "utf8"),
    ]);

    expect(`${form}\n${page}`).not.toContain("isn't on the allowlist");
  });

  // #681 — the button used to render whether or not Google was configured. Clicking it on an
  // environment with no credentials produced a 500 and a generic "Sign-in failed. Try again.",
  // so the merchant retried a road that does not exist.
  describe("the Google door is only offered when it exists (#681)", () => {
    it("credentials configured → the button is there, unchanged", () => {
      const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));

      expect(markup).toContain("Continue with Google");
    });

    it("credentials missing → no button at all, and the other doors stay open", () => {
      const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: false }));

      expect(markup).not.toContain("Continue with Google");
      expect(markup).not.toContain("Google");
      // Removing one door must not remove the others.
      expect(markup).toContain("Email me a sign-in code");
      expect(markup).toContain('type="email"');
      expect(markup).toContain("Sign in");
    });

    it("the answer comes from the server, never from a client-side env guess", async () => {
      const [form, page] = await Promise.all([
        readFile(new URL("../LoginForm.tsx", import.meta.url), "utf8"),
        readFile(new URL("../page.tsx", import.meta.url), "utf8"),
      ]);

      // The client component reads no environment at all — it is told.
      expect(form).not.toContain("process.env");
      expect(form).not.toContain("NEXT_PUBLIC_");
      expect(form).toContain("googleEnabled");
      // The server component asks the one shared predicate, the same one the auth config uses.
      expect(page).toContain("googleSignInConfigured");
      expect(page).toContain("googleEnabled={googleSignInConfigured()}");
    });
  });
});
