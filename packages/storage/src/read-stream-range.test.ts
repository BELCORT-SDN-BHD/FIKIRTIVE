/**
 * SHARE-A1(docs/specs/share-preview.md 已冻结 · v1)—— `readStream` 的字节区间参数。
 *
 * 公开媒体代理今天是 `storage.get()` 整块读进内存再 `Buffer.from`,一次合法的大预览请求
 * 就能在 web 进程里摊开一个上限 2 GB 的对象(#1053 发现 1)。区间参数是把那条路改成
 * 「要哪一段读哪一段」的地基:这份文件在**真实文件系统**上验区间读本身,路由那一层的
 * 206/Content-Range 在 apps/web 的路由测试里验。
 *
 * 不带区间的老调用(worker 的哈希复核 `ingest.ts`、`readBoundedPrefix`)必须一字不变 ——
 * 第二个用例就是那条保证。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDiskStorage } from "./index.js";

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe("SHARE-A1 —— storage.readStream 的字节区间参数", () => {
  let root: string;
  let store: LocalDiskStorage;
  let key: string;
  // 一段够大、每个位置都能自证位置的内容:第 i 个字节 = i % 251。读错了偏移一眼看得出来。
  const SIZE = 300_000;
  const CONTENT = new Uint8Array(SIZE).map((_, i) => i % 251);

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fikirtive-range-test-"));
    store = new LocalDiskStorage(root);
    ({ key } = await store.put("owner-1", CONTENT, "jpg"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("SHARE-A1 —— 带区间只读那一段字节(闭区间,含两端)", async () => {
    const bytes = await collect(await store.readStream(key, { start: 1000, end: 1999 }));
    expect(bytes.length).toBe(1000);
    expect(bytes).toEqual(CONTENT.subarray(1000, 2000));
  });

  it("SHARE-A1 —— 区间读出来的字节数不随对象大小上涨(第一个 1 MiB 的形状:只读前 N 字节)", async () => {
    const bytes = await collect(await store.readStream(key, { start: 0, end: 65_535 }));
    expect(bytes.length).toBe(65_536);
    expect(bytes).toEqual(CONTENT.subarray(0, 65_536));
  });

  it("SHARE-A1 —— 区间顶到对象末尾也只给存在的那些字节", async () => {
    const bytes = await collect(await store.readStream(key, { start: SIZE - 10, end: SIZE - 1 }));
    expect(bytes.length).toBe(10);
    expect(bytes).toEqual(CONTENT.subarray(SIZE - 10));
  });

  it("SHARE-A1 —— 不带区间的老调用一字不变:整对象顺序读出", async () => {
    const bytes = await collect(await store.readStream(key));
    expect(bytes.length).toBe(SIZE);
    expect(bytes).toEqual(CONTENT);
  });

  it("SHARE-A1 —— 颠倒或负数的区间是调用方的错,当场抛(绝不悄悄读成整对象)", async () => {
    await expect(store.readStream(key, { start: 100, end: 99 })).rejects.toThrow(/byte range/i);
    await expect(store.readStream(key, { start: -1, end: 10 })).rejects.toThrow(/byte range/i);
  });
});
