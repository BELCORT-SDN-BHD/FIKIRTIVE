/**
 * MEDIA-durability(判官第二轮 P1-3)—— `mediaBackupR2Config()` 零测试的缺口。
 *
 * 形状照抄 `apps/worker/src/backup-credentials.test.ts` 对 `opsR2Config()` 的测法(同一个
 * "半配是硬错误,从不静默回退"的契约,只是这里管的是 R2_MEDIA_BACKUP_* 这一组、default
 * fallback 到 R2_ENDPOINT 而不是 R2_BUCKET/R2_ACCESS_KEY_ID 那一组)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mediaBackupR2Config } from "./index.js";

const KEYS = [
  "R2_ENDPOINT",
  "R2_MEDIA_BACKUP_ACCESS_KEY_ID",
  "R2_MEDIA_BACKUP_SECRET_ACCESS_KEY",
  "R2_MEDIA_BACKUP_BUCKET",
  "R2_MEDIA_BACKUP_ENDPOINT",
  "R2_FORCE_PATH_STYLE",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe("mediaBackupR2Config —— R2_MEDIA_BACKUP_* 半配是硬错误,从不静默回退", () => {
  it("全不设 → null(复制特性关闭,刻意的允许状态)", () => {
    expect(mediaBackupR2Config()).toBeNull();
  });

  it("缺 R2_MEDIA_BACKUP_ACCESS_KEY_ID → 抛 partially set", () => {
    process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY = "secret";
    process.env.R2_MEDIA_BACKUP_BUCKET = "fikirtive-media-backup";
    expect(() => mediaBackupR2Config()).toThrow(/partially set/);
  });

  it("缺 R2_MEDIA_BACKUP_SECRET_ACCESS_KEY → 抛 partially set", () => {
    process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID = "key";
    process.env.R2_MEDIA_BACKUP_BUCKET = "fikirtive-media-backup";
    expect(() => mediaBackupR2Config()).toThrow(/partially set/);
  });

  it("缺 R2_MEDIA_BACKUP_BUCKET → 抛 partially set", () => {
    process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID = "key";
    process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY = "secret";
    expect(() => mediaBackupR2Config()).toThrow(/partially set/);
  });

  it("只设 R2_MEDIA_BACKUP_ENDPOINT(孤立的路由变量,凭据一个都没给)→ 抛 partially set", () => {
    process.env.R2_MEDIA_BACKUP_ENDPOINT = "https://other.r2.cloudflarestorage.com";
    expect(() => mediaBackupR2Config()).toThrow(/partially set/);
  });

  it("凭据 + bucket 三件齐,没设 R2_MEDIA_BACKUP_ENDPOINT 但有 R2_ENDPOINT → 回落成功", () => {
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID = "key";
    process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY = "secret";
    process.env.R2_MEDIA_BACKUP_BUCKET = "fikirtive-media-backup";
    const cfg = mediaBackupR2Config();
    expect(cfg).toMatchObject({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "fikirtive-media-backup",
    });
  });

  it("R2_MEDIA_BACKUP_ENDPOINT 与 R2_ENDPOINT 两者皆无 → 抛错(没有端点可用)", () => {
    process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID = "key";
    process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY = "secret";
    process.env.R2_MEDIA_BACKUP_BUCKET = "fikirtive-media-backup";
    expect(() => mediaBackupR2Config()).toThrow(/R2_MEDIA_BACKUP_ENDPOINT/);
  });

  it("三件齐 + 自带 R2_MEDIA_BACKUP_ENDPOINT → 用自己的端点,不回落 R2_ENDPOINT", () => {
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID = "key";
    process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY = "secret";
    process.env.R2_MEDIA_BACKUP_BUCKET = "fikirtive-media-backup";
    process.env.R2_MEDIA_BACKUP_ENDPOINT = "https://other.r2.cloudflarestorage.com";
    const cfg = mediaBackupR2Config();
    expect(cfg?.endpoint).toBe("https://other.r2.cloudflarestorage.com");
  });
});
