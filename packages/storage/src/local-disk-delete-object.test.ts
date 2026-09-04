/**
 * 2026-09-03 判官第一轮复审 P1-4 —— `LocalDiskStorage.deleteObject` 曾经吞掉**所有** fs
 * 错误,只有 ENOENT(对象本来就不存在)才是这份合同承诺的 no-op(见 `Storage.deleteObject`
 * 的接口注释与 `asset-purge.ts` 顶部的重跑安全性论证:「deleteObject 对已经不存在的对象是
 * 一次空操作」)。真实文件系统上的两条正常路径:真删除、对象本来就不存在。
 *
 * 非 ENOENT 错误必须往外抛这条路径,见同目录
 * `local-disk-delete-object-error-propagates.test.ts` —— 那份文件 mock 了 `node:fs/promises`
 * 的 `unlink`,`vi.mock` 会整份文件级别提升(hoist),不能跟这里的真实文件系统用例混在同一
 * 个文件里。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDiskStorage } from "./index.js";

const VALID_KEY = `u/owner-1/${"a".repeat(64)}.png`;

describe("LocalDiskStorage.deleteObject — real filesystem", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fikirtive-storage-test-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("deletes bytes that are actually on disk — the object is gone afterward", async () => {
    const storage = new LocalDiskStorage(root);
    const { key } = await storage.put("owner-1", new TextEncoder().encode("hello"), "png");
    expect(await storage.exists(key)).toBe(true);

    await storage.deleteObject(key);

    expect(await storage.exists(key)).toBe(false);
  });

  it("a genuinely missing object is a documented no-op — resolves without throwing", async () => {
    const storage = new LocalDiskStorage(root);
    expect(await storage.exists(VALID_KEY)).toBe(false);

    await expect(storage.deleteObject(VALID_KEY)).resolves.toBeUndefined();
  });

  it("deleting the SAME object twice is still a no-op the second time (the retry-safety asset-purge.ts relies on)", async () => {
    const storage = new LocalDiskStorage(root);
    const { key } = await storage.put("owner-1", new TextEncoder().encode("bye"), "png");

    await storage.deleteObject(key);
    await expect(storage.deleteObject(key)).resolves.toBeUndefined(); // second call: already-ENOENT, still a no-op
  });
});
