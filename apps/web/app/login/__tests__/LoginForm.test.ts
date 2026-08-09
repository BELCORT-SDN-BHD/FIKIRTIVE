import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "../LoginForm";

vi.mock("../actions", () => ({
  requestMagicLink: vi.fn(),
}));

vi.mock("@/lib/better-auth/client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
    },
  },
}));

describe("LoginForm", () => {
  it("renders client-validatable email controls with honest sign-in-link labels", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/", googleEnabled: true }));

    expect(markup).toContain('type="email"');
    expect(markup).toContain("required");
    expect(markup).toContain("Email me a sign-in link");
    expect(markup).not.toContain("Email me a magic link");
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
    expect(handler).toContain("focusEmailAfterReset.current = true");
    expect(handler).toContain("setSent(false)");
    expect(source).toContain("emailInputRef.current?.focus()");
    expect(source).toContain("ref={emailInputRef}");
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
      expect(markup).toContain("Email me a sign-in link");
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
