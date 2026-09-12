/**
 * 浏览器端错误上报的纯逻辑(#793 — 上线债#1「仪表盘点亮」).
 *
 * 之前只有 server 装了 instrumentation:商家那边白屏、按钮点了没反应、一个组件在渲染
 * 里抛错 —— 这些**一条都传不回来**,我们只能等商家开口。这个文件决定「要不要上报、
 * 上报什么」,`instrumentation-client.ts` 与 `app/global-error.tsx` 只负责接线。
 *
 * 不含 server-only:这是要被打进浏览器包的。
 */

/** 事件里我们会动到的那几块。SDK 的事件类型比这大得多,这里只声明「要洗的那几个字段」——
 *  多声明一个字段,就是多一个下次 SDK 升级会对不上的形状。 */
export type ScrubbableEvent = {
  request?: { url?: string };
  breadcrumbs?: { data?: { from?: string; to?: string } | undefined }[];
};

/**
 * #1317 —— 上报出去的 URL 一律不带**片段**(判官 r1 P1,2026-09-11)。
 *
 * 为什么这条一刀切:片段(`#` 之后那一段)在这个产品里正是放**凭据**的地方 —— 邮件里那颗
 * Log in 按钮把邮箱与六位一次性码放在片段里带到 `/login`(SIGNIN-A5,规格 §4:片段不会被送去
 * 服务器)。而 SDK 的 HttpContext 默认集成把 `location.href` **原样**写进
 * `event.request.url`,导航面包屑也把带片段的 href 记进 `data.from` / `data.to`。于是码还有效
 * 的那 15 分钟里,浏览器上任何一个错误都会把一份可以直接登录的凭据送去第三方 —— 与
 * `sendDefaultPii: false` 无关,片段本来就在 URL 里。
 *
 * 切整段而不是维护一份「敏感参数名」名单:名单永远漏下一个,而我们没有任何一条诊断信息
 * 是**只在**片段里的。修根不修表 —— 不在登录页贴一块补丁,而是让这个通道再也带不出片段。
 */
export function scrubUrlFragments<T extends ScrubbableEvent>(event: T): T {
  const cut = (u: string | undefined): string | undefined =>
    typeof u === "string" && u.includes("#") ? u.slice(0, u.indexOf("#")) : u;
  if (event.request?.url !== undefined) event.request.url = cut(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb?.data) continue;
    if (crumb.data.from !== undefined) crumb.data.from = cut(crumb.data.from);
    if (crumb.data.to !== undefined) crumb.data.to = cut(crumb.data.to);
  }
  return event;
}

/**
 * SHARE-A6(docs/specs/share-preview.md 已冻结 · v1,§4「口令搬家」)—— 第二道防线,不是主要
 * 手段。主要手段是分享 token 从此不再进任何 URL(见 `app/s/[token]/route.ts` 与
 * `schedule/share-preview/page.tsx`,token 换成一个 HttpOnly cookie);这里只是不去赌那件事
 * 一定滴水不漏 —— 一次中途出错的重定向、一条商家自己转发出去的旧书签,都可能让上报事件的
 * `event.request.url` 或导航面包屑里还留着一段本该消失的 token。
 *
 * 只切两个已知形状,不切整段 query(那会连累 `?step=code` 这类无害参数,#1317 冻结的测试钉
 * 着它必须原样通过):
 *   ① `?t=…` —— 这个产品里只有分享预览的旧入口用过这个参数名(见 grep);
 *   ② `/api/media/pub/<token>` 与 `/s/<token>` 的路径段 —— 两条门今天仍然把 token 放在路径里
 *      (媒体代理是产品设计如此,`/s/<token>` 是它转成 cookie前的那一跳)。
 */
const TOKEN_QUERY_PARAM = /([?&])t=[^&#]*/g;
const TOKEN_PATH_SEGMENT = /(\/(?:api\/media\/pub|s)\/)[^/?#]+/g;

function scrubTokenShapes(u: string): string {
  return u.replace(TOKEN_PATH_SEGMENT, "$1[redacted]").replace(TOKEN_QUERY_PARAM, "$1t=[redacted]");
}

/** SHARE-A6 —— `scrubUrlFragments` plus the two token shapes above, applied to the same fields. */
export function scrubShareTokens<T extends ScrubbableEvent>(event: T): T {
  scrubUrlFragments(event);
  if (event.request?.url !== undefined) event.request.url = scrubTokenShapes(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb?.data) continue;
    if (crumb.data.from !== undefined) crumb.data.from = scrubTokenShapes(crumb.data.from);
    if (crumb.data.to !== undefined) crumb.data.to = scrubTokenShapes(crumb.data.to);
  }
  return event;
}

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
  /** #1317 —— 每一条事件送出去之前先洗掉 URL 片段;SHARE-A6 加了 query 里的 `t=` 与媒体/分享
   *  路径段(见 `scrubShareTokens`,它内部先做 `scrubUrlFragments` 那一步)。 */
  beforeSend: <T extends ScrubbableEvent>(event: T) => T;
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
    beforeSend: scrubShareTokens,
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
