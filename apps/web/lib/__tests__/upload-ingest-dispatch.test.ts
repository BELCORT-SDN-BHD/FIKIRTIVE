/**
 * upload-ingest-dispatch.test.ts — C1b ③(前半):**直传的 hash 验证派工失败,不再无声无息。**
 *
 * 背景:直传路径上,商家的浏览器把字节直接 PUT 进对象存储,`sha256` 只是**客户端的声明**。
 * 那个声明要变成事实,靠的是 finalize 之后派出去的那条 INGEST 活 —— worker 重新流式算一遍
 * 哈希,对不上就删。所以这条派工是**承重**的安全动作,不是记账。
 *
 * 改动前那段代码有两处病,都不在「派工会失败」这件事本身,而在失败之后:
 *
 *   ① 整个循环被一个 try/catch 包着。第二个资产派失败,第三、四、五个**根本没被尝试过**,
 *      而那行日志把五个 id 全列了出来 —— 记录在写下的同一瞬间就已经是错的。
 *   ② 唯一的后果是 `console.error`。server action 里的 console 只到平台日志为止,没有任何
 *      告警。「商家的文件带着未经证明的哈希上线了」这个信号,写进了没人看的那条流。
 *
 * 这个文件把两处都钉住。**没有**改的那一半也一并钉住并写明理由:动作仍然回 `ok` ——
 * 行确实已经提交、文件确实已经在商家的素材库里,告诉他们「失败了」是另一个谎,而且是那种
 * 会让人再传一遍的谎。缺的从来不是商家那一半,是我们这一半。
 *
 * 兜底的重试早就存在,也正是「派丢了还能救回来」的全部依据:`redispatchLostIngest`
 * (apps/worker/src/jobs/ingest.ts)每 5 分钟扫一遍探针元数据仍然全空的 UPLOAD 资产并重派。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOwner, mockStorage, mockSend, mockCaptureMessage } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockStorage: {
    supportsDirectUpload: true,
    exists: vi.fn(),
    put: vi.fn(),
    presignedPut: vi.fn(),
    createMultipart: vi.fn(),
    completeMultipart: vi.fn(),
    sizeOf: vi.fn(),
    readStream: vi.fn(),
    deleteObject: vi.fn(),
  },
  mockSend: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@/lib/storage", () => ({ storage: mockStorage }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: mockSend })) }));
vi.mock("@/lib/entity-snapshot", () => ({ buildEntitySnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit-gates", () => ({ consumeUploadGate: vi.fn(async () => true) }));
vi.mock("@sentry/node", () => ({ captureMessage: mockCaptureMessage }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** 每个受理的文件产出一个 asset id,顺序与传入一致 —— 于是「哪一个没派出去」是可断言的。 */
let assetSeq = 0;
vi.mock("@fikirtive/db", () => {
  const prisma = {
    project: { findFirst: vi.fn(async () => ({ id: "proj_1" })) },
    asset: { upsert: vi.fn(async () => ({ id: `asset_${++assetSeq}` })), count: vi.fn(async () => 0) },
    generation: { create: vi.fn(async () => ({ id: `gen_${assetSeq}` })) },
    actionEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { finalizeCandidateUploads } from "../upload-actions";

/** 一段真的 PNG 前缀(签名 + IHDR + 零长 IDAT),让 finalize 的字节嗅探读到一张真图。 */
const PNG_PREFIX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);

const SIZE = 64;
const receipt = (n: number) => ({
  sha256: String(n).repeat(64).slice(0, 64),
  ext: "png",
  sizeBytes: SIZE,
  originalFilename: `merchant-private-${n}.png`,
  upload: { mode: "existed" as const },
});

beforeEach(() => {
  vi.clearAllMocks();
  assetSeq = 0;
  mockOwner.mockResolvedValue({ ownerId: "org_secret_tenant", email: "a@b.c" });
  mockStorage.supportsDirectUpload = true;
  mockStorage.sizeOf.mockResolvedValue(SIZE);
  mockStorage.readStream.mockImplementation(async () =>
    (async function* () {
      yield PNG_PREFIX;
    })(),
  );
  mockSend.mockResolvedValue("job-id");
  process.env.SENTRY_DSN = "https://example.invalid/1";
});

afterEach(() => {
  delete process.env.SENTRY_DSN;
});

describe("C1b ③ 直传 hash 验证派工失败时(前半:说真话)", () => {
  it("一个资产派失败,其余照样派 —— 一次失败不再把整批甩下", async () => {
    // 第二个炸。改动前:循环就此结束,asset_3 / asset_4 连试都没试过。
    mockSend.mockImplementation(async (_queue: string, payload: { assetId: string }) => {
      if (payload.assetId === "asset_2") throw new Error("queue unreachable");
      return "job-id";
    });

    await finalizeCandidateUploads("proj_1", "", [], [receipt(1), receipt(2), receipt(3), receipt(4)]);

    const dispatched = mockSend.mock.calls.map((c) => (c[1] as { assetId: string }).assetId);
    expect(dispatched).toEqual(["asset_1", "asset_2", "asset_3", "asset_4"]);
  });

  it("派工失败会真的告警 —— 不再只是一行没人看的日志", async () => {
    mockSend.mockRejectedValue(new Error("queue unreachable"));

    await finalizeCandidateUploads("proj_1", "", [], [receipt(1), receipt(2)]);

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [title, options] = mockCaptureMessage.mock.calls[0]!;
    // 告警必须说清「有几个」以及「这意味着什么」——哈希在被扫回来之前都还只是个声明。
    expect(String(title)).toContain("2");
    expect(String(title).toLowerCase()).toContain("unverified");
    expect(options).toMatchObject({ level: "error", tags: { probe: "ingest-dispatch" } });
    expect((options as { extra: { assetIds: string } }).extra.assetIds).toBe("asset_1 asset_2");
  });

  it("只有真失败的那几个进告警 —— 成功的不许被算进去", async () => {
    mockSend.mockImplementation(async (_queue: string, payload: { assetId: string }) => {
      if (payload.assetId === "asset_2") throw new Error("queue unreachable");
      return "job-id";
    });

    await finalizeCandidateUploads("proj_1", "", [], [receipt(1), receipt(2), receipt(3)]);

    const options = mockCaptureMessage.mock.calls[0]![1] as { extra: { assetIds: string; count: number } };
    expect(options.extra.assetIds).toBe("asset_2");
    expect(options.extra.count).toBe(1);
  });

  it("告警里只有资产 id —— 不带租户、不带文件名、不带哈希", async () => {
    mockSend.mockRejectedValue(new Error("queue unreachable"));

    await finalizeCandidateUploads("proj_1", "", [], [receipt(1)]);

    // 一个没验完的上传是**别人的私人文件**。ops 要动手需要的只是「哪几行」,而 id 就够了。
    const shown = JSON.stringify(mockCaptureMessage.mock.calls[0]).toLowerCase();
    for (const leak of ["org_secret_tenant", "merchant-private", "1111111111"]) {
      expect(shown, `ingest-dispatch alert leaked "${leak}"`).not.toContain(leak.toLowerCase());
    }
  });

  it("全部派成功 → 一条告警都不发(降级不是新常态)", async () => {
    await finalizeCandidateUploads("proj_1", "", [], [receipt(1), receipt(2)]);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("没配 SENTRY_DSN 时不炸 —— 告警缺席不该反过来打断上传", async () => {
    delete process.env.SENTRY_DSN;
    mockSend.mockRejectedValue(new Error("queue unreachable"));

    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt(1)]);

    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true });
  });

  it("行确实落了地,所以动作仍然回 ok —— 这一半是有意保留的,不是漏改", async () => {
    mockSend.mockRejectedValue(new Error("queue unreachable"));

    const res = await finalizeCandidateUploads("proj_1", "", [], [receipt(1)]);

    // 商家的文件真的在素材库里(Asset + Generation 都已提交),而 15 分钟内 worker 的
    // `redispatchLostIngest` 会把这条验证活重新派出去。此刻回 `{ error }` 会让界面说
    // 「加不上这张图」,而图就在那儿 —— 商家于是再传一遍。缺的从来不是他们那一半。
    expect(res).toMatchObject({ ok: true, count: 1 });
    expect((res as { generationIds: string[] }).generationIds).toHaveLength(1);
  });
});
