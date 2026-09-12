/**
 * SHARE-A3 / A4 / A12(docs/specs/share-preview.md 已冻结 · v1)—— 限流计数存储打挂之后的整条路。
 *
 * 故障是**真**造出来的:把 `rate_limit_counter` 表改名挪走,让 `consumeRateLimit` 在真库上
 * 真的失败(与 `lib/__tests__/rate-limit-gates.test.ts` 同一手法),而不是 mock 一个 Error。
 * 三件一体(Founder 2026-09-12 场⑦)在这里一次验完:拒绝、兜底、报警。
 *
 * 这道闸从前是 fail-OPEN 的,理由写在 `consumeMediaProxyGate` 上,那条理由的前提已经变了 ——
 * 这条路现在有第二种调用者(客户的浏览器),而且流式之后对象可以到 2 GB。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signMediaToken } from "@fikirtive/token-crypto";
import { prisma } from "@fikirtive/db";
import type { FounderAlertOutcome } from "@fikirtive/core/founder-alert";

const mockReadStream = vi.fn();
const mockSizeOf = vi.fn();
vi.mock("@/lib/storage", () => ({
  storage: {
    readStream: (...a: unknown[]) => mockReadStream(...a),
    sizeOf: (...a: unknown[]) => mockSizeOf(...a),
  },
  mimeOf: () => "image/jpeg",
}));

const DELIVERED: FounderAlertOutcome[] = [
  { channel: "sentry", status: "sent" },
  { channel: "email", status: "sent" },
  { channel: "telegram", status: "skipped" },
];
const mockFounderAlert = vi.fn<(alert: unknown, opts?: unknown) => Promise<FounderAlertOutcome[]>>();
vi.mock("@/lib/founder-alert", () => ({ founderAlert: (...a: unknown[]) => mockFounderAlert(...(a as [unknown])) }));

const { GET } = await import("@/app/api/media/pub/[token]/route");
const { resetMediaProxyDegradedState, MEDIA_PROXY_DEGRADED_GRACE_MS, MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS } =
  await import("@/lib/media-proxy-degraded");
const { MEDIA_PROXY_PER_CALLER_PER_10_MIN } = await import("@/lib/rate-limit-gates");

const SECRET = "media-secret-failclosed";
const HASH = "b".repeat(64);
const KEY = `u/orgA/${HASH}.jpg`;

function req(ip: string): NextRequest {
  return { url: "http://x/api/media/pub", headers: new Headers({ "x-forwarded-for": ip }) } as unknown as NextRequest;
}
const call = (ip: string) =>
  GET(req(ip), { params: Promise.resolve({ token: signMediaToken("orgA", KEY, Date.now() + 3_600_000, SECRET) }) });
const headersOf = (res: { headers: unknown }) => (res.headers ?? {}) as Record<string, string>;

/** 真断:把计数表挪走,用完原样挪回来。 */
async function withCounterTableMissing<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter" RENAME TO "rate_limit_counter_mediaproxy"`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "rate_limit_counter_mediaproxy" RENAME TO "rate_limit_counter"`);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.MEDIA_PROXY_SECRET = SECRET;
  mockFounderAlert.mockResolvedValue(DELIVERED);
  mockReadStream.mockImplementation(async () =>
    (async function* () {
      yield new Uint8Array([255, 216, 255]);
    })(),
  );
  mockSizeOf.mockResolvedValue(3);
  resetMediaProxyDegradedState();
  await prisma.rateLimitCounter.deleteMany({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SHARE-A3 —— 限流计数存储打挂:fail-closed", () => {
  it("SHARE-A3 —— 存储打挂后拉一次合法预览媒体地址:429 + Retry-After,一个字节都不吐", async () => {
    const res = await withCounterTableMissing(() => call("198.51.100.201"));

    expect(res.status).toBe(429);
    expect(headersOf(res)["Retry-After"]).toBe(String(MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS));
    expect(Number(headersOf(res)["Retry-After"])).toBeGreaterThan(0);
    expect(mockReadStream).not.toHaveBeenCalled();
    expect(mockSizeOf).not.toHaveBeenCalled();
  });

  it("SHARE-A3 —— 存储恢复后同一地址立刻恢复 200", async () => {
    const ip = "198.51.100.202";
    expect((await withCounterTableMissing(() => call(ip))).status).toBe(429);

    const res = await call(ip); // 表已经挪回来了
    expect(res.status).toBe(200);
    // 故障那一次没有记账,恢复之后这一次记上了
    const rows = await prisma.rateLimitCounter.findMany({ where: { key: `media:${ip}` } });
    expect(rows.map((r) => r.count)).toEqual([1]);
  });

  it("SHARE-A3 —— 超额度那条老路仍然是 429,而且现在也带 Retry-After", async () => {
    const ip = "198.51.100.203";
    await prisma.rateLimitCounter.create({
      data: {
        key: `media:${ip}`,
        count: MEDIA_PROXY_PER_CALLER_PER_10_MIN,
        expiresAt: BigInt(Date.now() + 10 * 60_000),
      },
    });
    const res = await call(ip);
    expect(res.status).toBe(429);
    expect(Number(headersOf(res)["Retry-After"])).toBeGreaterThan(0);
    expect(mockReadStream).not.toHaveBeenCalled();
  });
});

describe("SHARE-A4 —— 短缓存兜底:正在看的客户不被一次抖动打断", () => {
  it("SHARE-A4 —— 先成功拉过一次,随即打挂存储,窗口内重拉同一地址仍 200", async () => {
    const ip = "198.51.100.204";
    expect((await call(ip)).status).toBe(200); // 真计数器放行过一次

    const res = await withCounterTableMissing(() => call(ip));
    expect(res.status).toBe(200);
  });

  it("SHARE-A4 —— 窗口过后同一地址照样 429", async () => {
    const ip = "198.51.100.205";
    vi.useFakeTimers({ toFake: ["Date"] }); // 只假造 Date:真库的异步照常跑
    vi.setSystemTime(new Date(1_800_000_000_000));

    expect((await call(ip)).status).toBe(200);
    vi.setSystemTime(new Date(1_800_000_000_000 + MEDIA_PROXY_DEGRADED_GRACE_MS + 1_000));

    const res = await withCounterTableMissing(() => call(ip));
    expect(res.status).toBe(429);
    expect(headersOf(res)["Retry-After"]).toBe(String(MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS));
  });

  it("SHARE-A4 —— 兜底只属于成功过的那个客户:没拉过的地址在同一场故障里照拒", async () => {
    expect((await call("198.51.100.206")).status).toBe(200);
    expect((await withCounterTableMissing(() => call("203.0.113.206"))).status).toBe(429);
  });
});

describe("SHARE-A12 —— 「限流存储不可用」告警真送达", () => {
  it("SHARE-A12 —— 存储打挂时告警经 founderAlert 发出,并留下逐通道送达回执", async () => {
    await withCounterTableMissing(() => call("198.51.100.207"));

    expect(mockFounderAlert).toHaveBeenCalledTimes(1);
    const [alert] = mockFounderAlert.mock.calls[0] as [Record<string, unknown>];
    expect(alert.key).toBe("media_proxy.rate_limit_store_unreachable");
    // 回执被读出来写进了那一行 —— 「只记日志说存储挂了」不算数,要的是每条通道的结果
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("rate-limit store alert delivered — sentry=sent email=sent telegram=skipped"),
    );
  });

  it("SHARE-A12 —— 兜底放行的那次同样报警:客户没事不等于存储没事", async () => {
    const ip = "198.51.100.208";
    expect((await call(ip)).status).toBe(200);
    expect((await withCounterTableMissing(() => call(ip))).status).toBe(200); // 兜底窗口内
    expect(mockFounderAlert).toHaveBeenCalledTimes(1);
  });

  it("SHARE-A12 —— 一场故障里的连续请求不会变成报警风暴(节流后只派发一次)", async () => {
    await withCounterTableMissing(async () => {
      for (const ip of ["198.51.100.209", "198.51.100.210", "198.51.100.211"]) await call(ip);
    });
    expect(mockFounderAlert).toHaveBeenCalledTimes(1);
  });
});
