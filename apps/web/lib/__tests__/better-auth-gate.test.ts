/**
 * 门的三步判定（docs/specs/sign-in.md 已冻结 · v1 §1.6），在 Better Auth 的两个钩子上。
 *
 * 这个文件以前叫「allowlist gate」，断言的是「不在名单一律拒」。规格把口径收窄成
 * 「未撤销＋未暂停即放行」，所以这里断言的东西整个换了一面：**陌生邮箱现在必须放行**
 * （SIGNIN-A1 的前提），撤销与暂停期陌生人仍然绝对拒绝（A6/A7 由它们自己的切片验收，这里只钉
 * 判定函数本身）。
 *
 * 第 2 轮判官打回之后，这个文件的两个被测事实换了口径，所以 mock 也跟着换成**两个**：
 *   · 「从未登录过」= `ba_user` 里没有他那一行（真的登录过一次才会有），不再是
 *     「环境名单点过名，或者 `AllowedEmail` 里有任何一行」；
 *   · 「撤销」对**每一个**地址都由 `AllowedEmail` 那一行拍板，founder 也不例外。
 * 两张表因此必须能分别答话 —— 上一版一个 `mockFindUnique` 同时冒充两张表，新口径下读不出
 * 「有账号但没有名单行」这种真实状态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { APIError } from "better-auth/api";

// ---------------------------------------------------------------------------
// Mock @fikirtive/db prisma BEFORE importing anything that uses it
// ---------------------------------------------------------------------------
/** `AllowedEmail` 里那一行（撤销住在这里）。key = 小写地址。 */
const allowedRows = new Map<string, { status: string }>();
/** `ba_user` 里那一行（「来过」住在这里）。key = 小写地址，value = 它的 id。 */
const accounts = new Map<string, string>();
/** 下一次读库要不要炸（fail-closed 那两条用例）。 */
let dbDown = false;

const mockAllowedEmailFindUnique = vi.fn(async ({ where }: { where: { email: string } }) => {
  if (dbDown) throw new Error("db down");
  return allowedRows.get(where.email) ?? null;
});
const mockBaUserFindUnique = vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
  if (dbDown) throw new Error("db down");
  if (where.id !== undefined) {
    // `assertSignInDoorForUserId` 的那一次读：id → 地址。
    for (const [email, id] of accounts) if (id === where.id) return { id, email };
    return null;
  }
  const id = accounts.get(where.email ?? "");
  return id ? { id } : null;
});

vi.mock("@fikirtive/db", () => ({
  prisma: {
    betterAuthUser: { findUnique: mockBaUserFindUnique },
    allowedEmail: { findUnique: mockAllowedEmailFindUnique },
  },
}));

// ---------------------------------------------------------------------------
// Import the REAL gate functions AFTER mocks are in place.
// ---------------------------------------------------------------------------
const { assertSignInDoor, assertSignInDoorForUserId } = await import("@/lib/better-auth/gate");

const FOUNDER_EMAIL = "founder@fikirtive.test";
const STRANGER_EMAIL = "stranger@example.com";

/** 「这个地址真的登录过」—— 这才是暂停开关要问的那件事。 */
function withAccount(email: string, id = `ba-${email}`): string {
  accounts.set(email, id);
  return id;
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.FOUNDER_ADMIN_EMAILS = process.env.FOUNDER_ADMIN_EMAILS;
  savedEnv.AUTH_ALLOWED_EMAILS = process.env.AUTH_ALLOWED_EMAILS;
  savedEnv.SIGNUPS_PAUSED = process.env.SIGNUPS_PAUSED;
  process.env.FOUNDER_ADMIN_EMAILS = FOUNDER_EMAIL;
  process.env.AUTH_ALLOWED_EMAILS = "";
  delete process.env.SIGNUPS_PAUSED;
  allowedRows.clear();
  accounts.clear();
  dbDown = false;
  mockAllowedEmailFindUnique.mockClear();
  mockBaUserFindUnique.mockClear();
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
  /**
   * SIGNIN-A1 —— 「陌生邮箱走码门直接进产品且建号」的**门这一侧**。
   *
   * RED 在登录门② 之前：那时这里断言的正好相反（`rejects.toBeInstanceOf(APIError)`），因为门问
   * 的是「在不在名单里」。规格 §1.6 把它换成三步判定之后，一个从没出现过的地址在开关没打开、
   * 没有撤销行的情况下必须放行 —— 否则码门验完码也建不出账号。
   */
  it("SIGNIN-A1 —— 一个从未出现过的邮箱：没有暂停、没有撤销，门放行（建账号的前提）", async () => {
    await expect(assertSignInDoor(STRANGER_EMAIL)).resolves.toBeUndefined();
  });

  it("throws for null email", async () => {
    await expect(assertSignInDoor(null)).rejects.toBeInstanceOf(APIError);
  });

  it("throws for undefined email", async () => {
    await expect(assertSignInDoor(undefined)).rejects.toBeInstanceOf(APIError);
  });

  it("allows an email in AUTH_ALLOWED_EMAILS env list while signups are open", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "merchant@fikirtive.test";
    await expect(assertSignInDoor("merchant@fikirtive.test")).resolves.toBeUndefined();
  });

  /**
   * SIGNIN-A7 —— 环境名单命中**不再短路**撤销那一步。
   *
   * RED before 登录门②：`lookupAddress` 在 `AUTH_ALLOWED_EMAILS` 命中时直接
   * `return { known: true, revoked: false }`，数据库根本不读，于是操作员把这个地址撤了
   * 等于没撤。规格 §1.6 写的是「撤销仍然绝对」，那条捷径让它对整整一个名单不成立。
   */
  it("SIGNIN-A7 —— 环境变量名单命中仍然查撤销：AUTH_ALLOWED_EMAILS 里的地址被撤销后照样被拒", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "merchant@fikirtive.test";
    allowedRows.set("merchant@fikirtive.test", { status: "revoked" });
    await expect(assertSignInDoor("merchant@fikirtive.test")).rejects.toBeInstanceOf(APIError);
  });

  /**
   * SIGNIN-A7 —— **founder 名单也不短路撤销**（第 2 轮判官 P0）。
   *
   * RED before 第 2 轮：`lookupAddress` 的第一行是
   * `if (envList(FOUNDER_ADMIN_EMAILS).includes(email)) return { known: true, revoked: false }`，
   * 一次库都不读，所以 founder 那一行被标 `revoked` 之后照样进得来 —— 规格 §1.6 的「撤销仍然
   * 绝对」对整整一个环境变量不成立。破窗锤改由**写侧**保住：`revokeEmailAccess` 不肯撤一个
   * 还挂在 `FOUNDER_ADMIN_EMAILS` 上的地址（见 signup-gate.ts 与
   * admin-revoke-access-action.test.ts），所以门上不再需要例外。
   */
  it("SIGNIN-A7 —— founder 名单里的地址被撤销之后同样进不来（门上没有环境例外）", async () => {
    allowedRows.set(FOUNDER_EMAIL, { status: "revoked" });
    await expect(assertSignInDoor(FOUNDER_EMAIL)).rejects.toBeInstanceOf(APIError);
    expect(mockAllowedEmailFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: FOUNDER_EMAIL } }),
    );
  });

  it("allows an email whose AllowedEmail row is active", async () => {
    allowedRows.set("invited@fikirtive.test", { status: "active" });
    await expect(assertSignInDoor("invited@fikirtive.test")).resolves.toBeUndefined();
  });

  it("throws for an email with a revoked DB row", async () => {
    allowedRows.set("revoked@fikirtive.test", { status: "revoked" });
    const err = await assertSignInDoor("revoked@fikirtive.test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
  });

  /** 撤销是绝对的：暂停开关的状态改变不了它，反之亦然。 */
  it("throws for a revoked row even while signups are paused", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    allowedRows.set("revoked@fikirtive.test", { status: "revoked" });
    await expect(assertSignInDoor("revoked@fikirtive.test")).rejects.toBeInstanceOf(APIError);
  });

  /**
   * SIGNIN-A6 —— 暂停期唯一放行的是「**真的登录过**」的地址，判据是 `ba_user` 里有他那一行。
   *
   * 老商家可能连 `AllowedEmail` 行都没有（`admitSelfSignup` 存在之前进来的那批），所以判据不能
   * 是名单行；反过来，名单行也不证明他来过（下面三条 RED 用例说的正是这件事）。
   */
  it("SIGNIN-A6 —— 暂停期间：没有账号的地址被拒，登录过的地址照常进", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    await expect(assertSignInDoor(STRANGER_EMAIL)).rejects.toBeInstanceOf(APIError);

    withAccount("regular@fikirtive.test");
    await expect(assertSignInDoor("regular@fikirtive.test")).resolves.toBeUndefined();
  });

  /**
   * SIGNIN-A6 —— **一张还没被用掉的邀请不是「登录过」**（第 2 轮判官 P0）。
   *
   * RED before 第 2 轮：`known` 的定义是 `namedByEnv || !!row`，而 `inviteTenant`
   * （`lib/tenant-actions.ts`）在任何人登录之前就能写下一行 `invited` —— 于是暂停期间
   * 「先邀请、再让他进来」变成一条绕过开关的路。规格 §1.6 ① 写的是「邮箱从未登录过 → 拒」，
   * 没有给邀请留例外。
   */
  it("SIGNIN-A6 —— 暂停期间：只有一行 invited、从没登录过的地址仍然被拒", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    allowedRows.set("pending@fikirtive.test", { status: "invited" });
    await expect(assertSignInDoor("pending@fikirtive.test")).rejects.toBeInstanceOf(APIError);
  });

  /** 同一条缺陷的另一半：环境名单点名也不是「登录过」。 */
  it("SIGNIN-A6 —— 暂停期间：只写在 AUTH_ALLOWED_EMAILS 里、从没登录过的地址仍然被拒", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    process.env.AUTH_ALLOWED_EMAILS = "envonly@fikirtive.test";
    await expect(assertSignInDoor("envonly@fikirtive.test")).rejects.toBeInstanceOf(APIError);
  });

  /** 第三半：founder 名单同样不是「登录过」—— 门上一个环境例外都不留。 */
  it("SIGNIN-A6 —— 暂停期间：从没登录过的 founder 地址也被拒（先关开关，不是先开后门）", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    await expect(assertSignInDoor(FOUNDER_EMAIL)).rejects.toBeInstanceOf(APIError);
  });

  /** fail closed：库读不到就当拒绝，不当放行。 */
  it("throws when the lookup itself fails", async () => {
    dbDown = true;
    await expect(assertSignInDoor(STRANGER_EMAIL)).rejects.toBeInstanceOf(APIError);
  });

  /** 同上，对 founder 也一样 —— 它不再有一条「不读库就放行」的捷径。 */
  it("throws for a founder email too when the lookup itself fails", async () => {
    dbDown = true;
    await expect(assertSignInDoor(FOUNDER_EMAIL)).rejects.toBeInstanceOf(APIError);
  });

  /** SIGNIN-A16 —— 判定之前归一化：撤销写在小写那一行，大小写变体不许绕过去。 */
  it("SIGNIN-A16 —— 判定前先 trim+lowercase，所以大小写变体读的是同一行", async () => {
    allowedRows.set("revoked@fikirtive.test", { status: "revoked" });
    await expect(assertSignInDoor("  Revoked@Fikirtive.TEST ")).rejects.toBeInstanceOf(APIError);
    expect(mockAllowedEmailFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "revoked@fikirtive.test" } }),
    );
  });
});

describe("assertSignInDoorForUserId (session.create.before gate)", () => {
  it("resolves for a userId whose address is not revoked", async () => {
    const id = withAccount(FOUNDER_EMAIL);
    await expect(assertSignInDoorForUserId(id)).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN when userId does not resolve to a user row", async () => {
    const err = await assertSignInDoorForUserId("ghost-789").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
  });

  it("throws for a userId whose email was revoked", async () => {
    const id = withAccount("revoked@fikirtive.test");
    allowedRows.set("revoked@fikirtive.test", { status: "revoked" });
    await expect(assertSignInDoorForUserId(id)).rejects.toBeInstanceOf(APIError);
  });

  /** 重复登录：一个自助进来、名单里有 active 行的老商家，会话闸不该再拦他。 */
  it("resolves for a self-service account on its repeat sign-in", async () => {
    const id = withAccount("selfserve@fikirtive.test");
    allowedRows.set("selfserve@fikirtive.test", { status: "active" });
    await expect(assertSignInDoorForUserId(id)).resolves.toBeUndefined();
  });

  /** 暂停期间的重复登录：他有账号，所以开关不该碰他。 */
  it("SIGNIN-A6 —— 暂停期间老商家的会话闸照样放行", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    const id = withAccount("selfserve@fikirtive.test");
    allowedRows.set("selfserve@fikirtive.test", { status: "active" });
    await expect(assertSignInDoorForUserId(id)).resolves.toBeUndefined();
  });
});
