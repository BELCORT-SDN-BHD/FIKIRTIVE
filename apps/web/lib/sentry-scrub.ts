/**
 * SHARE-A6 的遥测半句（`docs/specs/share-preview.md` 已冻结 · v1，§2）——**一份**脱敏规矩，
 * 浏览器与服务器两个 Sentry init 共用。
 *
 * 为什么把它从 `lib/sentry-browser.ts` 搬出来:那条规矩原来只挂在浏览器那一边
 * (`instrumentation-client.ts` → `browserSentryOptions().beforeSend`),而服务端
 * `instrumentation.ts` 的 `Sentry.init` 根本没有 `beforeSend` —— 于是一条服务端错误只要请求
 * 地址是 `/s/<token>` 或 `/api/media/pub/<token>`,或者请求头里带着那颗 `__Secure-sp_t`
 * cookie,token 就原样送去第三方。SHARE-A6 后半句因此只在浏览器上成立(缺口记于
 * `docs/specs/share-preview.md` §5 2026-09-17 那一行的「残余」段)。
 *
 * 修根不修表:形状与洗法只写在这里一份,两个 init 都从这里拿。不在服务端再抄一份正则 ——
 * 抄件与本尊长得越像,下一次改形状时漏掉的那一份就越难被发现。
 *
 * 运行时中立:不碰 `window`/`document`,不 import 任何 node 内建 —— 它要同时被打进浏览器包
 * 和跑在 node server 上。
 */

/**
 * 事件里我们会动到的那几块。SDK 的事件类型比这大得多,这里只声明「要洗的那几个字段」——
 * 多声明一个字段,就是多一个下次 SDK 升级会对不上的形状。
 *
 * 服务端(`@sentry/node`)的事件比浏览器多出 headers / cookies / query_string / exception 这几块,
 * 所以它们也在这张表里;浏览器事件里它们只是恰好不存在,`scrubShareTokens` 也不碰它们。
 */
export type ScrubbableEvent = {
  request?: {
    url?: string;
    query_string?: string | Record<string, string> | [string, string][];
    headers?: Record<string, string>;
    cookies?: Record<string, string> | string;
  };
  breadcrumbs?: ({ message?: string; data?: Record<string, unknown> } | undefined)[];
  exception?: { values?: ({ value?: string } | undefined)[] };
  message?: string;
};

/** 脱敏后填进去的字面量。只有这一处定义 —— 测试钉的也是它。 */
const REDACTED = "[redacted]";

/**
 * 只切两个已知形状,不切整段 query(那会连累 `?step=code` 这类无害参数,#1317 冻结的测试钉
 * 着它必须原样通过):
 *   ① `?t=…` —— 这个产品里只有分享预览的旧入口用过这个参数名(见 grep);
 *   ② `/api/media/pub/<token>` 与 `/s/<token>` 的路径段 —— 两条门今天仍然把 token 放在路径里
 *      (媒体代理是产品设计如此,`/s/<token>` 是它转成 cookie 前的那一跳)。
 *
 * 字符集里排掉空白与引号/尖括号,是因为这两条规矩现在也用在**散文**上(异常正文、面包屑的
 * message):`GET /s/<token> failed` 里那个空格若算进 token,洗完会把 ` failed` 一起吃掉 —— 真正
 * 的 URL 里本来就不会出现裸空格,所以地址那一侧的行为一字不变。
 */
const TOKEN_QUERY_PARAM = /([?&])t=[^&#\s'"<>]*/g;
const TOKEN_PATH_SEGMENT = /(\/(?:api\/media\/pub|s)\/)[^/?#\s'"<>]+/g;

/** 同一个 `t=` 规矩,用在**没有** `?`/`&` 前缀的裸 query string（`event.request.query_string`）上。 */
const BARE_TOKEN_QUERY_PARAM = /^t=[^&#]*/;

/**
 * 那颗装着分享 token 的 cookie 的名字。权威定义在 `lib/share-preview-cookie.ts`,但那边的值
 * 随 `NODE_ENV` 变(生产 `__Secure-sp_t`、开发 `sp_t`),而**洗**必须两种都咬:上报事件可能来自
 * 任何一个环境,而跑测试的进程自己只可能是其中一个。所以这里按形状匹配,并由
 * `lib/__tests__/sentry-server-scrub.test.ts` 钉住「常量落在这个形状里」,两边不会各走各的。
 */
const SHARE_COOKIE_NAME = /^(?:__Secure-|__Host-)?sp_t$/;

/** 整条值一律不要的请求头(凭据回声)。 */
const AUTHISH_HEADER = /^(?:authorization|proxy-authorization)$/i;

/** 装着 cookie 的请求头 —— 值要按 cookie 逐对洗,不是整条丢掉(其余 cookie 名对诊断有用)。 */
const COOKIE_HEADER = /^(?:set-)?cookie$/i;

function scrubTokenShapes(u: string): string {
  return u.replace(TOKEN_PATH_SEGMENT, `$1${REDACTED}`).replace(TOKEN_QUERY_PARAM, `$1t=${REDACTED}`);
}

const cutFragment = (u: string | undefined): string | undefined =>
  typeof u === "string" && u.includes("#") ? u.slice(0, u.indexOf("#")) : u;

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
  if (event.request?.url !== undefined) event.request.url = cutFragment(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb?.data) continue;
    if (typeof crumb.data.from === "string") crumb.data.from = cutFragment(crumb.data.from);
    if (typeof crumb.data.to === "string") crumb.data.to = cutFragment(crumb.data.to);
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
 * 这是**地址那一半**:只咬 `request.url` 与导航面包屑的 `from`/`to`。它不是任何一个 init 的
 * `beforeSend` —— 两个 init 接的都是下面那只 `scrubSentryEventTokens`,它第一步就调这里。
 * 单独留着是因为这一半自己有测试(`sentry-browser.test.ts` 的 `scrubShareTokens` 一节),
 * 且「地址字段才切片段」这条规矩就写在这里。
 */
export function scrubShareTokens<T extends ScrubbableEvent>(event: T): T {
  scrubUrlFragments(event);
  if (event.request?.url !== undefined) event.request.url = scrubTokenShapes(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb?.data) continue;
    if (typeof crumb.data.from === "string") crumb.data.from = scrubTokenShapes(crumb.data.from);
    if (typeof crumb.data.to === "string") crumb.data.to = scrubTokenShapes(crumb.data.to);
  }
  return event;
}

/** `event.request.query_string` 的三种合法形状(裸字符串 / 字典 / 二元组数组)各洗一次。 */
function scrubQueryString(q: NonNullable<ScrubbableEvent["request"]>["query_string"]) {
  if (typeof q === "string") {
    return scrubTokenShapes(q.replace(BARE_TOKEN_QUERY_PARAM, `t=${REDACTED}`));
  }
  if (Array.isArray(q)) {
    for (const pair of q) if (pair?.[0] === "t") pair[1] = REDACTED;
    return q;
  }
  if (q && typeof q === "object") {
    for (const name of Object.keys(q)) {
      const value = q[name];
      if (typeof value !== "string") continue;
      q[name] = name === "t" ? REDACTED : scrubTokenShapes(value);
    }
  }
  return q;
}

/** `Cookie: a=1; __Secure-sp_t=…; b=2` —— 只把分享 token 那一对的值换掉,其余原样留着。 */
function scrubCookieHeader(value: string): string {
  return value
    .split(";")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const name = pair.slice(0, eq).trim();
      return SHARE_COOKIE_NAME.test(name) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join(";");
}

/**
 * SHARE-A6 的遥测那一句 —— **浏览器与服务器两个 init 的 `beforeSend` 都是这一只**:事件里 token
 * 可能出现的每一处都洗一遍。
 *
 * 为什么不按运行时分两只:要关的是「分享/媒体 token 进遥测」这**一类**。下面这几块虽然多数由
 * `@sentry/node` 填,但浏览器事件里同样存在 `exception.values[].value`(一条错误正文里带着地址)
 * 与 fetch 面包屑的 `data.url` —— 只给服务端洗,这一类就只关了一半,而漏掉的那一半长得和已关的
 * 那一半一模一样。字段不存在时每一步都是空转,所以浏览器多付的代价是零。
 *
 * 逐块说明:
 *   · `request.query_string` —— node 的请求上下文把 query 单独拆出来一份,`request.url` 洗干净
 *     了它还留着原文;
 *   · `request.cookies` 与 `Cookie` 请求头 —— 分享 token 今天就住在 `__Secure-sp_t` 里
 *     (`lib/share-preview-cookie.ts`),这是服务端唯一一处**必然**拿得到完整 token 的地方;
 *   · `Authorization` 一类的请求头 —— 整条值不要,凭据回声没有任何诊断价值;
 *   · 异常正文与 `event.message` —— 一条 `fetch failed: https://…/api/media/pub/<token>` 的报错
 *     会把地址原样写进 `exception.values[].value`,它不经过 `request.url` 那道门;
 *   · 面包屑的 `data.url` 与 `message` —— 两边的 http/fetch 集成都把外发请求记在这两处。
 *
 * 片段那一刀(#1317)只落在**地址**字段上:异常正文里的 `#` 是正文的一部分,按地址的规矩切会
 * 把报错拦腰截断,那是拿诊断能力换一件本来就没发生的事。
 */
export function scrubSentryEventTokens<T extends ScrubbableEvent>(event: T): T {
  scrubShareTokens(event);

  const request = event.request;
  if (request) {
    if (request.query_string !== undefined) request.query_string = scrubQueryString(request.query_string);
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        const value = request.headers[name];
        if (typeof value !== "string") continue;
        if (AUTHISH_HEADER.test(name)) request.headers[name] = REDACTED;
        else if (COOKIE_HEADER.test(name)) request.headers[name] = scrubCookieHeader(value);
        else request.headers[name] = scrubTokenShapes(value);
      }
    }
    if (typeof request.cookies === "string") request.cookies = scrubCookieHeader(request.cookies);
    else if (request.cookies) {
      for (const name of Object.keys(request.cookies)) {
        const value = request.cookies[name];
        if (typeof value !== "string") continue;
        request.cookies[name] = SHARE_COOKIE_NAME.test(name) ? REDACTED : scrubTokenShapes(value);
      }
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb) continue;
    if (typeof crumb.message === "string") crumb.message = scrubTokenShapes(crumb.message);
    if (typeof crumb.data?.url === "string") crumb.data.url = scrubTokenShapes(cutFragment(crumb.data.url)!);
  }

  for (const value of event.exception?.values ?? []) {
    if (value && typeof value.value === "string") value.value = scrubTokenShapes(value.value);
  }
  if (typeof event.message === "string") event.message = scrubTokenShapes(event.message);

  return event;
}
