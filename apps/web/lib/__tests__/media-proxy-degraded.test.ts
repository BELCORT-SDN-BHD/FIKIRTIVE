/**
 * SHARE-A4 / SHARE-A12(docs/specs/share-preview.md 已冻结 · v1)—— 计数器够不到时的兜底与报警。
 *
 * 这一层用注入的时钟,因为要验的两件事都是**时间的函数**:兜底窗口过没过、报警节流到没到。
 * 路由那一层的行为(429 + Retry-After、窗口内仍 200)在
 * `app/api/media/pub/__tests__/route-rate-limit-fail-closed.test.ts`,打真库、真断表。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FounderAlertOutcome } from "@fikirtive/core/founder-alert";

const mockFounderAlert = vi.fn<(alert: unknown, opts?: unknown) => Promise<FounderAlertOutcome[]>>();
vi.mock("@/lib/founder-alert", () => ({ founderAlert: (...a: unknown[]) => mockFounderAlert(...(a as [unknown])) }));

const {
  MEDIA_PROXY_DEGRADED_GRACE_MS,
  MEDIA_PROXY_STORE_ALERT_INTERVAL_MS,
  alertMediaProxyStoreUnreachable,
  rememberMediaProxySuccess,
  withinMediaProxyGrace,
  resetMediaProxyDegradedState,
} = await import("@/lib/media-proxy-degraded");

const T0 = 1_800_000_000_000;
const DELIVERED: FounderAlertOutcome[] = [
  { channel: "sentry", status: "sent" },
  { channel: "email", status: "sent" },
  { channel: "telegram", status: "skipped" },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetMediaProxyDegradedState();
  mockFounderAlert.mockResolvedValue(DELIVERED);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetMediaProxyDegradedState();
});

describe("SHARE-A4 —— 短缓存兜底窗口", () => {
  it("SHARE-A4 —— 刚成功拉过的客户在窗口内算兜底内", () => {
    rememberMediaProxySuccess("198.51.100.1", T0);
    expect(withinMediaProxyGrace("198.51.100.1", T0 + 1_000)).toBe(true);
    expect(withinMediaProxyGrace("198.51.100.1", T0 + MEDIA_PROXY_DEGRADED_GRACE_MS)).toBe(true);
  });

  it("SHARE-A4 —— 窗口过后不再兜底(这就是「窗口过后 429」的那一刻)", () => {
    rememberMediaProxySuccess("198.51.100.2", T0);
    expect(withinMediaProxyGrace("198.51.100.2", T0 + MEDIA_PROXY_DEGRADED_GRACE_MS + 1)).toBe(false);
  });

  it("SHARE-A4 —— 读窗口不续期:一次成功只买一个窗口,不是无限续杯", () => {
    rememberMediaProxySuccess("198.51.100.3", T0);
    // 在窗口内反复读(真实里就是反复被拒的那些请求)
    for (let t = T0; t <= T0 + MEDIA_PROXY_DEGRADED_GRACE_MS; t += 10_000) {
      expect(withinMediaProxyGrace("198.51.100.3", t)).toBe(true);
    }
    expect(withinMediaProxyGrace("198.51.100.3", T0 + MEDIA_PROXY_DEGRADED_GRACE_MS + 1)).toBe(false);
  });

  it("SHARE-A4 —— 兜底只给成功过的那个调用方,别人照拒", () => {
    rememberMediaProxySuccess("198.51.100.4", T0);
    expect(withinMediaProxyGrace("203.0.113.99", T0 + 1_000)).toBe(false);
  });
});

describe("SHARE-A12 —— 限流存储不可用的告警与送达回执", () => {
  it("SHARE-A12 —— 第一条是完整报警,走 founderAlert 三通道并把逐通道回执读出来", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcomes = await alertMediaProxyStoreUnreachable(T0);

    expect(mockFounderAlert).toHaveBeenCalledTimes(1);
    const [alert, opts] = mockFounderAlert.mock.calls[0] as [Record<string, unknown>, { repeat?: boolean }];
    expect(alert.key).toBe("media_proxy.rate_limit_store_unreachable");
    expect(String(alert.title)).toMatch(/rate-limit counter is unreachable/i);
    expect(String(alert.action)).toMatch(/rate_limit_counter/);
    expect(opts?.repeat).toBe(false); // 第一条不压
    // 回执被读了:逐通道状态出现在那一行里 —— 「发了」与「送到了」不是同一件事
    expect(outcomes).toEqual(DELIVERED);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rate-limit store alert delivered — sentry=sent email=sent telegram=skipped"),
    );
  });

  it("SHARE-A12 —— 一条都没送出去时单独写一行「NOT delivered」错误(不是当成成功)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFounderAlert.mockResolvedValue([
      { channel: "sentry", status: "skipped" },
      { channel: "email", status: "failed", reason: "resend 500" },
      { channel: "telegram", status: "skipped" },
    ]);

    await alertMediaProxyStoreUnreachable(T0);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("rate-limit store alert NOT delivered — sentry=skipped email=failed telegram=skipped"),
    );
  });

  it("SHARE-A12 —— 同一场故障里节流:间隔内的后续请求不再派发(报警不许自己变成事故)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await alertMediaProxyStoreUnreachable(T0);
    expect(await alertMediaProxyStoreUnreachable(T0 + 1_000)).toBeNull();
    expect(await alertMediaProxyStoreUnreachable(T0 + MEDIA_PROXY_STORE_ALERT_INTERVAL_MS - 1)).toBeNull();
    expect(mockFounderAlert).toHaveBeenCalledTimes(1);
  });

  it("SHARE-A12 —— 故障还在继续,间隔过后再报一次,但走 repeat(只进 Sentry,不再推送吵人)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await alertMediaProxyStoreUnreachable(T0);
    await alertMediaProxyStoreUnreachable(T0 + MEDIA_PROXY_STORE_ALERT_INTERVAL_MS);

    expect(mockFounderAlert).toHaveBeenCalledTimes(2);
    expect((mockFounderAlert.mock.calls[1] as [unknown, { repeat?: boolean }])[1]?.repeat).toBe(true);
  });

  it("SHARE-A12 —— 计数器恢复过之后是新的一场故障,下一条重新是完整报警", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await alertMediaProxyStoreUnreachable(T0);
    rememberMediaProxySuccess("198.51.100.5", T0 + 60_000); // 计数器答上话了 = 故障结束
    await alertMediaProxyStoreUnreachable(T0 + MEDIA_PROXY_STORE_ALERT_INTERVAL_MS);

    expect((mockFounderAlert.mock.calls[1] as [unknown, { repeat?: boolean }])[1]?.repeat).toBe(false);
  });
});
