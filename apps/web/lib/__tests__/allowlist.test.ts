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

const FOUNDER_EMAIL = "founder@fikirtive.test";
const ENV_EMAIL = "merchant@fikirtive.test";
const DB_EMAIL = "invited@fikirtive.test";

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
    expect(isFounderAdmin("FOUNDER@fikirtive.test")).toBe(true); // FOUNDER_ADMIN_EMAILS set in beforeEach
    expect(isFounderAdmin("merchant@fikirtive.test")).toBe(false);
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

  it("returns true for founder email, and still asks the database about revocation", async () => {
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("founder passes even when AUTH_ALLOWED_EMAILS is empty and not in DB", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "";
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(true);
  });

  /**
   * SIGNIN-A7 —— founder 名单也不盖过撤销（第 2 轮判官 P0，与门上那一刀同源）。
   *
   * RED before 第 2 轮：`isAllowedEmail` 的第一行在 founder 命中时 `return true`，库根本不读，
   * 所以一个被撤销的 founder 地址在**每一次请求的再断言**上（`requireSession` / `requireRole`
   * / `requireOwner`）照样答「允许」。破窗锤改由写侧保住：`revokeEmailAccess` 不肯撤一个还挂在
   * `FOUNDER_ADMIN_EMAILS` 上的地址，所以这里不需要例外也锁不住部署者。
   */
  it("SIGNIN-A7 —— founder 名单里的地址被撤销之后照样答 false", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(false);
  });

  /** fail closed 对 founder 也成立：库读不到就是 false，没有「不读库就放行」的捷径。 */
  it("SIGNIN-A7 —— 库读不到时 founder 也答 false（fail closed）", async () => {
    mockFindUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await isAllowedEmail(FOUNDER_EMAIL)).toBe(false);
  });

  // SIGNIN-A7 —— 这两条原本断言「env 命中不读库」。那个短路正是缺陷本身：写在
  // AUTH_ALLOWED_EMAILS 里的地址在读 `AllowedEmail` 之前就被答完，于是撤销它对这条路径毫无
  // 作用 —— 而这条路径正是每个受控动作每次请求都跑的再断言（`requireSession` /
  // `requireRole` / `requireOwner`）。环境名单从此只「加人」，撤销与否由数据库最后拍板。
  // 第 2 轮起 FOUNDER 名单也一样：两个名单都只加人，谁都不盖过撤销（见 `lib/allowlist.ts`）。
  it("returns true for env allowlist email, and still asks the database about revocation", async () => {
    expect(await isAllowedEmail(ENV_EMAIL)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("is case-insensitive for env emails", async () => {
    expect(await isAllowedEmail(ENV_EMAIL.toUpperCase())).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: ENV_EMAIL },
      select: { status: true },
    });
  });

  it("SIGNIN-A7 —— 环境名单里的地址被撤销之后照样答 false（名单只加人，不盖过撤销）", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    expect(await isAllowedEmail(ENV_EMAIL)).toBe(false);
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
    await isAllowedEmail("Invited@Fikirtive.test");
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "invited@fikirtive.test" },
      select: { status: true },
    });
  });
});
