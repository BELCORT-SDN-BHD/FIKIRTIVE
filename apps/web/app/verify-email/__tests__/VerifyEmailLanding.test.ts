import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifyEmailLanding } from "../VerifyEmailLanding";

describe("VerifyEmailLanding", () => {
  it("renders the signing-in state on first paint when a token is present (#940)", () => {
    const markup = renderToStaticMarkup(
      createElement(VerifyEmailLanding, { token: "eyJhbGciOi.abc.def", callbackURL: "/otto" }),
    );

    expect(markup).toContain("Signing you in");
    // The spinner is visible, not decorative-only-in-CSS-that-might-not-load.
    expect(markup).toContain("animate-spin");
    expect(markup).toContain('role="status"');
  });

  it("does not render an error state while a token is present", () => {
    const markup = renderToStaticMarkup(
      createElement(VerifyEmailLanding, { token: "eyJhbGciOi.abc.def", callbackURL: "/otto" }),
    );

    expect(markup).not.toContain("This link no longer works");
  });

  it("falls back to an honest broken-link message when there is no token to forward", () => {
    const markup = renderToStaticMarkup(createElement(VerifyEmailLanding, {}));

    expect(markup).toContain("This link no longer works");
    expect(markup).toContain('href="/login"');
    expect(markup).not.toContain("Signing you in");
  });
});
