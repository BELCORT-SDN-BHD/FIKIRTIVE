/**
 * SHARE-A1 / SHARE-A2(docs/specs/share-preview.md 已冻结 · v1)—— 公开媒体代理改成流式 + Range。
 *
 * 病因(#1053 发现 1):路由原本是 `storage.get()` 把**整个对象**读进内存再 `Buffer.from`。
 * 上传上限是 2 GB(`packages/core/src/upload.ts`),所以一次合法的大预览请求就足以把 web
 * 进程的内存吃穿,而调用方是匿名的、只要手上有一条有效签名 URL 就能反复来。
 *
 * 这份文件用的假驱动把「整对象读」做成一件**会当场炸**的事:`readStream(key)` 不带区间时抛。
 * 于是「没有整对象进内存」不是靠读代码相信的,是测试失败与否的区别 —— 这就是 SHARE-A1
 * 「进程常驻内存不随对象大小上涨」那一句在单测层面的可量形式。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signMediaToken } from "@fikirtive/token-crypto";
import { prisma } from "@fikirtive/db";

/** 一个「200 MB 以上」的对象,但一个字节都不真的分配:驱动按区间生成内容。 */
const OBJECT_SIZE = 300 * 1024 * 1024;
const MIB = 1024 * 1024;

/** 第 i 个字节 = i % 251 —— 读错偏移一眼看得出来。 */
const byteAt = (i: number) => i % 251;

const mockReadStream = vi.fn();
const mockSizeOf = vi.fn();
vi.mock("@/lib/storage", () => ({
  storage: {
    readStream: (...a: unknown[]) => mockReadStream(...a),
    sizeOf: (...a: unknown[]) => mockSizeOf(...a),
  },
  mimeOf: () => "image/jpeg",
}));

/** 驱动:带区间就只吐那一段;不带区间就是「整对象进内存」—— 在这份文件里那是失败。 */
function fakeDriver(): void {
  mockSizeOf.mockResolvedValue(OBJECT_SIZE);
  mockReadStream.mockImplementation(async (_key: string, range?: { start: number; end: number }) => {
    if (!range) {
      throw new Error("whole-object read — the proxy must never buffer a 300 MB object for a Range request");
    }
    const span = new Uint8Array(range.end - range.start + 1).map((_, i) => byteAt(range.start + i));
    return (async function* () {
      // 分块吐,像真驱动一样 —— 路由不许假设「一次一整块」。
      const CHUNK = 64 * 1024;
      for (let off = 0; off < span.length; off += CHUNK) yield span.subarray(off, Math.min(off + CHUNK, span.length));
    })();
  });
}

const { GET } = await import("@/app/api/media/pub/[token]/route");

const SECRET = "media-secret-range";
const HASH = "a".repeat(64);
const KEY = `u/orgA/${HASH}.jpg`;

function req(ip: string, headers: Record<string, string> = {}): NextRequest {
  return {
    url: "http://x/api/media/pub",
    headers: new Headers({ "x-forwarded-for": ip, ...headers }),
  } as unknown as NextRequest;
}
const token = () => signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);

/** 把响应体(一个 ReadableStream)全部读出来。 */
async function drain(res: { body: unknown }): Promise<Uint8Array> {
  const stream = res.body as ReadableStream<Uint8Array>;
  expect(stream).toBeInstanceOf(ReadableStream);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const headersOf = (res: { headers: unknown }) => res.headers as Record<string, string>;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.MEDIA_PROXY_SECRET = SECRET;
  fakeDriver();
  await prisma.rateLimitCounter.deleteMany({});
});

describe("SHARE-A1 —— 大对象的 Range 请求:206 + 只读那一段", () => {
  it("SHARE-A1 —— `Range: bytes=0-1048575` 回 206 + Content-Range,正文正好 1 MiB", async () => {
    const res = await GET(req("198.51.100.11", { range: "bytes=0-1048575" }), {
      params: Promise.resolve({ token: token() }),
    });

    expect(res.status).toBe(206);
    expect(headersOf(res)["Content-Range"]).toBe(`bytes 0-${MIB - 1}/${OBJECT_SIZE}`);
    expect(headersOf(res)["Content-Length"]).toBe(String(MIB));
    const body = await drain(res);
    expect(body.length).toBe(MIB);
    expect(body[0]).toBe(byteAt(0));
    expect(body[MIB - 1]).toBe(byteAt(MIB - 1));
  });

  it("SHARE-A1 —— 只向存储要那一段:整对象读一次都没发生(发生了这条就红)", async () => {
    await GET(req("198.51.100.12", { range: "bytes=0-1048575" }), { params: Promise.resolve({ token: token() }) });
    expect(mockReadStream).toHaveBeenCalledTimes(1);
    expect(mockReadStream).toHaveBeenCalledWith(KEY, { start: 0, end: MIB - 1 });
  });

  it("SHARE-A1 —— 中段 Range(播放器 seek)偏移正确,不是从头给 1 MiB", async () => {
    const start = 100 * MIB;
    const res = await GET(req("198.51.100.13", { range: `bytes=${start}-${start + 1023}` }), {
      params: Promise.resolve({ token: token() }),
    });
    expect(res.status).toBe(206);
    const body = await drain(res);
    expect(body.length).toBe(1024);
    expect(body[0]).toBe(byteAt(start));
  });

  it("SHARE-A1 —— 起点越过对象末尾回 416 + `Content-Range: bytes */size`,不悄悄回整条", async () => {
    const res = await GET(req("198.51.100.14", { range: `bytes=${OBJECT_SIZE}-` }), {
      params: Promise.resolve({ token: token() }),
    });
    expect(res.status).toBe(416);
    expect(headersOf(res)["Content-Range"]).toBe(`bytes */${OBJECT_SIZE}`);
    expect(mockReadStream).not.toHaveBeenCalled();
  });

  it("SHARE-A1 —— 越权仍然优先:伪造 token 带 Range 也只有 404,不碰存储", async () => {
    const res = await GET(req("198.51.100.15", { range: "bytes=0-1023" }), {
      params: Promise.resolve({ token: "garbage.sig" }),
    });
    expect(res.status).toBe(404);
    expect(mockSizeOf).not.toHaveBeenCalled();
    expect(mockReadStream).not.toHaveBeenCalled();
  });
});

describe("SHARE-A2 —— 不带 Range 的普通浏览器请求", () => {
  it("SHARE-A2 —— 200 + 流式正文,响应头与今天一致,并且宣告 Accept-Ranges", async () => {
    // 这一条要验的是「不带 Range 时照常给整条」,所以驱动换成会吐整条的那种。
    mockReadStream.mockImplementation(async (_key: string, range?: unknown) => {
      expect(range).toBeUndefined();
      return (async function* () {
        yield new Uint8Array([255, 216, 255]);
      })();
    });

    const res = await GET(req("198.51.100.16"), { params: Promise.resolve({ token: token() }) });

    expect(res.status).toBe(200);
    const h = headersOf(res);
    expect(h["Content-Type"]).toBe("image/jpeg");
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["Accept-Ranges"]).toBe("bytes");
    expect(await drain(res)).toEqual(new Uint8Array([255, 216, 255]));
  });

  it("SHARE-A2 —— 不带 Range 时连对象大小都不去问:存储调用次数与改造前一样是一次", async () => {
    mockReadStream.mockImplementation(async () =>
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    );
    await GET(req("198.51.100.17"), { params: Promise.resolve({ token: token() }) });
    expect(mockSizeOf).not.toHaveBeenCalled();
    expect(mockReadStream).toHaveBeenCalledTimes(1);
  });

  it("SHARE-A2 —— 认不出来的 Range 形状(多段)退回 200 整条,而不是报错", async () => {
    mockReadStream.mockImplementation(async (_key: string, range?: unknown) => {
      expect(range).toBeUndefined();
      return (async function* () {
        yield new Uint8Array([9]);
      })();
    });
    const res = await GET(req("198.51.100.18", { range: "bytes=0-99,200-299" }), {
      params: Promise.resolve({ token: token() }),
    });
    expect(res.status).toBe(200);
  });
});
