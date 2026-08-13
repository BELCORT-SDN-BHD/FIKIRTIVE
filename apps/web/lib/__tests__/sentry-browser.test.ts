import { describe, expect, it } from "vitest";
import { browserSentryOptions, crashReportContext } from "@/lib/sentry-browser";

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
    expect(browserSentryOptions("https://key@o1.ingest.example/2", "production")).toEqual({
      dsn: "https://key@o1.ingest.example/2",
      environment: "production",
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
  });

  it("trims the DSN and falls back to a named environment", () => {
    const options = browserSentryOptions("  https://key@o1.ingest.example/2  ", undefined);
    expect(options?.dsn).toBe("https://key@o1.ingest.example/2");
    expect(options?.environment).toBe("development");
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
