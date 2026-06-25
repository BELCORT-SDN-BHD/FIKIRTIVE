import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { APIError } from "better-auth/api";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db prisma BEFORE importing anything that uses it
// ---------------------------------------------------------------------------
const mockFindUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    betterAuthUser: { findUnique: mockFindUnique },
    allowedEmail: { findUnique: mockFindUnique },
  },
}));

// ---------------------------------------------------------------------------
// Import the helpers AFTER mocks are in place.
// We test the two gate functions that the databaseHooks call:
//   assertAllowedEmail(email)        — used by user.create.before
//   assertAllowedForUserId(userId)   — extracted helper for session.create.before
// Since both ultimately delegate to assertAllowed(email) from server.ts, which
// in turn calls isAllowedEmail() from @/lib/allowlist, we test their behavior
// by importing isAllowedEmail and assertAllowed-equivalent logic directly.
// ---------------------------------------------------------------------------

// We test assertAllowed (the local helper in server.ts) by re-creating it here
// using the real isAllowedEmail from @/lib/allowlist (which is mocked via db above).
const { isAllowedEmail } = await import("@/lib/allowlist");

const ALLOWED_EMAIL = "founder@artlio.test";
const BLOCKED_EMAIL = "stranger@example.com";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.FOUNDER_ADMIN_EMAILS = process.env.FOUNDER_ADMIN_EMAILS;
  savedEnv.AUTH_ALLOWED_EMAILS = process.env.AUTH_ALLOWED_EMAILS;
  process.env.FOUNDER_ADMIN_EMAILS = ALLOWED_EMAIL;
  process.env.AUTH_ALLOWED_EMAILS = "";
  mockFindUnique.mockReset();
});

afterEach(() => {
  process.env.FOUNDER_ADMIN_EMAILS = savedEnv.FOUNDER_ADMIN_EMAILS;
  process.env.AUTH_ALLOWED_EMAILS = savedEnv.AUTH_ALLOWED_EMAILS;
});

// ---------------------------------------------------------------------------
// assertAllowedEmail — mirrors the logic in user.create.before
// ---------------------------------------------------------------------------
async function assertAllowedEmail(email: string | null | undefined): Promise<void> {
  if (!(await isAllowedEmail(email))) {
    throw new APIError("FORBIDDEN", { message: "This email isn't on the allowlist." });
  }
}

// ---------------------------------------------------------------------------
// assertAllowedForUserId — mirrors the logic in session.create.before
// ---------------------------------------------------------------------------
async function assertAllowedForUserId(userId: string): Promise<void> {
  const u = await (await import("@fikirtive/db")).prisma.betterAuthUser.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  await assertAllowedEmail(u?.email);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertAllowedEmail (user.create.before gate)", () => {
  it("resolves without throwing for an allowlisted email", async () => {
    await expect(assertAllowedEmail(ALLOWED_EMAIL)).resolves.toBeUndefined();
    expect(mockFindUnique).not.toHaveBeenCalled(); // founder short-circuits DB
  });

  it("throws APIError FORBIDDEN for a non-allowlisted email", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // not in DB
    await expect(assertAllowedEmail(BLOCKED_EMAIL)).rejects.toBeInstanceOf(APIError);
    const err = await assertAllowedEmail(BLOCKED_EMAIL).catch((e) => e);
    expect(err.status).toBe("FORBIDDEN");
  });

  it("throws for null email", async () => {
    await expect(assertAllowedEmail(null)).rejects.toBeInstanceOf(APIError);
  });

  it("throws for undefined email", async () => {
    await expect(assertAllowedEmail(undefined)).rejects.toBeInstanceOf(APIError);
  });

  it("allows an email in AUTH_ALLOWED_EMAILS env list", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "merchant@artlio.test";
    await expect(assertAllowedEmail("merchant@artlio.test")).resolves.toBeUndefined();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("allows an email with an active DB row", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "active" });
    await expect(assertAllowedEmail("invited@artlio.test")).resolves.toBeUndefined();
  });

  it("throws for an email with a revoked DB row", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    await expect(assertAllowedEmail("revoked@artlio.test")).rejects.toBeInstanceOf(APIError);
  });
});

describe("assertAllowedForUserId (session.create.before gate)", () => {
  it("resolves for an allowlisted userId", async () => {
    // betterAuthUser.findUnique returns the user row
    mockFindUnique.mockResolvedValueOnce({ email: ALLOWED_EMAIL });
    await expect(assertAllowedForUserId("user-123")).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN for a userId whose email is not allowlisted", async () => {
    // DB row exists but email is not in allowlist
    mockFindUnique.mockResolvedValueOnce({ email: BLOCKED_EMAIL }); // betterAuthUser lookup
    mockFindUnique.mockResolvedValueOnce(null); // allowedEmail DB check
    const err = await assertAllowedForUserId("user-456").catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when userId does not resolve to a user row", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // betterAuthUser lookup: no user
    const err = await assertAllowedForUserId("ghost-789").catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe("FORBIDDEN");
  });

  it("throws for a userId whose email was revoked", async () => {
    mockFindUnique.mockResolvedValueOnce({ email: "revoked@artlio.test" }); // betterAuthUser
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" }); // allowedEmail DB check
    await expect(assertAllowedForUserId("user-revoked")).rejects.toBeInstanceOf(APIError);
  });
});
