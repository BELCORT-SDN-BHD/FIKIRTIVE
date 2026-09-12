import { describe, expect, it } from "vitest";
import { browserSentryOptions, crashReportContext, scrubShareTokens, scrubUrlFragments } from "@/lib/sentry-browser";

describe("browserSentryOptions", () => {
  it("returns null when no DSN is configured — local and CI stay untouched", () => {
    expect(browserSentryOptions(undefined, "development")).toBeNull();
    expect(browserSentryOptions("", "production")).toBeNull();
    expect(browserSentryOptions("   ", "production")).toBeNull();
  });

  // 一个被误填成 "true"/"1"/路径的 DSN,照单 init 会在每个商家的浏览器控制台里刷错,
  // 而我们一条事件都收不到 —— 比不装还糟,所以宁可不 init。
  it("refuses a DSN that is not an http(s) URL", () => {
    expect(browserSentryOptions("true", "production")).toBeNull();
    expect(browserSentryOptions("1", "production")).toBeNull();
    expect(browserSentryOptions("/sentry", "production")).toBeNull();
  });

  it("builds options with tracing off and PII off", () => {
    expect(browserSentryOptions("https://key@o1.ingest.example/2", "production")).toMatchObject({
      dsn: "https://key@o1.ingest.example/2",
      environment: "production",
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
  });

  /**
   * #1317（判官 r1 P1，2026-09-11）—— 上报的 URL 一律不带片段。
   *
   * RED before：`browserSentryOptions` 没有 `beforeSend`，SDK 的 HttpContext 默认集成把
   * `location.href` **原样**写进 `event.request.url`。而 `/login` 的登录链接正是把邮箱与那六位
   * 一次性码放在片段里（SIGNIN-A5），所以在码还有效的那 15 分钟里，浏览器上任何一个错误都会
   * 把一份可以直接登录的凭据送去第三方。
   */
  it("#1317 —— init 参数带 beforeSend：上报的 URL 一律不带片段", () => {
    const beforeSend = browserSentryOptions("https://key@o1.ingest.example/2", "production")?.beforeSend;
    expect(typeof beforeSend).toBe("function");
    const scrubbed = beforeSend!({
      request: { url: "https://app.example/login?step=code#email=me%40shop.test&code=123456" },
    });
    expect(scrubbed.request!.url).toBe("https://app.example/login?step=code");
  });

  /**
   * SHARE-A6(docs/specs/share-preview.md 已冻结 · v1)—— 第二道防线:即使一个分享 token 还是
   * 出现在了上报事件的 URL 里(主要手段是它压根不再进 URL,见 `app/s/[token]/route.ts`),
   * `beforeSend` 也不把它原样送出去。
   */
  it("SHARE-A6 —— init 参数带的 beforeSend 也洗掉分享/媒体路径里的 token 与 `?t=`", () => {
    const beforeSend = browserSentryOptions("https://key@o1.ingest.example/2", "production")?.beforeSend;
    const scrubbed = beforeSend!({
      request: { url: "https://app.example/s/eyJvIjoib3JnQSJ9.deadbeef" },
    });
    expect(scrubbed.request!.url).toBe("https://app.example/s/[redacted]");
  });

  it("trims the DSN and falls back to a named environment", () => {
    const options = browserSentryOptions("  https://key@o1.ingest.example/2  ", undefined);
    expect(options?.dsn).toBe("https://key@o1.ingest.example/2");
    expect(options?.environment).toBe("development");
  });
});

describe("scrubUrlFragments", () => {
  /** 片段是这个产品里唯一放过凭据的地方（SIGNIN-A5 的登录链接），所以「不带片段」是一条
   *  一刀切的规矩，而不是一份要维护的敏感参数名单 —— 名单永远漏下一个。 */
  it("#1317 —— 事件里的 URL 与导航面包屑都被切掉片段", () => {
    const event = scrubUrlFragments({
      request: { url: "https://app.example/login#email=me%40shop.test&code=123456" },
      breadcrumbs: [
        { data: { from: "/login#email=me%40shop.test&code=123456", to: "/canvas#node=1" } },
        { data: undefined },
        {},
      ],
    });
    expect(event.request!.url).toBe("https://app.example/login");
    expect(event.breadcrumbs![0]!.data).toEqual({ from: "/login", to: "/canvas" });
  });

  it("#1317 —— 没有片段的事件原样通过，形状不变", () => {
    expect(scrubUrlFragments({ request: { url: "https://app.example/canvas?x=1" } })).toEqual({
      request: { url: "https://app.example/canvas?x=1" },
    });
    expect(scrubUrlFragments({})).toEqual({});
  });
});

/**
 * SHARE-A6(docs/specs/share-preview.md 已冻结 · v1)—— 第二道防线,证明它只咬两个已知形状,
 * 不咬别的 query 参数(#1317 冻结的 `?step=code` 那条测试就是它必须留手的证据)。
 */
describe("scrubShareTokens", () => {
  it("SHARE-A6 —— 洗掉 `?t=` 参数，其它参数原样留着", () => {
    const event = scrubShareTokens({
      request: { url: "https://app.example/schedule/share-preview?t=eyJvIjoiYSJ9.sig&step=1" },
    });
    expect(event.request!.url).toBe("https://app.example/schedule/share-preview?t=[redacted]&step=1");
  });

  it("SHARE-A6 —— 洗掉媒体代理与分享入口路径段里的 token，两条门都咬", () => {
    expect(
      scrubShareTokens({ request: { url: "https://app.example/api/media/pub/eyJvIjoiYSJ9.sig" } }).request!.url,
    ).toBe("https://app.example/api/media/pub/[redacted]");
    expect(scrubShareTokens({ request: { url: "https://app.example/s/eyJvIjoiYSJ9.sig" } }).request!.url).toBe(
      "https://app.example/s/[redacted]",
    );
  });

  it("SHARE-A6 —— 同样咬导航面包屑的 from/to，不只咬 request.url", () => {
    const event = scrubShareTokens({
      breadcrumbs: [{ data: { from: "/s/eyJvIjoiYSJ9.sig", to: "/schedule/share-preview?t=eyJvIjoiYSJ9.sig" } }],
    });
    expect(event.breadcrumbs![0]!.data).toEqual({
      from: "/s/[redacted]",
      to: "/schedule/share-preview?t=[redacted]",
    });
  });

  it("SHARE-A6 —— 先洗片段再洗 token，两件事都做，且不误伤 `?step=code` 这类无害参数（#1317 冻结的口径）", () => {
    const event = scrubShareTokens({
      request: { url: "https://app.example/login?step=code#email=me%40shop.test&code=123456" },
    });
    expect(event.request!.url).toBe("https://app.example/login?step=code");
  });

  it("SHARE-A6 —— 不是分享/媒体形状的路径与参数，原样通过", () => {
    expect(scrubShareTokens({ request: { url: "https://app.example/canvas?x=1" } })).toEqual({
      request: { url: "https://app.example/canvas?x=1" },
    });
  });
});

describe("crashReportContext", () => {
  it("carries the Next.js digest so a merchant screenshot maps to a server log line", () => {
    expect(crashReportContext({ digest: "3141592653" }, "global-error")).toEqual({
      level: "error",
      tags: { surface: "global-error", digest: "3141592653" },
    });
  });

  it("stays well-formed when Next.js gave no digest", () => {
    expect(crashReportContext({}, "route-error").tags.digest).toBe("none");
  });
});
