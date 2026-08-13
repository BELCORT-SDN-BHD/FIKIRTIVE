/**
 * #795 r3 — `idToken` 这一列的真相,写成用例,免得它再被人凭印象讲一遍。
 *
 * r2 在 `databaseHooks.account` 里把 `idToken` 落库前置空,理由是「没有任何东西读它」。
 * **那句话是假的**,判官抓住了:better-auth 1.6.20 的 `api/routes/account.mjs` 里,
 * `getValidAccessToken` 在刷新时带着它(:283)并把它返回(:306),`/get-access-token` 与
 * `/refresh-token` 也返回它(:425 / :436 / :444)。而这些端点在这个产品里**是挂着的** ——
 * 整个 Better Auth 路由器由 `app/api/better-auth/[...all]/route.ts` 交给 `toNextJsHandler`。
 * 置空等于让一个还活着的端点安静地答错,比它想消掉的那点暴露更糟。
 *
 * 所以这个文件钉两件事:
 *   ① 那些端点确实可达 —— 「没人读」这句话不许再被写出来;
 *   ② 我们没有任何 account 写钩子在悄悄改令牌列。
 * 剩下的残余风险(idToken 仍是明文,库外无法加密)登记在 PR 与 #795 上,不在这里假装解决。
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@fikirtive/db";

process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.AUTH_ALLOWED_EMAILS = "";
process.env.FOUNDER_ADMIN_EMAILS = "";

const { auth } = await import("@/lib/better-auth/server");

/** POST an endpoint the way a signed-out browser would. 404 = not mounted; anything else = live. */
async function post(path: string, body: Record<string, unknown>) {
  return auth.handler(
    new Request(`http://localhost:3100/api/better-auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
  );
}

describe("#795 r3 · 读 idToken 的那些端点是挂着的", () => {
  it("/get-access-token 与 /refresh-token 都不是 404 —— 它们会答请求", async () => {
    for (const path of ["/get-access-token", "/refresh-token"]) {
      const res = await post(path, { providerId: "google" });
      // 没有会话时它们拒绝(401/400),但**拒绝本身就是被路由到了**。404 才代表没挂。
      expect(res.status, `${path} 回了 ${res.status}`).not.toBe(404);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("库的 api 表面上确实有这两个端点", async () => {
    const api = auth.api as Record<string, unknown>;
    expect(typeof api.getAccessToken).toBe("function");
    expect(typeof api.refreshToken).toBe("function");
  });
});

describe("#795 r3 · 没有任何 account 写钩子在动令牌列", () => {
  it("databaseHooks 里没有 account —— 置空过 idToken 的那个钩子已经撤掉", () => {
    // 这条围栏防的是「再来一次静默置空」:一个还活着的端点被改成返回 undefined,
    // 没有任何报错,只有一个功能安静地不对了。
    const hooks = (auth.options.databaseHooks ?? {}) as Record<string, unknown>;
    expect(hooks.account).toBeUndefined();
  });

  it("**行为回路**:走库自己的写入路径存一个 idToken,读回来还在(r5)", async () => {
    // r5 判词:上一版只证明端点挂着,证明不了「写进去的 idToken 真的还在」——
    // 换一条别的置空路径(写钩子、adapter 包装、schema 默认值)照样绿。
    // 这条走的是库自己的 internalAdapter,也就是 OAuth 回调真正用的那条写入路径:
    // 任何一处把 idToken 抹掉,这里都会红。
    const ctx = await auth.$context;
    const email = `id-token-${randomUUID()}@fikirtive.test`;
    // 这个产品的用户写入是 deny-by-default 的(#543 名单闸),所以先把这个地址放进名单 ——
    // 这条用例问的是「令牌列有没有被抹」,不是名单闸本身(那有它自己的用例)。
    await prisma.allowedEmail.create({ data: { email, status: "active", invitedBy: "id-token-test" } });
    const user = await ctx.internalAdapter.createUser({ email, name: "ID token round trip", emailVerified: true });
    // 值本身不是真令牌,只是一个可辨认的标记;真令牌不会出现在测试里,也不会被打印。
    const marker = `not-a-real-token.${randomUUID()}`;
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "google",
      accountId: `acct-${randomUUID()}`,
      idToken: marker,
    });

    const stored = await prisma.betterAuthAccount.findFirst({
      where: { userId: user.id },
      select: { idToken: true },
    });
    expect(stored?.idToken, "idToken 被某处抹掉了 —— 读它的那些端点会安静地答错").toBe(marker);

    await prisma.betterAuthAccount.deleteMany({ where: { userId: user.id } });
    await prisma.betterAuthUser.deleteMany({ where: { id: user.id } });
    await prisma.allowedEmail.deleteMany({ where: { email } });
  }, 60_000);

  it("access/refresh 仍然走库自己的透明加解密(这一半没有被撤)", () => {
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
});
