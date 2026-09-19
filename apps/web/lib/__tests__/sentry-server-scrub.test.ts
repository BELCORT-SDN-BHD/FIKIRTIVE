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
 * 浏览器那一侧的行为由 `sentry-browser.test.ts` 原样钉着(本次未改其字段面)。
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
        request: { query_string: [["t", TOKEN] as [string, string], ["step", "1"] as [string, string]] },
      }).request!.query_string,
    ).toEqual([
      ["t", "[redacted]"],
      ["step", "1"],
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
   * 单一源:cookie 名字的权威定义在 `lib/share-preview-cookie.ts`,而它的值随 NODE_ENV 变
   * (生产 `__Secure-sp_t`、开发 `sp_t`)。这条用例把**当前进程读到的那个名字**喂进去 ——
   * 哪天有人改了那个常量而忘了改洗法,这里当场红。
   */
  it("SHARE-A6 —— 咬的就是 `SHARE_PREVIEW_COOKIE_NAME` 这颗 cookie,不是另抄的一个名字", () => {
    const event = scrubSentryEventTokens({ request: { cookies: { [SHARE_PREVIEW_COOKIE_NAME]: TOKEN } } });
    expect(event.request!.cookies).toEqual({ [SHARE_PREVIEW_COOKIE_NAME]: "[redacted]" });
  });

  it("SHARE-A6 —— `Authorization` 一类的凭据回声整条不要", () => {
    const event = scrubSentryEventTokens({
      request: { headers: { authorization: "Bearer abc.def", "proxy-authorization": "Basic Zm9v" } },
    });
    expect(event.request!.headers).toEqual({ authorization: "[redacted]", "proxy-authorization": "[redacted]" });
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
    const options = init.mock.calls[0]![0] as { beforeSend?: unknown; tracesSampleRate?: number };
    expect(options.beforeSend).toBe(scrubSentryEventTokens);
    expect(options.tracesSampleRate).toBe(0);
  });

  it("没配 DSN 就完全不 init —— 本地与 CI 零副作用的既有约定不变", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(init).not.toHaveBeenCalled();
  });
});
