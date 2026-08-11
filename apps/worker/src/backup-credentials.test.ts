/**
 * #794 ④ — 备份凭据隔离的行为测试。
 *
 * 债 #2 的原话之一是「备份与内容同 bucket 同钥匙」:偷到应用那把钥匙的人,同时也拿到了
 * 那些本来是用来在内容丢了之后救命的备份。隔离凭据要真的有用,只能靠**这一件事**成立:
 * 「以为隔离了但其实没有」必须不可能发生。所以半套配置是硬错误,不是静默回退。
 *
 * 从 worker 侧测,而不是从 packages/storage 测:worker 是唯一的调用方,
 * 而且 storage 包没有自己的测试跑手(它的契约一贯由调用方的行为测试盯着)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOpsBucket, opsR2Config } from "@fikirtive/storage";

const R2_KEYS = [
  "STORAGE_DRIVER",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_BACKUP_ENDPOINT",
  "R2_BACKUP_ACCESS_KEY_ID",
  "R2_BACKUP_SECRET_ACCESS_KEY",
  "R2_BACKUP_BUCKET",
  "R2_FORCE_PATH_STYLE",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(R2_KEYS.map((k) => [k, process.env[k]]));
  for (const k of R2_KEYS) delete process.env[k];
  process.env.STORAGE_DRIVER = "r2";
  process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
  process.env.R2_ACCESS_KEY_ID = "content-key";
  process.env.R2_SECRET_ACCESS_KEY = "content-secret";
  process.env.R2_BUCKET = "fikirtive";
});

afterEach(() => {
  for (const k of R2_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe("opsR2Config — which key writes the backups", () => {
  it("without R2_BACKUP_*, backups share the content credential and SAY so", () => {
    const cfg = opsR2Config();
    expect(cfg.mode).toBe("shared");
    expect(cfg.accessKeyId).toBe("content-key");
    expect(cfg.bucket).toBe("fikirtive");
  });

  it("with both halves of R2_BACKUP_*, backups use the isolated credential", () => {
    process.env.R2_BACKUP_ACCESS_KEY_ID = "backup-key";
    process.env.R2_BACKUP_SECRET_ACCESS_KEY = "backup-secret";
    const cfg = opsR2Config();
    expect(cfg.mode).toBe("isolated");
    expect(cfg.accessKeyId).toBe("backup-key");
    expect(cfg.secretAccessKey).toBe("backup-secret");
    // same bucket by default — a scoped token against the SAME bucket is the whole point
    expect(cfg.bucket).toBe("fikirtive");
    expect(cfg.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
  });

  it("an isolated credential may also point at a different bucket/endpoint", () => {
    process.env.R2_BACKUP_ACCESS_KEY_ID = "backup-key";
    process.env.R2_BACKUP_SECRET_ACCESS_KEY = "backup-secret";
    process.env.R2_BACKUP_BUCKET = "fikirtive-backups";
    process.env.R2_BACKUP_ENDPOINT = "https://other.r2.cloudflarestorage.com";
    const cfg = opsR2Config();
    expect(cfg.mode).toBe("isolated");
    expect(cfg.bucket).toBe("fikirtive-backups");
    expect(cfg.endpoint).toBe("https://other.r2.cloudflarestorage.com");
  });

  it("REFUSES a half-set isolated credential instead of silently falling back", () => {
    // The one belief this whole item exists to prevent: "we isolated the backups"
    // when a typo'd variable name means we did not. A silent fallback to the shared
    // key would produce exactly that belief and nothing would ever contradict it.
    process.env.R2_BACKUP_ACCESS_KEY_ID = "backup-key";
    expect(() => opsR2Config()).toThrow(/must be set together/);

    delete process.env.R2_BACKUP_ACCESS_KEY_ID;
    process.env.R2_BACKUP_SECRET_ACCESS_KEY = "backup-secret";
    expect(() => opsR2Config()).toThrow(/must be set together/);
  });

  it("still refuses an incomplete BASE r2 config (pre-existing guard, unchanged)", () => {
    delete process.env.R2_BUCKET;
    expect(() => opsR2Config()).toThrow(/R2_ENDPOINT\/R2_ACCESS_KEY_ID/);
  });
});

describe("createOpsBucket — the mode travels with the bucket", () => {
  it("is null when the driver is not r2 (local dev has no backup target)", () => {
    process.env.STORAGE_DRIVER = "local";
    expect(createOpsBucket()).toBeNull();
  });

  it("carries credentialMode so the caller records what actually wrote the backup", () => {
    expect(createOpsBucket()?.credentialMode).toBe("shared");
    process.env.R2_BACKUP_ACCESS_KEY_ID = "backup-key";
    process.env.R2_BACKUP_SECRET_ACCESS_KEY = "backup-secret";
    expect(createOpsBucket()?.credentialMode).toBe("isolated");
  });

  it("still refuses any key outside the backups/ prefix", async () => {
    const ops = createOpsBucket()!;
    await expect(ops.exists("u/founder/leak.mp4")).rejects.toThrow(/not an ops key/);
  });
});
