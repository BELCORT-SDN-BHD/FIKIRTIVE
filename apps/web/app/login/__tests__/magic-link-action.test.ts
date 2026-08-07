import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendError } from "@/lib/email";

const mockSignInMagicLink = vi.fn();
const mockHeaders = vi.fn();
// Hoisted: the vi.mock factory below is lifted above this file's other statements.
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@/lib/better-auth/server", () => ({
  auth: {
    api: {
      signInMagicLink: mockSignInMagicLink,
    },
  },
}));

// The transport, and only the transport, is stubbed: the per-address cap under test lives in
// sender.ts and stays REAL below.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailPort: { send: mockSend } };
});

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

const { requestMagicLink } = await import("../actions");
const { sendAuthEmail } = await import("@/lib/better-auth/sender");

describe("requestMagicLink", () => {
  beforeEach(() => {
    mockSignInMagicLink.mockReset();
    mockHeaders.mockReset();
    mockSend.mockReset();
    mockSend.mockResolvedValue(undefined);
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

/**
 * #678 — the sign-in door answers the same way whether or not the address has an account.
 *
 * The login page's parity was already real for ONE request; the leak was what happened on the
 * SIXTH. Only an address with access reaches the sender (server.ts's before hook answers
 * everything else with the neutral body first), so only an address with access could ever hit
 * the per-address cap — and the cap used to answer in different words. Six clicks was the whole
 * attack.
 *
 * The suite below drives the action through a stand-in for `auth.api.signInMagicLink` that
 * models BOTH real doors, with the REAL rate limiter behind the "has access" one. On the
 * pre-fix code the sixth allowed request comes back as
 * `{status:"error",reason:"rate_limited",message:"Too many sign-in links requested — try again
 * in an hour."}` while the sixth stranger request is still the neutral success — RED.
 */
describe("#678 — no branch of the sign-in door reveals whether an address has an account", () => {
  const WITH_ACCESS = "w1a-rate@example.test";
  const NO_ACCESS = "ghost@example.test";

  /** server.ts, faithfully: no access → neutral body, no send, no counter; has access → the
   *  magic-link plugin calls sendAuthEmail, which is capped at 5 per address per hour. */
  function realDoors(allowed: Set<string>) {
    return async ({ body }: { body: { email: string; callbackURL: string } }) => {
      if (!allowed.has(body.email)) return { status: true };
      await sendAuthEmail({
        to: body.email,
        subject: "Sign in to Fikirtive",
        url: `https://fikirtive.test/link?e=${encodeURIComponent(body.email)}`,
        intro: "Sign in to Fikirtive",
      });
      return { status: true };
    };
  }

  beforeEach(() => {
    mockSignInMagicLink.mockReset();
    mockSend.mockReset();
    mockSend.mockResolvedValue(undefined);
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers({ origin: "http://localhost:3100" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("six rapid requests read byte-for-byte the same for an address with access and one without", async () => {
    mockSignInMagicLink.mockImplementation(realDoors(new Set([WITH_ACCESS])));

    const press = async (email: string) => {
      const seen: string[] = [];
      for (let i = 0; i < 6; i++) {
        seen.push(JSON.stringify(await requestMagicLink({ email, callbackURL: "/" })));
      }
      return seen;
    };

    const withAccess = await press(WITH_ACCESS);
    const noAccess = await press(NO_ACCESS);

    expect(withAccess).toEqual(noAccess);
    // …and every one of the twelve is the SAME neutral answer, not merely two matching lists.
    expect(new Set([...withAccess, ...noAccess]).size).toBe(1);
    expect(JSON.parse(withAccess[5])).toEqual({
      status: "success",
      message: "If this email has access, a sign-in link is on its way — check your inbox.",
    });
  });

  it("the cap still holds — the 6th request for a real account sends nothing", async () => {
    const capped = "w1a-cap@example.test";
    mockSignInMagicLink.mockImplementation(realDoors(new Set([capped])));

    for (let i = 0; i < 6; i++) await requestMagicLink({ email: capped, callbackURL: "/" });

    // Five delivered, the sixth suppressed: identical COPY, unchanged GATE.
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("a stranger's address never reaches the sender at all", async () => {
    mockSignInMagicLink.mockImplementation(realDoors(new Set([WITH_ACCESS])));

    for (let i = 0; i < 6; i++) await requestMagicLink({ email: NO_ACCESS, callbackURL: "/" });

    expect(mockSend).not.toHaveBeenCalled();
  });

  /**
   * Every outcome `requestMagicLink` can return, and whether a prober could use it to tell the
   * two doors apart. `probeable` = an attacker can make this happen at will by submitting the
   * form; those MUST all be the one neutral answer. The two server-fault rows are not probeable
   * (they need our own email transport to be broken, which no attacker controls from the form)
   * and stay truthful on purpose — hiding a real outage behind "check your inbox" would leave a
   * merchant waiting for a link that is never coming.
   */
  const NEUTRAL = {
    status: "success",
    message: "If this email has access, a sign-in link is on its way — check your inbox.",
  };

  const BRANCHES: Array<{
    name: string;
    probeable: boolean;
    run: () => Promise<unknown>;
    expected: unknown;
  }> = [
    {
      name: "the address has no access — the before hook answers with the neutral body",
      probeable: true,
      run: async () => {
        mockSignInMagicLink.mockImplementation(realDoors(new Set([WITH_ACCESS])));
        return requestMagicLink({ email: NO_ACCESS, callbackURL: "/" });
      },
      expected: NEUTRAL,
    },
    {
      name: "the address has access and the link is sent",
      probeable: true,
      run: async () => {
        mockSignInMagicLink.mockImplementation(realDoors(new Set(["branch-send@example.test"])));
        return requestMagicLink({ email: "branch-send@example.test", callbackURL: "/" });
      },
      expected: NEUTRAL,
    },
    {
      name: "the address has access but is over the per-address cap",
      probeable: true,
      run: async () => {
        mockSignInMagicLink.mockImplementation(realDoors(new Set(["branch-cap@example.test"])));
        for (let i = 0; i < 5; i++) await requestMagicLink({ email: "branch-cap@example.test", callbackURL: "/" });
        return requestMagicLink({ email: "branch-cap@example.test", callbackURL: "/" });
      },
      expected: NEUTRAL,
    },
    {
      name: "the submitted address is not a valid address at all",
      probeable: true,
      run: async () => requestMagicLink({ email: "not-an-email", callbackURL: "/" }),
      // Existence-independent by construction: a pure format check that runs before any
      // lookup, and answers a stranger and an owner identically.
      expected: {
        status: "error",
        reason: "invalid_email",
        message: "Enter a valid email address.",
      },
    },
    {
      name: "our own email transport is down",
      probeable: false,
      run: async () => {
        mockSignInMagicLink.mockRejectedValue(new EmailSendError("detail", "retryable"));
        return requestMagicLink({ email: WITH_ACCESS, callbackURL: "/" });
      },
      expected: {
        status: "error",
        reason: "delivery_failed",
        message: "We couldn't send a sign-in link right now. Try again shortly.",
      },
    },
    {
      name: "an unexpected server fault",
      probeable: false,
      run: async () => {
        mockSignInMagicLink.mockRejectedValue(new Error("detail"));
        return requestMagicLink({ email: WITH_ACCESS, callbackURL: "/" });
      },
      expected: {
        status: "error",
        reason: "unknown",
        message: "We couldn't send a sign-in link. Try again.",
      },
    },
  ];

  it.each(BRANCHES)("branch: $name", async ({ probeable, run, expected }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await run();
    expect(result).toEqual(expected);
    // The rule this ticket installs: anything a prober can trigger from the form reads the
    // same. Only the two rows that need OUR infrastructure to be broken may differ.
    if (probeable && expected !== NEUTRAL) {
      expect(result).toEqual(expected); // invalid_email: same answer for stranger and owner
      expect(await requestMagicLink({ email: "also-not-an-email", callbackURL: "/" })).toEqual(expected);
    }
  });

  it("the action keeps no rate-limit branch for a future edit to lean on", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../actions.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("rate_limited");
    expect(source).not.toContain("Too many sign-in links");
  });
});
