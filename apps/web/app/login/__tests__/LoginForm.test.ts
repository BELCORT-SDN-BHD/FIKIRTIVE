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
    const markup = renderToStaticMarkup(createElement(LoginForm, { from: "/" }));

    expect(markup).toContain('type="email"');
    expect(markup).toContain("required");
    expect(markup).toContain("Email me a sign-in link");
    expect(markup).not.toContain("Forgot?");
    expect(markup).not.toContain("Email me a magic link");
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
});
