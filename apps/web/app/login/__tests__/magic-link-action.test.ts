import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendError } from "@/lib/email";

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

const NEUTRAL = {
  status: "success",
  message: "If this email has access, a sign-in link is on its way — check your inbox.",
};

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
    expect(blocked).toEqual(NEUTRAL);
    expect(mockSignInMagicLink).toHaveBeenCalledTimes(2);
    expect(mockSignInMagicLink).toHaveBeenLastCalledWith({
      body: {
        email: "owner@example.com",
        callbackURL: "/campaign?tab=plan",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns a typed truthful fallback for a genuine server fault", async () => {
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

/**
 * #678 — every outcome this action can return, and whether it tells a prober anything.
 *
 * The end-to-end proof — real Better Auth, real database, real dispatch — lives in
 * lib/__tests__/auth-enumeration-structural.test.ts, which pins the four structural properties
 * the review demanded (the answer does not wait on delivery; both doors await the same steps;
 * a broken mail provider is invisible to the merchant; the password door reaches Better Auth's
 * dummy hash). What this file pins is narrower and complementary: the CONTRACT this action is
 * allowed to express at all.
 */
describe("#678 — the action's whole answer vocabulary is existence-independent", () => {
  beforeEach(() => {
    mockSignInMagicLink.mockReset();
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers({ origin: "http://localhost:3100" }));
  });

  const BRANCHES: Array<{ name: string; door: () => void; expected: unknown }> = [
    {
      name: "the endpoint accepted the request (any address — the doors are the same endpoint now)",
      door: () => mockSignInMagicLink.mockResolvedValue({ status: true }),
      expected: NEUTRAL,
    },
    {
      name: "the submitted address is not a valid address at all",
      door: () => mockSignInMagicLink.mockResolvedValue({ status: true }),
      expected: {
        status: "error",
        reason: "invalid_email",
        message: "Enter a valid email address.",
      },
    },
    {
      name: "a genuine server fault (database down, Better Auth internal, the per-IP cap)",
      door: () => mockSignInMagicLink.mockRejectedValue(new Error("detail")),
      expected: {
        status: "error",
        reason: "unknown",
        message: "We couldn't send a sign-in link. Try again.",
      },
    },
    {
      name: "a transport error somehow surfacing on this path",
      door: () => mockSignInMagicLink.mockRejectedValue(new EmailSendError("detail", "retryable")),
      // Deliberately NOT a distinct answer any more: delivery is off the request path, so if a
      // transport error ever reappears here it is a server fault like any other.
      expected: {
        status: "error",
        reason: "unknown",
        message: "We couldn't send a sign-in link. Try again.",
      },
    },
  ];

  it.each(BRANCHES)("branch: $name", async ({ name, door, expected }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    door();
    const email = name.includes("not a valid address") ? "not-an-email" : "owner@example.com";
    expect(await requestMagicLink({ email, callbackURL: "/" })).toEqual(expected);
  });

  it("keeps no rate-limit or delivery branch for a future edit to lean on", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../actions.ts", import.meta.url), "utf8"),
    );
    for (const forbidden of ["rate_limited", "delivery_failed", "Too many sign-in links", "EmailSendError"]) {
      expect(source, `login/actions.ts must not branch on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the contract itself offers only existence-independent reasons", async () => {
    const contract = await import("@/lib/better-auth/magic-link-contract");
    expect(Object.keys(contract).sort()).toEqual([
      "MAGIC_LINK_INVALID_EMAIL_MESSAGE",
      "MAGIC_LINK_SUCCESS_MESSAGE",
      "MAGIC_LINK_UNKNOWN_FAILED_MESSAGE",
      "normalizeMagicLinkEmail",
    ]);
  });
});
