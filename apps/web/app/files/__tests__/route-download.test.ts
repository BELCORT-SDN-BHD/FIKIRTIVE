/**
 * 登记 2026-09-04 P0-2 —— 同源附件下载,服务端这一半。
 *
 * 走查里商家按「Download」的真实后果:浏览器被导航去 R2 的裸 mp4,人出了应用、片子没存下
 * (`download` 属性跨源被忽略)。修法是 `/files/<key>?download=1` 由我们自己把字节流回去,
 * 带 `Content-Disposition: attachment`。这一份守的就是那条新路:**该给的给,不该给的一个
 * 字节都不给**。
 *
 * 用真库(不是假件):两条 404 判定的分界线全在数据库里 —— 一条是别人家的素材,一条是已经
 * 删掉的素材。把 Prisma 换成假件,这两条断言就退化成「我写的 mock 返回 null」,证不了任何事。
 * 只有 storage 是假件:测试不该真的去 R2 拉字节。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@fikirtive/db";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ auth: vi.fn().mockResolvedValue({ user: { email: "a@test" } }) }));
vi.mock("@/lib/allowlist", () => ({ allowed: vi.fn().mockResolvedValue(true) }));

async function* bytes(): AsyncGenerator<Uint8Array> {
  yield new Uint8Array([137, 80, 78, 71]); // PNG magic
}
const mockReadStream = vi.fn(async () => bytes());
vi.mock("@/lib/storage", () => ({
  storage: {
    presignedGet: vi.fn().mockResolvedValue("https://bucket.r2.cloudflarestorage.com/signed"),
    get: vi.fn(),
    readStream: (...a: unknown[]) => mockReadStream(...(a as [])),
  },
  mimeOf: () => "image/png",
  kindOf: () => "image",
}));

const { GET } = await import("@/app/files/[...key]/route");

const ORG_A = "dl-org-a";
const ORG_B = "dl-org-b";
// 同一串内容哈希在两个 org 名下各有一行 —— 内容寻址是按 owner 去重的
// (`@@unique([ownerId, contentHash])`)。这不是巧合摆设:少了它,「他租户」这条断言
// 就算把租户闸拆掉也依然是绿的(查不到行也是 404),证不了闸在守什么。
const SHARED = "a".repeat(64);
const GONE = "b".repeat(64);

function req(key: string, query = ""): NextRequest {
  return { headers: { get: () => null }, url: `http://x/files/${key}${query}` } as unknown as NextRequest;
}
const call = (key: string, query = "") =>
  GET(req(key, query), { params: Promise.resolve({ key: key.split("/") }) });
const headersOf = (res: { headers: unknown }) => res.headers as Record<string, string>;

beforeAll(async () => {
  for (const id of [ORG_A, ORG_B]) {
    await prisma.organization.upsert({ where: { id }, update: {}, create: { id, name: id } });
  }
  const asset = (id: string, ownerId: string, contentHash: string, deletedAt: Date | null) => ({
    id, ownerId, contentHash, ext: "png", mime: "image/png", sizeBytes: BigInt(4), deletedAt,
  });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [ORG_A, ORG_B] } } });
  await prisma.asset.createMany({
    data: [
      asset("dl-a-live", ORG_A, SHARED, null),
      asset("dl-b-live", ORG_B, SHARED, null),
      asset("dl-a-gone", ORG_A, GONE, new Date()),
    ],
  });
  mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: ORG_A });
});

afterAll(async () => {
  await prisma.asset.deleteMany({ where: { ownerId: { in: [ORG_A, ORG_B] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("/files?download=1 —— 登记 2026-09-04 P0-2:同源附件下载", () => {
  it("登记 2026-09-04 P0-2:本租户的素材,200 + attachment 头 + 人话文件名", async () => {
    const res = await call(`u/${ORG_A}/${SHARED}.png`, "?download=1&name=red-sneakers-1.png");
    expect(res.status).toBe(200);
    const headers = headersOf(res);
    expect(headers["Content-Disposition"]).toBe('attachment; filename="red-sneakers-1.png"');
    expect(headers["Content-Type"]).toBe("image/png");
    expect(mockReadStream).toHaveBeenCalledWith(`u/${ORG_A}/${SHARED}.png`);
  });

  it("登记 2026-09-04 P0-2:R2 的地址一次都不交给浏览器(不是 302,是字节)", async () => {
    const res = await call(`u/${ORG_A}/${SHARED}.png`, "?download=1");
    expect(res.status).toBe(200); // 302 = 预签名地址落到浏览器手里,正是要修的那个洞
    expect(JSON.stringify(headersOf(res))).not.toContain("r2.cloudflarestorage.com");
  });

  it("登记 2026-09-04 P0-2:文件名洗过 —— 响应头里塞不进引号或换行", async () => {
    const res = await call(`u/${ORG_A}/${SHARED}.png`, `?download=1&name=${encodeURIComponent('a"\r\nX-Injected: 1')}`);
    const disposition = headersOf(res)["Content-Disposition"]!;
    expect(disposition).not.toContain('"a"');
    expect(disposition).not.toContain("\n");
    expect(disposition).not.toContain("X-Injected: 1");
  });

  it("登记 2026-09-04 P0-2:名字洗空了也不会存成无后缀文件", async () => {
    const res = await call(`u/${ORG_A}/${SHARED}.png`, "?download=1&name=%E4%B8%AD%E6%96%87");
    expect(headersOf(res)["Content-Disposition"]).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.png"$/u);
  });

  it("登记 2026-09-04 P0-2:他租户的 key,404,一个字节不发", async () => {
    mockReadStream.mockClear();
    const res = await call(`u/${ORG_B}/${SHARED}.png`, "?download=1");
    expect(res.status).toBe(404);
    expect(mockReadStream).not.toHaveBeenCalled();
  });

  it("登记 2026-09-04 P0-2:已删掉的素材,404 —— 旧链接拖不回来", async () => {
    mockReadStream.mockClear();
    const res = await call(`u/${ORG_A}/${GONE}.png`, "?download=1");
    expect(res.status).toBe(404);
    expect(mockReadStream).not.toHaveBeenCalled();
  });

  it("登记 2026-09-04 P0-2:没写 ?download=1 的老路一个字没动(照旧 302 去预签名地址)", async () => {
    const res = await call(`u/${ORG_A}/${SHARED}.png`);
    expect(res.status).toBe(302);
  });
});
