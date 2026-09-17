/**
 * SHARE-A6(docs/specs/share-preview.md 已冻结 · v1)—— `/s/<token>` 干净入口的行为契约:
 * 把 URL 里的 token 换成一个 HttpOnly cookie,再 303 到没有 query 的干净地址。不在这里验证
 * token 本身(那是 `loadSharePreview` 的事,`lib/__tests__/share-preview-view.test.ts` 已经
 * 证过每一种坏形状都归一到同一个 unavailable) —— 这份文件只证明「搬家」这一件事做对了。
 */
import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { signSharePreviewToken } from "@fikirtive/token-crypto";
import { SHARE_PREVIEW_COOKIE_NAME, SHARE_PREVIEW_COOKIE_PATH } from "@/lib/share-preview-cookie";

const { GET } = await import("@/app/s/[token]/route");

const SECRET = "share-secret-route-s";

/**
 * 读 `Location`。web 的 vitest 把 `next/server` 换成了桩件
 * （`lib/__tests__/__stubs__/next-server.ts`），桩件把 `headers` 原样存成初始化时那个普通对象 ——
 * 与 `app/api/media/pub/__tests__/route.test.ts:77-81` 读头的方式同一条。
 */
const locationOf = (res: { headers: unknown }): string | undefined =>
  (res.headers as Record<string, string> | undefined)?.Location;

function req(origin = "https://app.test"): NextRequest {
  return { nextUrl: new URL(`${origin}/s/whatever`) } as unknown as NextRequest;
}
const call = (token: string, origin?: string) =>
  GET(req(origin), { params: Promise.resolve({ token }) });

describe("/s/[token] — SHARE-A6 clean share-preview entry", () => {
  it("303s to the clean address, no query string, no token in the Location", async () => {
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(locationOf(res)).toBe(SHARE_PREVIEW_COOKIE_PATH);
    expect(locationOf(res)).not.toContain("?");
    expect(locationOf(res)).not.toContain(token);
  });

  it("sets an HttpOnly cookie carrying the token, scoped to the preview page's own path", async () => {
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call(token);
    const cookie = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME);
    expect(cookie?.value).toBe(token);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe(SHARE_PREVIEW_COOKIE_PATH);
  });

  it("a valid token's cookie lives roughly as long as the token's own remaining expiry", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 600_000, SECRET); // 10 min out
    const res = await call(token);
    const maxAge = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.maxAge as number;
    expect(maxAge).toBeGreaterThan(590);
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it("still redirects AND still sets a cookie for a forged/garbage token — verification is the page's job, not this route's", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call("garbage.sig");
    expect(res.status).toBe(303);
    expect(locationOf(res)).toBe(SHARE_PREVIEW_COOKIE_PATH);
    // A token that will never verify still gets a (short-lived) cookie: the redirect target is
    // unconditional, and `loadSharePreview` fails it closed to the same "unavailable" page either way.
    expect(res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.value).toBe("garbage.sig");
  });

  /**
   * R3-F31（第三轮 staging 只读核证，2026-09-17）—— 顾客点开真链接被送到 **localhost**。
   *
   * 修前这一行建的是 `new URL(SHARE_PREVIEW_COOKIE_PATH, req.nextUrl.origin)`。Railway 的容器里
   * 那个 origin 就是进程自己监听的 `http://localhost:8080` —— 对外主机名只在代理加的
   * `X-Forwarded-Host` 里，容器自己看不见。staging 上 `GET /s/<token>` 真的答
   * `location: https://localhost:8080/schedule/share-preview`：顾客的浏览器照着这条跳，落在他
   * 自己电脑上。
   *
   * 修法是**根本不要 origin**：`Location` 写相对路径，浏览器拿它去比当前那条公开地址。仓内同一
   * 条已经立过（`lib/parked-route-redirect.ts` 末段：「`Location` 写成相对路径 …… 也就不必猜
   * 代理后面的对外主机名」）。这里跟那一条，不新开一个环境变量。
   */
  it("R3-F31 —— `Location` 是相对路径，容器自己的 origin 一个字都不进去", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    // 代理后面进程看见的 origin（Railway 上就是这一个）。
    const res = await call(token, "http://localhost:8080");
    const location = locationOf(res);
    expect(location, "顾客被送去了容器自己的 localhost").toBe(SHARE_PREVIEW_COOKIE_PATH);
    expect(location).not.toContain("localhost");
    expect(location).not.toContain("://");
  });

  it("R3-F31 —— 换一个对外主机名，`Location` 一个字不变（它根本不读 origin）", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const token = signSharePreviewToken("org_a", "post_1", Date.now() + 3_600_000, SECRET);
    const a = locationOf(await call(token, "https://web-staging-7901.up.railway.app"));
    const b = locationOf(await call(token, "http://127.0.0.1:3000"));
    expect(a).toBe(SHARE_PREVIEW_COOKIE_PATH);
    expect(b).toBe(a);
  });

  it("an unverifiable token's cookie gets a short fallback lifetime, not a long-lived one", async () => {
    process.env.SHARE_PREVIEW_SECRET = SECRET;
    const res = await call("garbage.sig");
    const maxAge = res.cookies.get(SHARE_PREVIEW_COOKIE_NAME)?.maxAge as number;
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(600); // FALLBACK_COOKIE_MAX_AGE_SECONDS
  });
});
