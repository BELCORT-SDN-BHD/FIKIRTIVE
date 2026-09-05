/**
 * 2026-09-03 判官第一轮复审 P1-4 —— 非 ENOENT 的 fs 错误必须往外抛,不能被
 * `LocalDiskStorage.deleteObject` 吞掉。这条路径没法用真实文件系统在 CI 上可靠复现
 * (权限错误依平台、依运行用户而异——CI 常以 root 跑,`chmod` 挡不住它),所以这里 mock
 * `node:fs/promises` 的 `unlink`。`vi.mock` 是整份文件级别提升(hoist)的,故意跟真实
 * 文件系统的用例(`local-disk-delete-object.test.ts`)分成两个文件,免得互相污染。
 *
 * 变异证据:把 `packages/storage/src/index.ts` 的 `deleteObject` 改回旧版(catch 里什么都
 * 不检查、直接吞掉一切)会让下面「EACCES 往外抛」与「无 code 的普通错误往外抛」这两条
 * 断言从「resolves/rejects」的 reject 分支掉进 resolve 分支,直接转红。
 */
import { describe, it, expect, vi } from "vitest";

const unlinkMock = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: (...args: Parameters<typeof actual.unlink>) => unlinkMock(...args),
  };
});

const { LocalDiskStorage } = await import("./index.js");

const VALID_KEY = `u/owner-1/${"a".repeat(64)}.png`;

describe("LocalDiskStorage.deleteObject — a non-ENOENT fs error is NOT swallowed", () => {
  it("EACCES (permission denied) propagates — the caller must not believe the bytes are gone", async () => {
    const storage = new LocalDiskStorage("/does-not-matter");
    const eacces = Object.assign(new Error("EACCES: permission denied, unlink"), { code: "EACCES" });
    unlinkMock.mockRejectedValueOnce(eacces);

    await expect(storage.deleteObject(VALID_KEY)).rejects.toBe(eacces);
  });

  it("ENOENT through the SAME mocked call site still resolves — the mock proves both branches", async () => {
    const storage = new LocalDiskStorage("/does-not-matter");
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, unlink"), { code: "ENOENT" });
    unlinkMock.mockRejectedValueOnce(enoent);

    await expect(storage.deleteObject(VALID_KEY)).resolves.toBeUndefined();
  });

  it("a generic failure with no .code at all also propagates rather than being swallowed", async () => {
    const storage = new LocalDiskStorage("/does-not-matter");
    const weird = new Error("disk exploded");
    unlinkMock.mockRejectedValueOnce(weird);

    await expect(storage.deleteObject(VALID_KEY)).rejects.toBe(weird);
  });
});
