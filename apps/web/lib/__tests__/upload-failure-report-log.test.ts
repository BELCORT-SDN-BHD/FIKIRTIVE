/**
 * upload-failure-report-log.test.ts — 2026-09-03 staging 走查 S3 的服务端半边。
 *
 * 直传的字节走「浏览器 → 存储桶」,服务器不在路上,所以走查那次商家撞墙时 web 日志一行都
 * 没有。`reportDirectUploadFailure` 是补回来的那条边:它只写一行可 grep 的结构化日志,
 * 租户身份取自 `requireOwner()`,报告体里塞不进任意字符串。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOwner, mockStorage } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockStorage: {
    supportsDirectUpload: true,
    exists: vi.fn(),
    put: vi.fn(),
    presignedPut: vi.fn(),
    createMultipart: vi.fn(),
    sizeOf: vi.fn(),
    readStream: vi.fn(),
  },
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@/lib/storage", () => ({ storage: mockStorage }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: vi.fn() })) }));
vi.mock("@/lib/entity-snapshot", () => ({ buildEntitySnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit-gates", () => ({ consumeUploadGate: vi.fn(async () => true) }));
vi.mock("@fikirtive/db", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));

const { reportDirectUploadFailure } = await import("../upload-actions");

let logged: string[];
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logged = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  mockOwner.mockResolvedValue({ ownerId: "org_merchant_1", email: "merchant@shop.my" });
});

afterEach(() => { errorSpy.mockRestore(); });

describe("reportDirectUploadFailure —— 直传失败在服务端留下的那一行", () => {
  it("写一行可 grep 的结构化日志,字段齐全", async () => {
    const res = await reportDirectUploadFailure({
      stage: "transfer",
      category: "blocked",
      ext: "png",
      sizeBytes: 4096,
      httpStatus: null,
    });

    expect(res).toEqual({ ok: true });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("[upload] DIRECT-UPLOAD-FAILED");
    expect(logged[0]).toContain("org=org_merchant_1");
    expect(logged[0]).toContain("stage=transfer");
    expect(logged[0]).toContain("category=blocked");
    expect(logged[0]).toContain("ext=png");
    expect(logged[0]).toContain("sizeBytes=4096");
    expect(logged[0]).toContain("httpStatus=none");
  });

  it("拿得到状态码就照实写进同一行", async () => {
    await reportDirectUploadFailure({
      stage: "transfer", category: "blocked", ext: "mp4", sizeBytes: 12, httpStatus: 403,
    });
    expect(logged[0]).toContain("httpStatus=403");
  });

  it("org 只认服务端的 requireOwner(),客户端自报的租户一律不算数", async () => {
    const res = await reportDirectUploadFailure({
      stage: "transfer", category: "blocked", ext: "png", sizeBytes: 1, httpStatus: null,
      orgId: "org_someone_else",
    });

    // strict schema:多一个字段就整条不收 —— 客户端连「顺便说说我是谁」的口子都没有。
    expect(res).toEqual({ error: "Malformed upload failure report." });
    expect(logged).toHaveLength(0);
  });

  it("夹带原始错误串(可能带预签名 URL 的签名)一律不收", async () => {
    const res = await reportDirectUploadFailure({
      stage: "transfer", category: "blocked", ext: "png", sizeBytes: 1, httpStatus: null,
      message: "PUT https://bucket.example.com/o/a.png?X-Amz-Signature=DEADBEEF failed",
    });

    expect(res).toEqual({ error: "Malformed upload failure report." });
    expect(logged).toHaveLength(0);
  });

  it("阶段与类别只认封闭集里的词", async () => {
    expect(await reportDirectUploadFailure({
      stage: "whatever", category: "blocked", ext: "png", sizeBytes: 1, httpStatus: null,
    })).toEqual({ error: "Malformed upload failure report." });
    expect(await reportDirectUploadFailure({
      stage: "transfer", category: "mystery", ext: "png", sizeBytes: 1, httpStatus: null,
    })).toEqual({ error: "Malformed upload failure report." });
    expect(logged).toHaveLength(0);
  });

  it("没登录就什么都不记 —— 这条日志是租户的,匿名写不进来", async () => {
    mockOwner.mockResolvedValue({ error: "Not authorized." });

    const res = await reportDirectUploadFailure({
      stage: "transfer", category: "blocked", ext: "png", sizeBytes: 1, httpStatus: null,
    });

    expect(res).toEqual({ error: "Not authorized." });
    expect(logged).toHaveLength(0);
  });
});
