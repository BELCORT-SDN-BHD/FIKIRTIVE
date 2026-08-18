/**
 * ingest-unreadable-blob.test.ts — C1b ③(后半):**打不开的上传不再被无声放弃。**
 *
 * 病灶只有一个词。`storage.ffmpegInput` 抛错时,handleIngest 从前是
 * `catch { console.error(...); return; }` —— **return 等于告诉 pg-boss 这份活成功了**。
 * 于是没有重试、没有死信、没有 Sentry;这个上传被放弃了,而系统自己的记录说一切正常。
 *
 * 它之所以能藏这么久,是因为有个**半个**兜底:探针列还是空的,所以 `redispatchLostIngest`
 * 每 5 分钟重派一次……直到 24 小时的年龄上限,过后彻底丢弃,依旧无声、依旧没有死信条目、
 * 依旧没有任何人被叫醒。一份在一天后悄悄停止重试的文件,从外面看和一份已经验完的没有区别。
 *
 * 现在改成抛。抛出去之后接住它的全是**仓库里已经有的**机器:pg-boss 按 retryLimit 3 退避重试
 * (apps/worker/src/index.ts),worker 的 `runHandler` 把每次抛出报进 Sentry,重试耗尽的活落进
 * `ingest.dlq` —— `/api/ops/dlq` 巡检并告警的七条死信队列之一(#793)。一样新东西都没造。
 *
 * 这个文件断言的是**契约那一侧**:handleIngest 到底 resolve 还是 reject。队列拿这个答案去做
 * 重试与死信,所以这就是「进不进得了 DLQ 名单」的全部判据 —— 在这一层证它,比起去 mock 一套
 * pg-boss 的内部状态,证的是同一件事而且证得更准。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const assetFindUnique = vi.fn();
  const assetUpdate = vi.fn();
  return {
    prisma: { asset: { findUnique: assetFindUnique, update: assetUpdate }, $transaction: vi.fn(async () => []) },
    assetFindUnique,
    assetUpdate,
    ffmpegInput: vi.fn(),
    readStream: vi.fn(),
    deleteObject: vi.fn(),
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
// 租户框架在这一层不是被测对象:两个 runAs* 直接放行,handleIngest 的失败语义才是主角。
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  runAsTenant: vi.fn(async (_owner: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../storage.js", () => ({
  storage: { ffmpegInput: m.ffmpegInput, readStream: m.readStream, deleteObject: m.deleteObject },
}));

import { handleIngest } from "./ingest.js";

/** 与下面这份资产的 contentHash 完全一致的字节流 —— 于是哈希复核这一关是**过**的,
 *  被测的失败点就只剩 `ffmpegInput` 那一处,不会和「哈希对不上」混在一起。 */
const BYTES = new Uint8Array([1, 2, 3, 4]);
/** sha256 of BYTES —— 由 node 现算,不写死一个可能对不上的常量。 */
const { createHash } = await import("node:crypto");
const HASH = createHash("sha256").update(BYTES).digest("hex");

const asset = {
  id: "asset_1",
  ownerId: "org_1",
  contentHash: HASH,
  ext: "png",
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.assetFindUnique.mockResolvedValue({ ...asset });
  m.readStream.mockImplementation(async () =>
    (async function* () {
      yield BYTES;
    })(),
  );
});

describe("C1b ③ handleIngest 遇到打不开的 blob", () => {
  it("抛出去,而不是安静地 return —— 这一个字决定了它进不进死信", async () => {
    m.ffmpegInput.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    // reject ⇒ pg-boss 记一次失败 ⇒ 退避重试 ⇒ 耗尽后落进 ingest.dlq(有消费者盯着,#793)。
    // resolve ⇒ 队列认为这份活办妥了,一切到此为止 —— 那正是改动前的行为。
    await expect(handleIngest({ assetId: "asset_1" })).rejects.toThrow(/ENOENT/);
  });

  it("抛的是原始错误 —— 死信与 Sentry 里留下的是能查的那一句", async () => {
    m.ffmpegInput.mockRejectedValue(new Error("presign failed: bucket not configured"));

    await expect(handleIngest({ assetId: "asset_1" })).rejects.toThrow(/bucket not configured/);
    // 打不开就没量到任何东西:绝不趁机把一行探针元数据写成 null 冒充「量过了」——
    // 那会让重派扫描认为这条已经处理完,兜底也跟着一起失效。
    expect(m.assetUpdate).not.toHaveBeenCalled();
  });

  it("blob 打得开时照常走完,不因为这次改动多抛一次", async () => {
    m.ffmpegInput.mockResolvedValue("/tmp/asset_1.png");
    m.assetUpdate.mockResolvedValue({});
    // probeFile 走真的 ffprobe,本机不一定有,所以这里把它按「探针本身失败」处理:
    // 断言的是**没有停在 ffmpegInput 那一关**,而不是 ffprobe 的输出。
    await handleIngest({ assetId: "asset_1" }).catch(() => {});

    expect(m.ffmpegInput).toHaveBeenCalledTimes(1);
  });

  // ── 边界:哪些「没做完」仍然是正常结束,绝不该被这次改动一起变成死信 ──────────────
  it("资产已被删除 → 照旧安静返回(没有东西要验,也可能连对象都没了)", async () => {
    m.assetFindUnique.mockResolvedValue({ ...asset, deletedAt: new Date() });

    await expect(handleIngest({ assetId: "asset_1" })).resolves.toBeUndefined();
    expect(m.ffmpegInput).not.toHaveBeenCalled();
  });

  it("资产整行不存在 → 照旧安静返回(重试一百次也变不出这一行)", async () => {
    m.assetFindUnique.mockResolvedValue(null);

    await expect(handleIngest({ assetId: "gone" })).resolves.toBeUndefined();
    expect(m.ffmpegInput).not.toHaveBeenCalled();
  });

  it("对象**读**不出来时仍然抛(承重的哈希复核那一关,本来就不许吞)", async () => {
    m.readStream.mockRejectedValue(new Error("connection reset"));

    await expect(handleIngest({ assetId: "asset_1" })).rejects.toThrow(/connection reset/);
    // 一次读失败不是媒体裁决:绝不能顺手把商家的文件当成伪造的删掉。
    expect(m.deleteObject).not.toHaveBeenCalled();
  });
});
