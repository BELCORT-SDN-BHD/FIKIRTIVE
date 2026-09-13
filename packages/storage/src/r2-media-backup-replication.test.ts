/**
 * MEDIA-durability(docs/specs/media-durability.md 已冻结 · v2)—— 写路径同步复制。
 *
 * 离线可测的那一半:`R2Storage.put()` 在主写成功后,同步把同一份字节复制进备份桶
 * (§1.2/§4)。真实 R2 演练(备份桶真的建好、真删一个对象再按手册恢复)不在这份文件的
 * 范围内 —— 那部分是 MEDIA-A2/A4/A5/A6/A7/A9 的 `it.todo`,在文件末尾。
 *
 * 测试手法:`R2Storage` 的构造函数只在 `new S3Client(cfg)` 里存一份配置,从不在构造期间
 * 发网络请求(AWS SDK v3 的 Client 是惰性的,只有 `.send()` 才会真的打网络)。所以这里用
 * 一个内存里的假 S3 客户端(只认 Put/Head/Get 三个命令)在构造之后把 private 字段换掉,
 * 就能让 `put()` 的真实代码路径(主写 → 复制 → 重试 → 失败即放行)完整跑一遍,而不需要
 * 起一个真正的对象存储(MinIO 或真 R2)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  PutObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { R2Storage, replicateWithRetry } from "./index.js";

interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

/** 内存版 S3:只实现这份文件用得到的三个命令,其余一律抛出说清楚缺什么。 */
class FakeS3 {
  readonly store = new Map<string, StoredObject>();
  /** 接下来这么多次 Put 都会先抛一次错,再恢复正常 —— 用来演练重试语义。 */
  failNextPuts = 0;
  putCalls = 0;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      this.putCalls++;
      if (this.failNextPuts > 0) {
        this.failNextPuts--;
        throw new Error("simulated transient R2 failure");
      }
      const { Key, Body, ContentType } = command.input;
      this.store.set(Key as string, { body: Body as Uint8Array, contentType: ContentType ?? "" });
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const obj = this.store.get(command.input.Key as string);
      if (!obj) {
        const err = new Error("NotFound") as Error & { name: string; $metadata: { httpStatusCode: number } };
        err.name = "NotFound";
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return { ContentLength: obj.body.length };
    }
    if (command instanceof GetObjectCommand) {
      const obj = this.store.get(command.input.Key as string);
      if (!obj) {
        const err = new Error("NoSuchKey") as Error & { name: string };
        err.name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToByteArray: async () => obj.body } };
    }
    throw new Error(`FakeS3: unsupported command ${(command as { constructor: { name: string } }).constructor.name}`);
  }
}

/** 构造一个用假客户端替换掉真 S3Client 的 R2Storage —— 构造期本身零网络。 */
function storeWithFakes(opts: { withBackup: boolean }): {
  store: R2Storage;
  primary: FakeS3;
  backup: FakeS3 | null;
} {
  const store = new R2Storage(
    { endpoint: "http://fake-primary.invalid", accessKeyId: "id", secretAccessKey: "secret", bucket: "content" },
    opts.withBackup
      ? { endpoint: "http://fake-backup.invalid", accessKeyId: "bid", secretAccessKey: "bsecret", bucket: "content-backup" }
      : null,
  );
  const primary = new FakeS3();
  const backup = opts.withBackup ? new FakeS3() : null;
  // 白盒注入:构造函数已经把两个 private 字段建好(真 S3Client 实例,惰性、零网络),
  // 这里原地换成内存假体,类型断言仅用于测试。
  (store as unknown as { client: S3Client }).client = primary as unknown as S3Client;
  if (backup) (store as unknown as { backupClient: S3Client | null }).backupClient = backup as unknown as S3Client;
  return { store, primary, backup };
}

describe("MEDIA-A1 —— 写后备份侧出现同键同哈希副本", () => {
  it("MEDIA-A1: put() 成功后,备份桶里出现同一个 key,字节与主桶完全一致(同哈希)", async () => {
    const { store, primary, backup } = storeWithFakes({ withBackup: true });
    const bytes = new TextEncoder().encode("MEDIA-A1 fixture bytes");

    const { key, contentHash } = await store.put("owner-1", bytes, "jpg");

    // 主桶写了(既有行为不变)
    expect(primary.store.has(key)).toBe(true);
    // 备份桶出现了同一个 key —— 因为 key 本身就是 u/<ownerId>/<sha256>.<ext>,同 key
    // 结构上就已经断言了同哈希;这里额外逐字节比对,证明搬过去的确实是同一份内容。
    expect(backup!.store.has(key)).toBe(true);
    expect(backup!.store.get(key)!.body).toEqual(bytes);
    expect(key).toContain(contentHash);
  });

  it("MEDIA-A1: 未配置 R2_MEDIA_BACKUP_* 时零副作用 —— 不建备份客户端、主写照常成功、不触碰任何备份桶", async () => {
    const { store, primary, backup } = storeWithFakes({ withBackup: false });
    expect(backup).toBeNull();
    const bytes = new TextEncoder().encode("no backup configured");

    const { key } = await store.put("owner-1", bytes, "png");

    expect(primary.store.has(key)).toBe(true); // 主写不受影响
    // 未配置时 backupClient 是 null——replicateToBackup 第一行就返回,连一次 send 都不会
    // 打给任何东西;这里用「primary 的 put 调用数恰好是 1 次」佐证复制路径确实短路了
    // (若误把复制打去了主桶,这里会变成 2)。
    expect(primary.putCalls).toBe(1);
  });

  it("MEDIA-A1(规格 §4 语义):复制失败重试一次仍失败 → 记录结构化错误 + 放行主写,put() 本身不抛错", async () => {
    const { store, primary, backup } = storeWithFakes({ withBackup: true });
    backup!.failNextPuts = 2; // 两次都失败——第一次尝试 + 唯一一次重试
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new TextEncoder().encode("backup outage fixture");

    const result = await store.put("owner-1", bytes, "jpg"); // 不应该抛

    expect(primary.store.has(result.key)).toBe(true); // 主写照常成功、照常放行
    expect(backup!.store.has(result.key)).toBe(false); // 备份两次都没成功,对象确实不在
    expect(backup!.putCalls).toBe(2); // 恰好尝试了一次 + 重试一次,不多不少
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ event: "media_backup_replication_failed", key: result.key });
    expect(logged.error).toMatch(/simulated transient R2 failure/);
    errorSpy.mockRestore();
  });

  it("MEDIA-A1(规格 §4 语义):第一次失败、重试成功 → 备份侧最终仍然拿到副本,不记录任何错误", async () => {
    const { store, backup } = storeWithFakes({ withBackup: true });
    backup!.failNextPuts = 1; // 只失败一次,重试那次成功
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new TextEncoder().encode("recovers on retry");

    const { key } = await store.put("owner-1", bytes, "jpg");

    expect(backup!.store.has(key)).toBe(true);
    expect(backup!.putCalls).toBe(2); // 失败的第一次 + 成功的重试
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("MEDIA-A1: 重复写入同一份内容(dedup 命中)不会对已在场的备份副本发起第二次复制", async () => {
    const { store, backup } = storeWithFakes({ withBackup: true });
    const bytes = new TextEncoder().encode("dedup content");
    const first = await store.put("owner-1", bytes, "jpg");
    expect(backup!.putCalls).toBe(1);

    const second = await store.put("owner-1", bytes, "jpg"); // 同 owner + 同字节 ⇒ 同 key,主桶 exists() 命中

    expect(second.key).toBe(first.key);
    expect(backup!.putCalls).toBe(1); // dedup 分支在主写之前就返回,复制代码根本没跑第二次
  });
});

/**
 * MEDIA-A1(判官第二轮 P1-5,Founder 2026-09-13 已裁选项 (a))—— `copyToBackup()`。
 *
 * 直传上传的字节从浏览器直接进内容桶,从不经过 `put()`,所以上面那组测试用的
 * `storeWithFakes`(只认 Put/Head/Get 三个命令)不够用:这里要证明的是**服务器发起的
 * 跨桶 CopyObject**,源桶(内容桶)与目的桶(备份桶)是两个不同的假客户端,CopyObject 只发
 * 给备份桶那一个,`x-amz-copy-source` 指回内容桶同 key。
 *
 * 用一个共享的「多桶内存存储」(bucket 名 → key → 对象)来模拟——PutObjectCommand /
 * HeadObjectCommand / GetObjectCommand 按各自的 Bucket 字段读写对应的桶,CopyObjectCommand
 * 解析 CopySource(`<bucket>/<key>`,与真实 S3 一致地做 URI 解码)从源桶读、写进目的桶。
 */
describe("MEDIA-A1 —— copyToBackup() 服务器端跨桶复制(直传上传收尾用)", () => {
  interface StoredObject2 {
    body: Uint8Array;
    contentType?: string;
  }

  /** 按 Bucket 字段路由到各自的 Map;CopyObjectCommand 额外支持跨桶读源。 */
  class FakeBucketedS3 {
    constructor(private buckets: Map<string, Map<string, StoredObject2>>) {}
    /** 接下来这么多次 CopyObject 都先抛一次错,再恢复正常 —— 演练重试语义。 */
    failNextCopies = 0;
    copyCalls = 0;

    private bucket(name: string): Map<string, StoredObject2> {
      let b = this.buckets.get(name);
      if (!b) {
        b = new Map();
        this.buckets.set(name, b);
      }
      return b;
    }

    async send(command: unknown): Promise<unknown> {
      if (command instanceof CopyObjectCommand) {
        this.copyCalls++;
        if (this.failNextCopies > 0) {
          this.failNextCopies--;
          throw new Error("simulated transient R2 failure (copy)");
        }
        const { Bucket, Key, CopySource } = command.input as { Bucket: string; Key: string; CopySource: string };
        // NEW-P2-2(判官第三轮):生产代码不再对 CopySource 做 URL 编码——这里的假体也去掉
        // 对应的 decodeURIComponent,与 `${sourceBucket}/${key}` 的拼接方式保持自洽。第一个
        // "/" 就是桶名与 key 的分界(桶名本身不含 "/",key 自己的路径分隔符都在这刀之后)。
        const slash = CopySource!.indexOf("/");
        const srcBucket = CopySource!.slice(0, slash);
        const srcKey = CopySource!.slice(slash + 1);
        const src = this.bucket(srcBucket).get(srcKey);
        if (!src) {
          const err = new Error("NoSuchKey") as Error & { name: string };
          err.name = "NoSuchKey";
          throw err;
        }
        this.bucket(Bucket).set(Key, { ...src });
        return {};
      }
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body, ContentType } = command.input as {
          Bucket: string;
          Key: string;
          Body: Uint8Array;
          ContentType?: string;
        };
        this.bucket(Bucket).set(Key, { body: Body, contentType: ContentType });
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const { Bucket, Key } = command.input as { Bucket: string; Key: string };
        const obj = this.bucket(Bucket).get(Key);
        if (!obj) {
          const err = new Error("NotFound") as Error & { name: string; $metadata: { httpStatusCode: number } };
          err.name = "NotFound";
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return { ContentLength: obj.body.length };
      }
      throw new Error(`FakeBucketedS3: unsupported command ${(command as { constructor: { name: string } }).constructor.name}`);
    }
  }

  function storeWithBucketedFakes(opts: { withBackup: boolean }) {
    const shared = new Map<string, Map<string, StoredObject2>>();
    const store = new R2Storage(
      { endpoint: "http://fake-primary.invalid", accessKeyId: "id", secretAccessKey: "secret", bucket: "content" },
      opts.withBackup
        ? { endpoint: "http://fake-backup.invalid", accessKeyId: "bid", secretAccessKey: "bsecret", bucket: "content-backup" }
        : null,
    );
    const primary = new FakeBucketedS3(shared);
    const backup = opts.withBackup ? new FakeBucketedS3(shared) : null;
    (store as unknown as { client: S3Client }).client = primary as unknown as S3Client;
    if (backup) (store as unknown as { backupClient: S3Client | null }).backupClient = backup as unknown as S3Client;
    return { store, primary, backup, shared };
  }

  // NEW-P3-2(判官第三轮):copyToBackup() 首行加了 parseStorageKey(key),所以这里的示例 key
  // 必须是真的合法形状(64 位十六进制哈希),不能再用 "deadbeef" 这种 8 位占位符——否则还没
  // 走到复制逻辑就会在 parseStorageKey 那一步被拒收。
  const FAKE_HASH = "deadbeef".repeat(8); // 8 × 8 = 64 位十六进制,parseStorageKey 认

  it("成功复制:内容桶里已有的对象,copyToBackup() 后在备份桶出现同 key、同字节", async () => {
    const { store, shared } = storeWithBucketedFakes({ withBackup: true });
    const bytes = new TextEncoder().encode("direct-upload fixture bytes");
    const key = `u/owner-1/${FAKE_HASH}.jpg`;
    shared.set("content", new Map([[key, { body: bytes, contentType: "image/jpeg" }]])); // 模拟浏览器直传已落地

    await store.copyToBackup(key);

    expect(shared.get("content-backup")?.get(key)?.body).toEqual(bytes);
  });

  it("失败重试后仍失败:记同一个结构化事件(path:finalize-copy),不抛错", async () => {
    const { store, backup, shared } = storeWithBucketedFakes({ withBackup: true });
    const key = `u/owner-1/${FAKE_HASH}.jpg`;
    shared.set("content", new Map([[key, { body: new TextEncoder().encode("x") }]]));
    backup!.failNextCopies = 2; // 首次 + 唯一一次重试都失败
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(store.copyToBackup(key)).resolves.toBeUndefined(); // 不抛

    expect(shared.get("content-backup")?.has(key) ?? false).toBe(false);
    expect(backup!.copyCalls).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ event: "media_backup_replication_failed", path: "finalize-copy", key });
    errorSpy.mockRestore();
  });

  it("未配置备份(backupClient 为 null)时零副作用:不发任何 CopyObject", async () => {
    const { store, backup } = storeWithBucketedFakes({ withBackup: false });
    expect(backup).toBeNull();

    await expect(store.copyToBackup(`u/owner-1/${FAKE_HASH}.jpg`)).resolves.toBeUndefined();
    // 没有 backupClient 可断言「没打」,但也没有任何东西可以打——同 replicateToBackup
    // 未配置时的短路语义(first line returns)。
  });

  it("NEW-P3-2:键写错(不是合法的 u/<ownerId>/<64hex>.<ext> 形状)→ 当场拒绝,连备份桶都没碰", async () => {
    const { store, backup } = storeWithBucketedFakes({ withBackup: true });

    await expect(store.copyToBackup("not-a-fikirtive-storage-key")).rejects.toThrow(/not a fikirtive storage key/);

    expect(backup!.copyCalls).toBe(0); // parseStorageKey 在网络请求之前就拒收了
  });
});

describe("replicateWithRetry —— 复制重试/放行时序的纯函数验证(规格 §4)", () => {
  it("首次成功:只调用一次,onFailure 不触发", async () => {
    const attempt = vi.fn(async () => {});
    const onFailure = vi.fn();
    await replicateWithRetry(attempt, onFailure);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("第一次失败、第二次成功:重试一次即止,onFailure 不触发", async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("first attempt fails");
    });
    const onFailure = vi.fn();
    await replicateWithRetry(attempt, onFailure);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("两次都失败:恰好尝试两次(1 原始 + 1 重试),然后 onFailure 收到第二次的错误,函数本身不抛", async () => {
    const err2 = new Error("second attempt fails too");
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      throw calls === 1 ? new Error("first attempt fails") : err2;
    });
    const onFailure = vi.fn();
    await expect(replicateWithRetry(attempt, onFailure)).resolves.toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(err2);
  });
});

/**
 * 真桶演练相关的验收条目:施工票面(#1385)指明这些要等 Founder 建好 staging/production
 * 的备份桶、发凭据之后才能真跑,离线的这次施工里用 `it.todo` 占位。机器闸已废止
 * (2026-09-13),这份 todo 清单现在是唯一的未证验收台账——没有别的机制替它盯着「这些编号
 * 到底跑没跑」,谁要清掉一条就得真把对应的桶/凭据/演练做完。
 */
it.todo("MEDIA-A2 —— 备份桶 lifecycle 规则(全量保留)与主/备份差集比对命令(等 Founder 建桶)");
it.todo("MEDIA-A3 —— Founder 随手挑一个人照 media-restore.md 从头走一遍,不许问人(人工演练,非自动化测试)");
it.todo("MEDIA-A4 —— 在 staging 桶删掉一个已付费产物、按手册从备份桶真实恢复,哈希比对通过(等 Founder 建桶)");
it.todo("MEDIA-A5 —— docs/runbooks/media-restore.md 末尾演练记录留证(日期/执行者/对象键/RTO/命令输出片段)");
it.todo("MEDIA-A6 —— 演练前后 CreditLedger 快照逐笔一致,钱守恒(等真实演练环境与账本数据)");
it.todo("MEDIA-A7 —— 生产桶与生产备份桶只读核验(复制已生效 + 差集状态),生产零删除(等 Founder 建生产备份桶)");
it.todo("MEDIA-A8 —— Founder 在 beta-gate.md GATE-A6 处核验本规格证据满足判定(人工裁决,非自动化测试)");
it.todo("MEDIA-A9 —— 演练故意用非目标租户对象键试恢复,手册前缀核对拦停(等真实演练环境)");
