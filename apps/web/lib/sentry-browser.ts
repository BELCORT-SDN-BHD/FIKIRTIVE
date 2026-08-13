/**
 * 浏览器端错误上报的纯逻辑(#793 — 上线债#1「仪表盘点亮」).
 *
 * 之前只有 server 装了 instrumentation:商家那边白屏、按钮点了没反应、一个组件在渲染
 * 里抛错 —— 这些**一条都传不回来**,我们只能等商家开口。这个文件决定「要不要上报、
 * 上报什么」,`instrumentation-client.ts` 与 `app/global-error.tsx` 只负责接线。
 *
 * 不含 server-only:这是要被打进浏览器包的。
 */

/** Sentry 浏览器端 init 参数。字段是我们真正决定的那几个,不是 SDK 的全集。 */
export type BrowserSentryOptions = {
  dsn: string;
  environment: string;
  /** 0 = 不采性能追踪。错误可见是这一票的目标,性能追踪是另一笔钱与另一票。 */
  tracesSampleRate: 0;
  /**
   * false = 绝不自动附带 IP、cookie、请求头这类可识别到人的东西。
   * 「商家的 data 商家的权利」:崩溃报告是我们的诊断信号,不是把商家的资料搬去第三方的通道。
   * 这是 SDK 的默认值,写出来是为了让它变成一条会被 review 的决定,而不是一个默认值。
   */
  sendDefaultPii: false;
};

/**
 * DSN 没配 → 返回 null → 调用方不 init。本地、CI、任何没接监控的环境因此完全无副作用,
 * 和 server 侧 instrumentation.ts 的既有约定一致。
 *
 * 只接受 http(s) 的 DSN:一个被误填成 "true"、"1" 或路径的值如果照单 init,SDK 会在
 * 每个商家的浏览器控制台里刷错,而我们一条事件都收不到 —— 那比不装还糟。
 */
export function browserSentryOptions(
  dsn: string | undefined,
  nodeEnv: string | undefined,
): BrowserSentryOptions | null {
  const trimmed = dsn?.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\/\S+$/.test(trimmed)) return null;
  return {
    dsn: trimmed,
    environment: nodeEnv || "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  };
}

/**
 * 一次界面崩溃随事件带上的上下文。
 *
 * `digest` 是 Next.js 给这次错误的短哈希:生产构建下浏览器只拿得到它(真实堆栈留在
 * 服务端日志里),所以它是把「商家截图里的那一串」和「服务端日志里的那一条」对上的
 * 唯一钥匙 —— 必须带上。
 */
export function crashReportContext(
  error: { digest?: string },
  surface: "global-error" | "route-error",
): { tags: { surface: string; digest: string }; level: "error" } {
  return {
    level: "error",
    tags: { surface, digest: error.digest || "none" },
  };
}
