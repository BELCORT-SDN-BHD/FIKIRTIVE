/**
 * SHARE-A6 的**服务器半句**(docs/specs/share-preview.md 已冻结 · v1,§2;登记行 2026-09-19)。
 *
 * RED before:`apps/web/instrumentation.ts` 的 `Sentry.init` 没有 `beforeSend` —— 浏览器那一边从
 * #1317 起就有(`lib/sentry-browser.ts`),服务端一直没有。于是一条服务端错误只要请求地址是
 * `/s/<token>`、`/api/media/pub/<token>`,或者请求头/cookie 里带着那颗 `__Secure-sp_t`,分享
 * token 就原样送去第三方 —— 拿到它就能看商家发给客户的那一页,跟拿到链接本身是一回事。
 *
 * 这个文件钉两件事:
 *   ① 四种形态(`/s/<token>`、`/api/media/pub/<token>`、`?t=`、`__Secure-sp_t`)在服务端事件的
 *      url / query_string / headers / cookies / breadcrumbs / exception / message 里一律被换成
 *      `[redacted]`,而**不是** token 形状的东西一个字不动;
 *   ② `instrumentation.ts` 真的把这个函数交给了 `Sentry.init` —— 洗法再对,没接上等于没有。
 *
 * 浏览器那一侧接的是**同一只**函数(Founder 2026-09-19「关类不补例」追加裁决):
 * `browserSentryOptions().beforeSend` 与这里的服务端 init 都是 `scrubSentryEventTokens`。
 * `sentry-browser.test.ts` 的既有断言一字未改、仍全绿(浏览器只会洗得更多),另有两条新用例
 * 钉住加宽出来的那两处(异常正文、fetch 面包屑的 `data.url`)与 `beforeSendTransaction` 的接线。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** `vi.mock` 被提升到文件顶端,所以工厂里引用的 mock 也必须由 `vi.hoisted` 一起提上去。 */
const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({ init }));

import { SHARE_PREVIEW_COOKIE_NAME } from "@/lib/share-preview-cookie";
import { scrubSentryEventTokens } from "@/lib/sentry-scrub";

const TOKEN = "eyJvIjoib3JnQSIsInAiOiJwMSJ9.deadbeefcafe";

describe("scrubSentryEventTokens —— SHARE-A6 服务器半句", () => {
  it("SHARE-A6 —— `request.url` 的分享入口与媒体代理路径段都被换掉", () => {
    expect(scrubSentryEventTokens({ request: { url: `https://app.example/s/${TOKEN}` } }).request!.url).toBe(
      "https://app.example/s/[redacted]",
    );
    expect(
      scrubSentryEventTokens({ request: { url: `https://app.example/api/media/pub/${TOKEN}?x=1` } }).request!.url,
    ).toBe("https://app.example/api/media/pub/[redacted]?x=1");
  });

  /**
   * node 的请求上下文把 query 另外拆出一份 —— `request.url` 洗干净了它还留着原文,而三种形状
   * (裸字符串 / 字典 / 二元组)SDK 都可能填。
   */
  it("SHARE-A6 —— `query_string` 的三种形状里 `t=` 都被换掉,别的参数原样留着", () => {
    expect(scrubSentryEventTokens({ request: { query_string: `t=${TOKEN}&step=1` } }).request!.query_string).toBe(
      "t=[redacted]&step=1",
    );
    expect(
      scrubSentryEventTokens({ request: { query_string: { t: TOKEN, step: "1" } } }).request!.query_string,
    ).toEqual({ t: "[redacted]", step: "1" });
    expect(
      scrubSentryEventTokens({
        request: {
          query_string: [
            ["t", TOKEN] as [string, string],
            ["step", "1"] as [string, string],
            // 二元组分支过去只咬键名恰好是 `t` 的那一对,别的值一个字不洗 —— 于是
            // `{next: "/s/<token>"}` 被洗、`[["next", "/s/<token>"]]` 原样送出，同一件事两种答案。
            ["next", `/s/${TOKEN}`] as [string, string],
          ],
        },
      }).request!.query_string,
    ).toEqual([
      ["t", "[redacted]"],
      ["step", "1"],
      ["next", "/s/[redacted]"],
    ]);
  });

  /**
   * 服务端唯一**必然**拿得到完整 token 的地方:token 今天就住在这颗 cookie 里
   * (`lib/share-preview-cookie.ts`),客户每打开一次预览页都会把它发上来。
   */
  it("SHARE-A6 —— `Cookie` 请求头里的分享 token 被换掉,其余 cookie 原样留着", () => {
    const event = scrubSentryEventTokens({
      request: { headers: { cookie: `ga=1; __Secure-sp_t=${TOKEN}; theme=dark` } },
    });
    expect(event.request!.headers!.cookie).toBe("ga=1; __Secure-sp_t=[redacted]; theme=dark");
  });

  it("SHARE-A6 —— `request.cookies`(字典与整串两种形状)里的分享 token 都被换掉", () => {
    expect(
      scrubSentryEventTokens({ request: { cookies: { "__Secure-sp_t": TOKEN, theme: "dark" } } }).request!.cookies,
    ).toEqual({ "__Secure-sp_t": "[redacted]", theme: "dark" });
    // 开发环境那颗没有 `__Secure-` 前缀的同名 cookie 也要咬。
    expect(scrubSentryEventTokens({ request: { cookies: `sp_t=${TOKEN}` } }).request!.cookies).toBe(
      "sp_t=[redacted]",
    );
  });

  /**
   * 单一源:cookie 名字的权威定义在 `lib/share-preview-cookie.ts`,它的值随 NODE_ENV 在
   * `__Secure-sp_t`(生产)与 `sp_t`(其余)之间二选一,而跑测试的进程只可能落在其中一支。
   *
   * 所以这里钉两件事,分工写明白:①**两个字面量都咬** —— 上报事件可能来自任一环境,洗法不能
   * 只覆盖本进程恰好选中的那一支;②**当前进程读到的那个常量也咬** —— 哪天有人把常量改成第三个
   * 名字,这一条当场红。它保证不了的是「那个常量的另一支分支」:那一支在本进程里根本取不到值,
   * 由 ① 的字面量代为把守。
   */
  it("SHARE-A6 —— 生产与开发两个 cookie 名都咬,且与 `SHARE_PREVIEW_COOKIE_NAME` 同步", () => {
    const both = scrubSentryEventTokens({
      request: { cookies: { "__Secure-sp_t": TOKEN, sp_t: TOKEN, theme: "dark" } },
    });
    expect(both.request!.cookies).toEqual({ "__Secure-sp_t": "[redacted]", sp_t: "[redacted]", theme: "dark" });

    const fromConstant = scrubSentryEventTokens({ request: { cookies: { [SHARE_PREVIEW_COOKIE_NAME]: TOKEN } } });
    expect(fromConstant.request!.cookies).toEqual({ [SHARE_PREVIEW_COOKIE_NAME]: "[redacted]" });
    expect(["__Secure-sp_t", "sp_t"]).toContain(SHARE_PREVIEW_COOKIE_NAME);
  });

  it("SHARE-A6 —— `Authorization` 一类的凭据回声整条不要(含 `X-Api-Key` 这种名字里没有 auth 的)", () => {
    const event = scrubSentryEventTokens({
      request: {
        headers: {
          authorization: "Bearer abc.def",
          "proxy-authorization": "Basic Zm9v",
          "X-Api-Key": "sk_live_abc123",
          "x-amz-security-token": "IQoJb3JpZ2lu",
          "x-auth-request-email": "shop@example.test",
        },
      },
    });
    expect(event.request!.headers).toEqual({
      authorization: "[redacted]",
      "proxy-authorization": "[redacted]",
      "X-Api-Key": "[redacted]",
      "x-amz-security-token": "[redacted]",
      // 名单之外的头不整条丢掉 —— 它对诊断有用,且不是凭据本身。
      "x-auth-request-email": "shop@example.test",
    });
  });

  it("SHARE-A6 —— `Referer` 这类带地址的请求头也洗 token 形状", () => {
    const event = scrubSentryEventTokens({
      request: { headers: { referer: `https://app.example/s/${TOKEN}`, "user-agent": "curl/8" } },
    });
    expect(event.request!.headers).toEqual({ referer: "https://app.example/s/[redacted]", "user-agent": "curl/8" });
  });

  /** node 的 http 集成把外发请求记在面包屑的 `data.url` / `message` 上,不经过 `request.url`。 */
  it("SHARE-A6 —— 面包屑的 `data.url` 与 `message` 都洗", () => {
    const event = scrubSentryEventTokens({
      breadcrumbs: [
        { data: { url: `https://app.example/api/media/pub/${TOKEN}`, status_code: 500 } },
        { message: `GET /s/${TOKEN} failed`, data: undefined },
        undefined,
      ],
    });
    expect(event.breadcrumbs![0]!.data).toEqual({
      url: "https://app.example/api/media/pub/[redacted]",
      status_code: 500,
    });
    expect(event.breadcrumbs![1]!.message).toBe("GET /s/[redacted] failed");
  });

  /** 一条 `fetch failed: …/api/media/pub/<token>` 的报错写在异常正文里,它不经过任何 URL 字段。 */
  it("SHARE-A6 —— 异常正文与 `event.message` 里的 token 也洗", () => {
    const event = scrubSentryEventTokens({
      message: `share preview failed for /s/${TOKEN}`,
      exception: {
        values: [{ value: `fetch failed: https://app.example/api/media/pub/${TOKEN}?t=${TOKEN}` }, undefined],
      },
    });
    expect(event.message).toBe("share preview failed for /s/[redacted]");
    expect(event.exception!.values![0]!.value).toBe(
      "fetch failed: https://app.example/api/media/pub/[redacted]?t=[redacted]",
    );
  });

  /** 异常正文里的 `#` 是正文的一部分 —— 按地址的规矩切会把报错拦腰截断,那是拿诊断换空气。 */
  it("SHARE-A6 —— 片段那一刀只落在地址字段上,不截断异常正文", () => {
    const event = scrubSentryEventTokens({
      request: { url: "https://app.example/login?step=code#code=123456" },
      exception: { values: [{ value: "PrismaClientKnownRequestError P2002 on field #id" }] },
    });
    expect(event.request!.url).toBe("https://app.example/login?step=code");
    expect(event.exception!.values![0]!.value).toBe("PrismaClientKnownRequestError P2002 on field #id");
  });

  /**
   * 事务事件走的是 `beforeSendTransaction`,不是 `beforeSend`(SDK 里后者先 `isErrorEvent(...)`)。
   * 今天 `tracesSampleRate: 0` 没有事务事件被采样,但那是个设置值不是门 —— 采样一旦打开,
   * `GET /s/<token>` 这样的事务名、trace context 与 span 上的地址都会直接送出去。
   */
  it("SHARE-A6 —— 事务事件的 `transaction`、`contexts.trace` 与 `spans[]` 也洗", () => {
    const event = scrubSentryEventTokens({
      transaction: `GET /s/${TOKEN}`,
      contexts: {
        trace: {
          op: "http.server",
          description: `GET /api/media/pub/${TOKEN}`,
          span_id: "abc123",
          data: { url: `https://app.example/s/${TOKEN}`, "http.status_code": 200 },
        },
      },
      spans: [{ op: "http.client", description: `GET /api/media/pub/${TOKEN}`, data: { "http.url": `https://app.example/s/${TOKEN}` } }],
    });
    expect(event.transaction).toBe("GET /s/[redacted]");
    expect(event.contexts!.trace).toEqual({
      op: "http.server",
      description: "GET /api/media/pub/[redacted]",
      span_id: "abc123",
      data: { url: "https://app.example/s/[redacted]", "http.status_code": 200 },
    });
    expect(event.spans![0]).toEqual({
      op: "http.client",
      description: "GET /api/media/pub/[redacted]",
      data: { "http.url": "https://app.example/s/[redacted]" },
    });
  });

  it("SHARE-A6 —— 不是 token 形状的事件一个字不动", () => {
    const event = {
      message: "canvas render failed",
      request: {
        url: "https://app.example/canvas?x=1&step=code",
        query_string: "x=1&step=code",
        headers: { referer: "https://app.example/canvas", "user-agent": "curl/8" },
        cookies: { theme: "dark" },
      },
      breadcrumbs: [{ message: "GET /api/health", data: { url: "https://app.example/api/health" } }],
      exception: { values: [{ value: "boom" }] },
    };
    expect(scrubSentryEventTokens(structuredClone(event))).toEqual(event);
  });
});

/**
 * 洗法再对,没接上等于没有 —— 这条用例跑的是 `register()` 本身,断言交给 `Sentry.init` 的
 * `beforeSend` 就是上面那个函数(不是一个长得像的抄件)。
 *
 * `NEXT_RUNTIME=edge` 走的是同一段 init:`register()` 里 Sentry 那一块排在两道启动断言之后,
 * 两种 runtime 共用。用 edge 只是为了不把「env 契约」与「caller-ip 形状」两件无关的事拖进来。
 */
describe("instrumentation.ts —— 服务端 init 真的带上了这道 beforeSend", () => {
  afterEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_RUNTIME;
    init.mockClear();
  });

  it("SHARE-A6 —— `Sentry.init` 收到的 beforeSend 就是 `scrubSentryEventTokens`", async () => {
    process.env.SENTRY_DSN = "https://key@o1.ingest.example/2";
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]![0] as {
      beforeSend?: unknown;
      beforeSendTransaction?: unknown;
      tracesSampleRate?: number;
    };
    expect(options.beforeSend).toBe(scrubSentryEventTokens);
    // `beforeSend` 只作用于错误事件;事务事件走这一只,今天采样为 0 不代表明天也是。
    expect(options.beforeSendTransaction).toBe(scrubSentryEventTokens);
    expect(options.tracesSampleRate).toBe(0);
  });

  it("没配 DSN 就完全不 init —— 本地与 CI 零副作用的既有约定不变", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(init).not.toHaveBeenCalled();
  });
});
