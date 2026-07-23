import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendError } from "@/lib/email";
import { MagicLinkRateLimitError } from "@/lib/better-auth/sender";

const mockSignInMagicLink = vi.fn();
const mockHeaders = vi.fn();

vi.mock("@/lib/better-auth/server", () => ({
  auth: {
    api: {
      signInMagicLink: mockSignInMagicLink,
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

const { requestMagicLink } = await import("../actions");

describe("requestMagicLink", () => {
  beforeEach(() => {
    mockSignInMagicLink.mockReset();
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers({ origin: "http://localhost:3100" }));
  });

  it("rejects an invalid email with a format error before allowlist lookup or send", async () => {
    await expect(
      requestMagicLink({ email: "not-an-email", callbackURL: "/" }),
    ).resolves.toEqual({
      status: "error",
      reason: "invalid_email",
      message: "Enter a valid email address.",
    });

    expect(mockSignInMagicLink).not.toHaveBeenCalled();
  });

  it("returns the identical neutral success shape for allowed and non-allowlisted emails", async () => {
    mockSignInMagicLink.mockResolvedValue({ status: true });

    const blocked = await requestMagicLink({
      email: "stranger@example.com",
      callbackURL: "/campaign?tab=plan",
    });
    const allowed = await requestMagicLink({
      email: "owner@example.com",
      callbackURL: "/campaign?tab=plan",
    });

    expect(blocked).toEqual(allowed);
    expect(blocked).toEqual({
      status: "success",
      message: "If this email has access, a sign-in link is on its way — check your inbox.",
    });
    expect(mockSignInMagicLink).toHaveBeenCalledTimes(2);
    expect(mockSignInMagicLink).toHaveBeenLastCalledWith({
      body: {
        email: "owner@example.com",
        callbackURL: "/campaign?tab=plan",
      },
      headers: expect.any(Headers),
    });
  });

  it("surfaces the exact rate-limit message for an allowed email", async () => {
    mockSignInMagicLink.mockRejectedValueOnce(new MagicLinkRateLimitError());

    await expect(
      requestMagicLink({ email: "owner@example.com", callbackURL: "/" }),
    ).resolves.toEqual({
      status: "error",
      reason: "rate_limited",
      message: "Too many sign-in links requested — try again in an hour.",
    });
  });

  it("returns a typed, provider-neutral delivery failure", async () => {
    mockSignInMagicLink.mockRejectedValueOnce(
      new EmailSendError("transport detail", "retryable"),
    );

    await expect(
      requestMagicLink({ email: "owner@example.com", callbackURL: "/" }),
    ).resolves.toEqual({
      status: "error",
      reason: "delivery_failed",
      message: "We couldn't send a sign-in link right now. Try again shortly.",
    });
  });

  it("returns a typed truthful fallback for unknown send failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignInMagicLink.mockRejectedValueOnce(new Error("unexpected detail"));

    await expect(
      requestMagicLink({ email: "owner@example.com", callbackURL: "/" }),
    ).resolves.toEqual({
      status: "error",
      reason: "unknown",
      message: "We couldn't send a sign-in link. Try again.",
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
