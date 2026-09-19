// Next.js server instrumentation. Runs once when a server instance boots.
//
// Three things happen here, in this order on purpose:
//   1. #797 — the env contract. A production process whose required configuration is missing
//      refuses to serve, instead of serving and failing in odd places later. It goes first:
//      there is no point wiring monitoring, or checking a narrower deployment detail, for a
//      process that must not run at all.
//   2. #795 — a BOOT CHECK on the caller-identity deployment shape. This runs ALWAYS: a
//      misconfigured CALLER_IP_SOURCE stops the server from starting, on purpose.
//   3. Error monitoring. No-op unless SENTRY_DSN is set, so local/dev and any environment
//      without a DSN are completely unaffected. (Closed-beta P0 — minimal error monitoring
//      before external users arrive.)
//
// Both checks are imported dynamically behind a NEXT_RUNTIME check, and both halves of that
// matter. Next builds an EDGE instrumentation bundle as well, where node:crypto and node:net do
// not exist — a static import puts those modules in that bundle and the build reports it. And the
// checks themselves are Node-server concerns: the edge runtime sees a different slice of the
// environment, so asserting the server contract there would be answering the wrong question.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertWebEnv } = await import("@/lib/env-boot");
    assertWebEnv();
  }

  // #795 r5 — the caller-identity shape is checked HERE, at boot, and not at the first request.
  //
  // `resolveCallerIpSource` throws on a value it does not recognise. Left to the first
  // `callerKey()` call, that throw is a 500 on somebody's login attempt, in production, minutes
  // or hours after the deploy that caused it — and only on the paths that happen to gate. Boot is
  // the honest place: the deploy fails, the log says why, and no merchant sees it.
  //
  // Node runtime only: that is where the gates run, and the module reads `node:net`.
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { assertCallerIpSourceIsDeployable } = await import("@/lib/caller-identity");
    assertCallerIpSourceIsDeployable();
  }

  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  const { scrubSentryEventTokens } = await import("@/lib/sentry-scrub");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
    // SHARE-A6 的遥测半句(docs/specs/share-preview.md,§2)在服务器上也得成立。浏览器那一边
    // 从 #1317 起就有这道 beforeSend(lib/sentry-browser.ts),服务端一直没有 —— 于是一条服务端
    // 错误只要请求地址是 `/s/<token>` 或 `/api/media/pub/<token>`,或者请求头里带着那颗
    // `__Secure-sp_t` cookie,token 就原样送去第三方。洗法与形状是**同一份**(lib/sentry-scrub.ts),
    // 不在这里抄第二遍。
    beforeSend: scrubSentryEventTokens,
  });
}
