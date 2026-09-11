/**
 * 门的三步判定（docs/specs/sign-in.md 已冻结 · v1 §1.6），在 Better Auth 的两个钩子上。
 *
 * 这个文件以前叫「allowlist gate」，断言的是「不在名单一律拒」。规格把口径收窄成
 * 「未撤销＋未暂停即放行」，所以这里断言的东西整个换了一面：**陌生邮箱现在必须放行**
 * （SIGNIN-A1 的前提），撤销与暂停期陌生人仍然绝对拒绝（A6/A7 由它们自己的切片验收，这里只钉
 * 判定函数本身）。
 */
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
// Import the REAL gate functions AFTER mocks are in place.
// ---------------------------------------------------------------------------
const { assertSignInDoor, assertSignInDoorForUserId } = await import("@/lib/better-auth/gate");

const ALLOWED_EMAIL = "founder@fikirtive.test";
const STRANGER_EMAIL = "stranger@example.com";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.FOUNDER_ADMIN_EMAILS = process.env.FOUNDER_ADMIN_EMAILS;
  savedEnv.AUTH_ALLOWED_EMAILS = process.env.AUTH_ALLOWED_EMAILS;
  savedEnv.SIGNUPS_PAUSED = process.env.SIGNUPS_PAUSED;
  process.env.FOUNDER_ADMIN_EMAILS = ALLOWED_EMAIL;
  process.env.AUTH_ALLOWED_EMAILS = "";
  delete process.env.SIGNUPS_PAUSED;
  mockFindUnique.mockReset();
});

afterEach(() => {
  process.env.FOUNDER_ADMIN_EMAILS = savedEnv.FOUNDER_ADMIN_EMAILS;
  process.env.AUTH_ALLOWED_EMAILS = savedEnv.AUTH_ALLOWED_EMAILS;
  if (savedEnv.SIGNUPS_PAUSED === undefined) delete process.env.SIGNUPS_PAUSED;
  else process.env.SIGNUPS_PAUSED = savedEnv.SIGNUPS_PAUSED;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertSignInDoor (user.create.before gate)", () => {
  it("resolves without throwing for an allowlisted email", async () => {
    await expect(assertSignInDoor(ALLOWED_EMAIL)).resolves.toBeUndefined();
    expect(mockFindUnique).not.toHaveBeenCalled(); // founder short-circuits DB
  });

  /**
   * SIGNIN-A1 —— 「陌生邮箱走码门直接进产品且建号」的**门这一侧**。
   *
   * RED 在这次改动之前：那时这里断言的正好相反（`rejects.toBeInstanceOf(APIError)`），因为门问
   * 的是「在不在名单里」。规格 §1.6 把它换成三步判定之后，一个从没出现过的地址在开关没打开、
   * 没有撤销行的情况下必须放行 —— 否则码门验完码也建不出账号。
   */
  it("SIGNIN-A1 —— 一个从未出现过的邮箱：没有暂停、没有撤销，门放行（建账号的前提）", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // AllowedEmail 里没有这一行
    await expect(assertSignInDoor(STRANGER_EMAIL)).resolves.toBeUndefined();
  });

  it("throws for null email", async () => {
    await expect(assertSignInDoor(null)).rejects.toBeInstanceOf(APIError);
  });

  it("throws for undefined email", async () => {
    await expect(assertSignInDoor(undefined)).rejects.toBeInstanceOf(APIError);
  });

  it("allows an email in AUTH_ALLOWED_EMAILS env list", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "merchant@fikirtive.test";
    mockFindUnique.mockResolvedValueOnce(null); // 名单里点了名，但库里还没有他那一行
    await expect(assertSignInDoor("merchant@fikirtive.test")).resolves.toBeUndefined();
    // 库照读 —— 环境名单回答的是「他算不算老人」，不是「他不可撤」（见下一条）。
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  /**
   * SIGNIN-A7 —— 撤销是绝对的：`AUTH_ALLOWED_EMAILS` 也压不过它（判官 r1 P1，2026-09-11）。
   *
   * RED before：命中 `AUTH_ALLOWED_EMAILS` 的地址**直接短路返回放行**，一次数据库读都不做，
   * 于是操作员在后台撤销过的邮箱只要还留在那份环境名单里就照样进得来 —— 规格 §1.6「撤销 →
   * 拒」与验收 A7「两扇门都进不来」在这条路上从来没有执行过。环境名单能回答的问题只有
   * 「这个地址来过吗」（暂停开关那一步要用），回答不了「它有没有被撤销」——那件事只写在库里。
   */
  it("SIGNIN-A7 —— 撤销压得过 AUTH_ALLOWED_EMAILS：环境名单里的地址被撤销后仍然进不来", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "revoked-but-listed@fikirtive.test";
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    const err = await assertSignInDoor("revoked-but-listed@fikirtive.test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
    // 撤销这件事只有库知道 —— 所以这条路上必须真的去问库。
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "revoked-but-listed@fikirtive.test" } }),
    );
  });

  /** 环境名单仍然管它该管的那一件事：暂停期里，名单点名的地址算「来过」，照常进得来。 */
  it("SIGNIN-A7 —— 环境名单仍然让暂停期的老地址进得来（它答的是「来过吗」，不是「撤了吗」）", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    process.env.AUTH_ALLOWED_EMAILS = "listed@fikirtive.test";
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(assertSignInDoor("listed@fikirtive.test")).resolves.toBeUndefined();
  });

  /** FOUNDER_ADMIN_EMAILS 是破窗锤，仍然先于数据库 —— 一行记录不该把部署者锁在产品外面。 */
  it("keeps the founder break-glass ahead of the database", async () => {
    await expect(assertSignInDoor(ALLOWED_EMAIL)).resolves.toBeUndefined();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("allows an email with an active DB row", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "active" });
    await expect(assertSignInDoor("invited@fikirtive.test")).resolves.toBeUndefined();
  });

  it("throws for an email with a revoked DB row", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    const err = await assertSignInDoor("revoked@fikirtive.test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
  });

  /** 撤销是绝对的：暂停开关的状态改变不了它，反之亦然。 */
  it("throws for a revoked row even while signups are paused", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    await expect(assertSignInDoor("revoked@fikirtive.test")).rejects.toBeInstanceOf(APIError);
  });

  it("throws for a never-seen email while signups are paused, and still admits a known one", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    mockFindUnique.mockResolvedValueOnce(null); // 从未登录过
    await expect(assertSignInDoor(STRANGER_EMAIL)).rejects.toBeInstanceOf(APIError);
    mockFindUnique.mockResolvedValueOnce({ status: "active" }); // 老商家
    await expect(assertSignInDoor("regular@fikirtive.test")).resolves.toBeUndefined();
  });

  /** fail closed：计数器/库读不到就当拒绝，不当放行。 */
  it("throws when the AllowedEmail lookup itself fails", async () => {
    mockFindUnique.mockRejectedValueOnce(new Error("db down"));
    await expect(assertSignInDoor(STRANGER_EMAIL)).rejects.toBeInstanceOf(APIError);
  });

  /** SIGNIN-A16 —— 判定之前归一化：撤销写在小写那一行，大小写变体不许绕过去。 */
  it("SIGNIN-A16 —— 判定前先 trim+lowercase，所以大小写变体读的是同一行", async () => {
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" });
    await expect(assertSignInDoor("  Revoked@Fikirtive.TEST ")).rejects.toBeInstanceOf(APIError);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "revoked@fikirtive.test" } }),
    );
  });
});

describe("assertSignInDoorForUserId (session.create.before gate)", () => {
  it("resolves for an allowlisted userId", async () => {
    // betterAuthUser.findUnique returns the user row
    mockFindUnique.mockResolvedValueOnce({ email: ALLOWED_EMAIL });
    await expect(assertSignInDoorForUserId("user-123")).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN when userId does not resolve to a user row", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // betterAuthUser lookup: no user
    const err = await assertSignInDoorForUserId("ghost-789").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
  });

  it("throws for a userId whose email was revoked", async () => {
    mockFindUnique.mockResolvedValueOnce({ email: "revoked@fikirtive.test" }); // betterAuthUser
    mockFindUnique.mockResolvedValueOnce({ status: "revoked" }); // allowedEmail DB check
    await expect(assertSignInDoorForUserId("user-revoked")).rejects.toBeInstanceOf(APIError);
  });

  /** 重复登录：一个自助进来、名单里有 active 行的老商家，会话闸不该再拦他。 */
  it("resolves for a self-service account on its repeat sign-in", async () => {
    mockFindUnique.mockResolvedValueOnce({ email: "selfserve@fikirtive.test" }); // betterAuthUser
    mockFindUnique.mockResolvedValueOnce({ status: "active" }); // allowedEmail
    await expect(assertSignInDoorForUserId("user-self")).resolves.toBeUndefined();
  });
});
