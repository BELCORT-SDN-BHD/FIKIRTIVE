import { auth } from "@/lib/better-auth/server";
import { isRevokedSessionRefusal } from "@/lib/better-auth/signin-refusal";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 proxy (the middleware successor; Node runtime by default).
 *
 * The wall is OPT-IN via AUTH_ENABLED=true (founder decision 2026-06-11:
 * defer enforcement until anything cost-incurring ships). Hard trigger,
 * recorded in the design doc: BEFORE the first endpoint that burns money
 * (editor render tracer, API-key generation), set AUTH_ENABLED=true +
 * RESEND_API_KEY in Railway — no code change needed.
 *
 * When enabled, everything is gated except /login, public legal pages, the auth APIs, Next
 * statics and the product-identity art the session-less doors draw (public/brand/*.svg) —
 * including /files/* (reference images are private). The wall is now
 * Better Auth: it reads the BA session via auth.api.getSession.
 */
export default async function proxy(req: NextRequest) {
  // Fail-closed in production: now that money-incurring features (Otto) ship, a prod
  // deploy that simply FORGETS the flag must not serve the app unauthenticated. So in
  // production the wall is ON unless someone EXPLICITLY sets AUTH_ENABLED=false. In dev
  // it stays opt-in (AUTH_ENABLED=true) so local work needs no login.
  // (Prod also requires RESEND_API_KEY so sign-in codes work behind the wall.)
  const enabled =
    process.env.NODE_ENV === "production"
      ? process.env.AUTH_ENABLED !== "false"
      : process.env.AUTH_ENABLED === "true";
  if (!enabled) return;
  // SIGNIN-A7（第 10 轮，判官 opus P1）—— 被撤销的会话在这里必须落成**登录页**，不是一张 500。
  //
  // 前门（`lib/better-auth/gate.ts` 的 `assertRequestSessionNotRevoked`）挂在 `hooks.before`
  // 上，而 `auth.api.*` 与 HTTP 路由走同一条 hook 管线，所以它抛的 `sign_in_revoked` 会直接从
  // 这一行冒出来 —— 裸调的话整个 `proxy()` reject，商家在**每一个页面**上读到的是一次 500，而
  // 正确答案（他进不来，请回登录页）恰恰是这个函数下面那三行已经写好的。产品那一层
  // （`lib/better-auth/compat.ts`）早就在做同一句翻译，谓词现在两处共用一个定义。
  //
  // **只翻译这一种**。前门的「判不出」（`sign_in_session_unverified`）与任何别的错照旧原样抛
  // 出去 —— 这一行今天对 `getSession` 抛错就是这么处理的（没有 catch），而那正是对的：读不出
  // 会话时把人放去登录页等于把一次数据库抖动变成一次全站登出，而且它会把一个真实的故障扮成
  // 一次正常的未登录。
  const session = await auth.api.getSession({ headers: req.headers }).catch((e: unknown) => {
    if (isRevokedSessionRefusal(e)) return null;
    throw e;
  });
  if (!session) {
    const login = new URL("/login", req.nextUrl);
    // F42: keep the query string too, so a deep link (e.g. ?project=…&thread=…) survives the
    // login round-trip. LoginForm's sanitizeCallbackURL already accepts a path with a query.
    login.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
}

// ⚠️ DO NOT hand-edit the matcher below. #901 / #978.
//
// Every exemption — which path, whether it is one path or a whole subtree, and WHY it may answer
// without a session — is declared in lib/auth-wall-ledger.ts. That ledger is the source of truth;
// the string below is its output, copied here because Next requires config.matcher to be a
// build-time constant ("matcher values need to be constants so they can be statically analyzed
// at build-time. Dynamic values such as variables will be ignored" — next/…/file-conventions/proxy),
// so it cannot be computed at runtime from the ledger.
//
// To change what is outside the wall: edit the ledger, run the ledger's generator, paste the
// result here. lib/__tests__/proxy.test.ts asserts `config.matcher[0] === buildAuthWallMatcher()`
// byte for byte, plus the boundary shapes of every single entry, so drifting the two apart — or
// hand-writing a new unbounded prefix straight into this string — turns CI red immediately.
//
// northstar: NO LONGER EXEMPT (#606, D7 · T7). The exemption existed only because that
// prefix was a design-only prototype behind a preview flag that 404'd in production. The
// mock pages and the flag are both deleted; what is left under the prefix are two REAL
// product routes (Home + Canvas) that read the merchant's own projects and canvas, so the
// prefix belongs inside the wall like every other product surface. The pages keep their own
// requireOwner() gates — the wall is the outer of two locks, not the only one.
export const config = {
  matcher: ["/((?!login/?$|signup/?$|forgot-password/?$|reset-password/?$|verify-email/?$|schedule/share-preview/?$|s(?:/.*)?$|terms/?$|privacy(?:/.*)?$|legal(?:/.*)?$|api/better-auth(?:/.*)?$|api/stripe(?:/.*)?$|api/health/?$|api/ops/dlq/?$|api/ready/?$|api/build-info/?$|api/meta/data-deletion/?$|api/media/pub(?:/.*)?$|_next/static(?:/.*)?$|_next/image(?:/.*)?$|favicon\\.ico/?$|brand/f-app-icon-coral\\.svg/?$|brand/otto\\.svg/?$|brand/otto-helpful\\.svg/?$|brand/otto-thinking\\.svg/?$|brand/otto-approving\\.svg/?$|brand/otto-success\\.svg/?$).*)"],
};
