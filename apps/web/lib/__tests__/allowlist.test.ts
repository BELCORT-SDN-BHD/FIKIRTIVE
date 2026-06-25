import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock @fikirtive/db prisma BEFORE importing allowlist
const mockFindUnique = vi.fn();
vi.mock("@fikirtive/db", () => ({
  prisma: {
    allowedEmail: {
      findUnique: mockFindUnique,
    },
  },
}));

// Import AFTER mock is in place
const { isAllowedEmail } = await import("@/lib/allowlist");

const FOUNDER_EMAIL = "founder@artlio.test";
const ENV_EMAIL = "merchant@artlio.test";
const DB_EMAIL = "invited@artlio.test";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save and set env
  savedEnv.FOUNDER_ADMIN_EMAILS = process.env.FOUNDER_ADMIN_EMAILS;
  savedEnv.AUTH_ALLOWED_EMAILS = process.env.AUTH_ALLOWED_EMAILS;
  process.env.FOUNDER_ADMIN_EMAILS = FOUNDER_EMAIL;
  process.env.AUTH_ALLOWED_EMAILS = ENV_EMAIL;
  mockFindUnique.mockReset();
});

afterEach(() => {
  process.env.FOUNDER_ADMIN_EMAILS = savedEnv.FOUNDER_ADMIN_EMAILS;
  process.env.AUTH_ALLOWED_EMAILS = savedEnv.AUTH_ALLOWED_EMAILS;
});

describe("isFounderAdmin", () => {
  it("is true for a founder email (case-insensitive), false otherwise", async () => {
    const { isFounderAdmin } = await import("@/lib/allowlist");
    expect(isFounderAdmin("FOUNDER@artlio.test")).toBe(true); // FOUNDER_ADMIN_EMAILS set in beforeEach
    expect(isFounderAdmin("merchant@artlio.test")).toBe(false);
    expect(isFounderAdmin(null)).toBe(false);
  });
});

describe("isAllowedEmail", () => {
  it("returns false for null email", async () => {
    expect(await isAllowedEmail(null)).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns false for undefined email", async () => {
    expect(await isAllowedEmail(undefined)).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns true for founder email without hitting DB", async () => {
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("founder passes even when AUTH_ALLOWED_EMAILS is empty and not in DB", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "";
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns true for env allowlist email without hitting DB", async () => {
    expect(await isAllowedEmail(ENV_EMAIL)).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("is case-insensitive for env emails", async () => {
    expect(await isAllowedEmail(ENV_EMAIL.toUpperCase())).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns true for DB row with status 'invited'", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "invited" });
    expect(await isAllowedEmail(DB_EMAIL)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("returns true for DB row with status 'active'", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "active" });
    expect(await isAllowedEmail(DB_EMAIL)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("returns false for DB row with status 'revoked'", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    expect(await isAllowedEmail(DB_EMAIL)).toBe(false);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("returns false when no DB row exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await isAllowedEmail(DB_EMAIL)).toBe(false);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("queries DB with lowercased email", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "active" });
    await isAllowedEmail("Invited@Artlio.test");
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "invited@artlio.test" },
      select: { status: true },
    });
  });
});
