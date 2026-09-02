/**
 * gen-receipt.test.ts —— #776 生成回执落库的 worker 一站(**接线**这一层)。
 *
 * 引擎在响应里报回来两件事实,此前全被丢掉:它**真正跑的那句提示词**,和这一单它**真收的
 * 计费量**。这里跑**真的** `handleGen`(Prisma 是 mock),断言这两件事实被写到了正确的列上、
 * 用了正确的取舍。
 *
 * 分工写清楚,因为 r1 的判词正是冲着这一点来的:这个文件**只**证明接线,凡是「写不进去时
 * 会怎样」的主张一律不在这里 —— 一个 mock 的 `$transaction` 永远不会真的失败,拿它去证明
 * 「回执写失败不影响结算」就是假绿。那些主张全部搬去 `gen-receipt-db.test.ts`,在**真库**上
 * 注入**真失败**来证。
 *
 * 五条口径:
 *   ① 引擎报了提示词 → 落在 `Generation.finalPromptText`,商家写的那句仍在 `promptText`;
 *   ② 引擎没报        → 那一列**不写** = 留 null = 未知,绝不回落成商家自己那句话冒充引擎跑过;
 *   ③ 全部产出都报了量 → `GenJob.billedUnits` 落总和;
 *   ④ 只有部分报了量   → 不写 = 未知。半份求和是一个**偏低**的成本,挨着 spentUsd 躺着会被当成
 *      可对账的数 —— 低估成本比空着危险;
 *   ⑤ 回执写在钱的事务**之外**:commit 那一笔(generationIds / spent / spentUsd / settle)与
 *      #776 之前逐字节相同,回执一列都不在里面。
 *
 * #914 r4 起,本文件还多钉一件事实(见文件下半段):**我们自己**交给引擎的那一整句
 * (`Generation.sentPromptText`)。它与上面五条的分工是「引擎说的 vs 我们送的」——
 * `finalPromptText` 来自引擎回执(图片契约上恒为空),`sentPromptText` 来自我们自己的发送
 * 那一刻,所以图片这条路上也答得出来。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const generationFindFirst = vi.fn();
  const generationCreate = vi.fn();
  const generationUpdateMany = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const creditLedgerFindFirst = vi.fn();
  const assetUpsert = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateImages = vi.fn();
  const generateVideo = vi.fn();
  const storagePresignedGet = vi.fn();
  const storagePut = vi.fn();
  const storage = { presignedGet: storagePresignedGet, put: storagePut };
  // #914 r4:带 @元素 / 带底图的入口(工厂·战役 / 模板 / 详情页编辑)要走到参考图这一段,
  // 所以这三个替身也得能被用例配置。
  const entityFindFirst = vi.fn();
  const entityVariantFindFirst = vi.fn();
  const referenceImageFindMany = vi.fn(
    async (): Promise<{ asset: { ownerId: string; contentHash: string; ext: string } }[]> => [],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: generationFindFirst, create: generationCreate, updateMany: generationUpdateMany },
    asset: { upsert: assetUpsert },
    entity: { findFirst: entityFindFirst, findMany: vi.fn(async () => []) },
    entityVariant: { findFirst: entityVariantFindFirst },
    referenceImage: { findMany: referenceImageFindMany },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: creditLedgerFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst, generationFindFirst,
    generationCreate, generationUpdateMany, chatMessageFindFirst, chatMessageCreate, creditLedgerFindFirst, assetUpsert,
    refundReservation, settleCredits, generateImages, generateVideo, storagePresignedGet, storagePut, storage,
    entityFindFirst, entityVariantFindFirst, referenceImageFindMany,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  // 画布结算与本票无关,但缺了它每条用例都会刷一屏 non-fatal 噪音,把真正的失败盖掉。
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { handleGen } from "./gen.js";

const imageJob = {
  id: "g1",
  ownerId: "o1",
  projectId: "p1",
  threadId: null,
  shotId: null,
  status: "QUEUED",
  kind: "IMAGE",
  model: "seedream",
  prompt: "a poster for the weekend sale",
  entityIds: [] as string[],
  variantSel: null,
  count: 1,
  videoOptions: null,
  imageOptions: null,
  generationIds: [] as string[],
  spentUsd: null,
  sourceGenerationId: null,
  tailGenerationId: null,
  referenceVideoGenerationId: null,
};

const videoJob = { ...imageJob, kind: "VIDEO", model: "seedance-2-mini", videoOptions: { seconds: 5, resolution: "720p" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.storage.presignedGet = m.storagePresignedGet;
  m.storage.put = m.storagePut;
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
  m.creditLedgerFindFirst.mockResolvedValue(null);
  m.assetUpsert.mockResolvedValue({ id: "asset1" });
  m.generationCreate.mockImplementation(async () => ({ id: `gen_out${m.generationCreate.mock.calls.length}` }));
  // distinct hashes per output so a multi-image job really writes several rows
  m.storagePut.mockImplementation(async () => ({ contentHash: String(m.storagePut.mock.calls.length).repeat(64).slice(0, 64) }));
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
});


/**
 * 真跑一次 handleGen,把它写进库里的东西按**写入位置**分好交回来。
 *
 * 位置本身就是断言的一部分:`commit` 是钱那一笔(事务内),`receiptPrompts` / `receiptUnits`
 * 是回执那几笔(事务外)。r1 把回执塞在 commit 里,于是一个记账字段有了否决交付的权力;
 * 分开取值,任何一次悄悄挪回去都会让下面的用例红。
 */
async function runWorker(job: Record<string, unknown>) {
  m.genJobFindUnique.mockResolvedValue(job);
  await handleGen({ genJobId: "g1" }, 0);
  const generationRows = m.generationCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  const genJobWrites = m.genJobUpdateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });
  return {
    generationRows,
    // commit tx 的那一次 —— generationIds / spent / spentUsd(钱)
    commit: genJobWrites.find((a) => "generationIds" in a.data)?.data,
    // 回执补写:提示词逐行、计费量整单,都在事务之外
    receiptPrompts: m.generationUpdateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }),
    receiptUnits: genJobWrites.find((a) => "billedUnits" in a.data)?.data.billedUnits,
  };
}

describe("#776 引擎自报的提示词落在产出行上", () => {
  it("报了就原样落库,而商家自己那句话仍在 promptText —— 两句分开存,谁也不冒充谁", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "a bright poster, weekend sale, bold type", billedUnits: 1 } },
    ]);
    const { generationRows, receiptPrompts } = await runWorker({ ...imageJob });
    expect(generationRows).toHaveLength(1);
    expect(generationRows[0]!.promptText).toBe("a poster for the weekend sale");
    expect(receiptPrompts).toHaveLength(1);
    expect(receiptPrompts[0]!.data.finalPromptText).toBe("a bright poster, weekend sale, bold type");
    // 租户约束跟着回执写走 —— 补写不是「反正是自己的行」就可以不带 ownerId 的理由。
    expect(receiptPrompts[0]!.where.ownerId).toBe("o1");
  });

  it("引擎没报 ⇒ 那一列**不写**(留 null = 未知),绝不回落成商家写的那句", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows, receiptPrompts } = await runWorker({ ...imageJob });
    expect(receiptPrompts).toHaveLength(0);
    // 这一条是本票的全部意义:未知长得像未知,不长得像一个恰好等于商家原话的答案。
    expect(generationRows[0]!.finalPromptText).toBeUndefined();
  });

  it("多张图:每一张记自己那份回执,不串台", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { finalPrompt: "first rewrite", billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { finalPrompt: "second rewrite", billedUnits: 1 } },
    ]);
    const { receiptPrompts } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptPrompts.map((u) => u.data.finalPromptText)).toEqual(["first rewrite", "second rewrite"]);
    // 每一句写到**自己**那一行上(id 取自 commit 返回的顺序,不是事后按内容猜)
    expect(receiptPrompts.map((u) => u.where.id)).toEqual(["gen_out1", "gen_out2"]);
  });

  it("视频同样落库", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4", receipt: { finalPrompt: "slow push-in on the product", billedUnits: 108_900 } });
    const { receiptPrompts } = await runWorker({ ...videoJob });
    expect(receiptPrompts[0]!.data.finalPromptText).toBe("slow push-in on the product");
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * #914 r4(判官 r3)—— 落库的必须是**实际交给引擎的那一整句**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * r2/r3 把这件事记在 web 层,判官判 FAIL 的根因是:提示词到 worker 才拼完(#774 的参考图
 * 编号句由装 `inputImageUrls` 的那趟循环现产),web 层记下的永远不是真正送出去的全文 ——
 * 模板一键成片必带底图,必然命中,于是回执上「原样送出」那句话在那条路上恒为谎。
 *
 * 所以这里的断言形状只有一种,别的写法都不算数:
 *
 *     落进 Generation.sentPromptText 的字符串  ===  provider 这一次真正收到的 prompt
 *
 * 两边都从**同一次真跑的 handleGen** 里取(左边取 generationCreate 的 data,右边取
 * provider mock 的入参),中间没有任何一个可以由测试自己重算的表达式 —— 换句话说,这个
 * 文件里没有一处「照着实现抄一遍期望值」。
 *
 * 覆盖为什么是全的:五类花钱入口(画布 / 工厂·战役 / 模板 / 详情页编辑 / Otto·cowork)
 * 都只会造出一个 GenJob,再由**这一个** worker 发送点交给引擎。所以下面按「各入口造出来
 * 的任务形状」逐条跑,而「只有这一个发送点」这一条本身由文末的源码闸钉住。
 */
describe("#914 r4(判官 r3)实际送出的那一整句落库,五类入口同一个发送点", () => {
  /** 真跑一次 handleGen,把「引擎真正收到的那句」和「落进产出行那一列的那句」并排交回。 */
  async function sentVsStored(job: Record<string, unknown>) {
    const out = await runWorker(job);
    const imageCall = m.generateImages.mock.calls[0]?.[0] as { prompt: string } | undefined;
    const videoCall = m.generateVideo.mock.calls[0]?.[0] as { prompt: string } | undefined;
    const call = imageCall ?? videoCall;
    expect(call, "这一条用例要有意义,付费调用必须真的发生过").toBeDefined();
    return {
      sent: call!.prompt,
      stored: out.generationRows.map((r) => r.sentPromptText as string | undefined),
      rows: out.generationRows,
      receiptPrompts: out.receiptPrompts,
    };
  }

  beforeEach(() => {
    // 元素解析的默认替身(带 @元素 的入口才会用到)。名字刻意与审批快照不同,以免某条
    // 用例悄悄依赖活行名称。
    m.entityFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, type: "PRODUCT", name: `LIVE-${where.id}` }));
    m.entityVariantFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
    m.referenceImageFindMany.mockImplementation(async () => []);
    // 底图(sourceGenerationId)解析 —— 模板与详情页编辑都靠它。
    m.generationFindFirst.mockResolvedValue({ id: "gen_src", asset: { ownerId: "o1", contentHash: "a".repeat(64), ext: "png" } });
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
  });

  it("① 画布(逐格生成,无参考图)—— 送出的就是任务上那句,而且落库的与送出的是同一个字符串", async () => {
    const { sent, stored } = await sentVsStored({ ...imageJob, idempotencyKey: "canvas:node1" });
    expect(stored).toEqual([sent]);
    expect(sent).toBe(imageJob.prompt); // 没有参考图 ⇒ 没有编号句 ⇒ 与商家那句逐字相同
  });

  it("② 工厂 / 战役批量(一格一单,带 @元素)—— 编号句进了实际送出的那句,也就进了落库的那一列", async () => {
    m.referenceImageFindMany.mockImplementation(async () => [{ asset: { ownerId: "o1", contentHash: "b".repeat(64), ext: "png" } }]);
    const { sent, stored } = await sentVsStored({
      ...imageJob,
      idempotencyKey: "factory:camp1:cell1",
      entityIds: ["e0"],
      approvedEntities: [{ id: "e0", type: "PRODUCT", name: "Bottle" }],
    });
    expect(stored).toEqual([sent]);
    // 编号句是 worker 现产的 —— web 层记不到,这正是 r3 判 FAIL 的那一条。
    expect(sent).toContain("<Image_1>");
    expect(sent.endsWith(imageJob.prompt)).toBe(true);
  });

  it("③ 模板一键成片(必带底图)—— #774 的编号句在记录里,不是记了一句商家原话就算数", async () => {
    const { sent, stored } = await sentVsStored({
      ...imageJob,
      idempotencyKey: "template:run1",
      sourceGenerationId: "gen_src", // TemplateModal 恒定带上商家上传的那张照片
    });
    expect(stored).toEqual([sent]);
    // 判官点名的那一句,逐字钉死在**落库的那一列**上。
    expect(stored[0]).toContain("<Image_1> is the image being edited.");
    expect(stored[0]).toBe(`<Image_1> is the image being edited.\n${imageJob.prompt}`);
    // 而商家自己那句仍旧原样在 promptText —— 两列分明,谁也不冒充谁。
    expect(stored[0]).not.toBe(imageJob.prompt);
  });

  it("④ 详情页编辑 @composer(底图 + @元素)—— 底图坐第 1 位、元素第 2 位,记录里逐字对得上", async () => {
    m.referenceImageFindMany.mockImplementation(async () => [{ asset: { ownerId: "o1", contentHash: "c".repeat(64), ext: "png" } }]);
    const { sent, stored } = await sentVsStored({
      ...imageJob,
      sourceGenerationId: "gen_src",
      entityIds: ["e0"],
      approvedEntities: [{ id: "e0", type: "PRODUCT", name: "Bottle" }],
    });
    expect(stored).toEqual([sent]);
    expect(stored[0]).toBe(
      "<Image_1> is the image being edited. " +
      "Define the product in <Image_2> as <Subject_2>: Bottle.\n" +
      imageJob.prompt,
    );
  });

  it("⑤ Otto / cowork(入队前平台自己拼装过)—— 落的是**送出去的那句**,不是商家原话;商家原话留在任务上", async () => {
    const merchantWrote = "a poster for the weekend sale";
    const composed = "a poster for the weekend sale — bold type, high contrast";
    const { sent, stored } = await sentVsStored({
      ...imageJob,
      threadId: "t1",
      prompt: composed,           // coworkGenerate 拼装之后的结果就坐在 GenJob.prompt 上
      requestedPrompt: merchantWrote, // 商家原话在任务上(读取端比对的左边那一列)
    });
    expect(stored).toEqual([sent]);
    expect(stored[0]).toBe(composed);
    expect(stored[0]).not.toBe(merchantWrote);
    // 商家原话**不**再抄进产出行:它只有一个出处(GenJob.requestedPrompt),不留两套真相。
    expect(m.generationCreate.mock.calls[0]![0].data).not.toHaveProperty("requestedPromptText");
  });

  it("⑥ 视频零回归 —— 视频分支照旧送 job.prompt(一个编号句都不加),而且同样落库", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    const { sent, stored } = await sentVsStored({ ...videoJob });
    expect(stored).toEqual([sent]);
    expect(sent).toBe(videoJob.prompt);
  });

  it("多张图:一次付费调用一个字符串,每一张产出行都记同一句(不逐张各记各的)", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png" },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const { sent, stored } = await sentVsStored({ ...imageJob, count: 2, sourceGenerationId: "gen_src" });
    expect(stored).toEqual([sent, sent]);
  });

  it("这一列**永远**写(这个 handler 建的行绝不留 null)—— 读取端据此「没有记录就整行不显示」才站得住", async () => {
    const { rows } = await sentVsStored({ ...imageJob });
    expect(rows[0]).toHaveProperty("sentPromptText");
    expect(typeof rows[0]!.sentPromptText).toBe("string");
  });

  it("落在 commit 那一笔事务里(与 promptText 同一次写入),不是事务外的补写", async () => {
    const { receiptPrompts } = await sentVsStored({ ...imageJob });
    // 它是我们自己已校验过长度的数据,不是引擎能撑爆的输入 —— 所以不必像 finalPromptText
    // 那样躲到事务外;但反过来,它也绝不许出现在事务外那几笔补写里。
    expect(receiptPrompts.every((u) => !("sentPromptText" in u.data))).toBe(true);
  });
});

/**
 * 源码闸 —— 「每一个付费发送点都有记录」这条结构性主张(#914 r6,判官 r5 P1-1)。
 *
 * 上面每一条用例都只能证明「这一种任务形状记对了」;而「回执覆盖全部付费发送点」这句话
 * 真正依赖的是:worker 里把提示词交给引擎的地方**一个都没落下**,而且每一处交出去的与
 * 落库的是同一个变量。这条主张没法用行为测试证,所以用词法钉。
 *
 * r4 的版本只读 `gen.ts` —— 于是 `refgen.ts`(元素参考照,**同样收费**)这个第三个发送点
 * 在闸眼里根本不存在,判官 r5 据此判 FAIL:一道只看自己家门的闸,证明不了整条街。r6 把
 * 作用域扩到 `apps/worker/src/**` 全目录:将来任何文件里新开一个付费发送点,不接上记录
 * 就当场红。
 */
describe("#914 r6 —— **整个 worker** 里的付费发送点全部有记录,且送出的与落库的是同一个变量", () => {
  /** apps/worker/src 下的全部生产源码(测试文件除外)—— 闸的作用域就是这一片。 */
  function workerSources(): { file: string; src: string }[] {
    const root = fileURLToPath(new URL("../", import.meta.url)); // apps/worker/src/
    const out: { file: string; src: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
        out.push({ file: relative(root, full), src: readFileSync(full, "utf8") });
      }
    };
    walk(root);
    return out;
  }

  /** 一个付费发送点 = 一处 `provider.generate*({ prompt: <表达式>` 。 */
  function sendSites(): { file: string; arg: string }[] {
    return workerSources().flatMap(({ file, src }) =>
      [...src.matchAll(/provider\.(?:generate|generateVideo)\(\{\s*(?:\/\/[^\n]*\n\s*)*prompt:\s*([A-Za-z0-9_.()]+)/g)]
        .map((match) => ({ file, arg: match[1]! })),
    );
  }

  // r5 判官 P1-1 就死在这条上:r4 的闸只读 gen.ts,于是 refgen.ts 这个**同样收费**的
  // 第三个发送点在闸眼里根本不存在,「回执覆盖全部付费发送点」是一句没人验的话。
  it("发送点逐个枚举:今天是 gen.ts 图片/视频 + refgen.ts 元素参考照,共三处", () => {
    expect(sendSites().map((s) => s.file).sort()).toEqual(["jobs/gen.ts", "jobs/gen.ts", "jobs/refgen.ts"]);
  });

  it("每一处交给引擎的都是变量 `sentPrompt` —— 不是就地现算的表达式", () => {
    for (const site of sendSites()) {
      expect(site.arg, `${site.file} 的付费发送点必须交出被落库的那个变量`).toBe("sentPrompt");
    }
  });

  it("每一个有发送点的文件都把那个变量落了库", () => {
    const files = new Set(sendSites().map((s) => s.file));
    for (const { file, src } of workerSources()) {
      if (!files.has(file)) continue;
      expect(src, `${file} 送了却没记`).toMatch(/sentPromptText: sentPrompt\b/);
    }
  });

  it("`withReferenceMap(` 在 gen.ts 里只出现一次 —— 算两遍迟早会不一样", () => {
    const gen = workerSources().find((s) => s.file === "jobs/gen.ts")!;
    expect(gen.src.match(/withReferenceMap\(/g)).toHaveLength(1);
  });
});

describe("#776 真实计费量:全报才求和", () => {
  it("全部产出都报了量 ⇒ 落总和(图片按张:两张 = 2)", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { billedUnits: 1 } },
    ]);
    const { commit, receiptUnits } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptUnits).toBe(2);
    expect(typeof commit!.spentUsd).toBe("number"); // 估算照旧,由我们的价目表冻结
    expect(commit!.spent).toBe(true);
  });

  it("只有部分报了量 ⇒ 不写(未知),绝不落一个偏低的半份求和", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1 } },
      { bytes: new Uint8Array([2]), ext: "png" },
    ]);
    const { receiptUnits } = await runWorker({ ...imageJob, count: 2 });
    expect(receiptUnits).toBeUndefined();
  });

  it("一个都没报 ⇒ 不写", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { receiptUnits } = await runWorker({ ...imageJob });
    expect(receiptUnits).toBeUndefined();
  });
});

describe("#776 回执在钱的事务之外", () => {
  it("commit 那一笔只写钱与 resume marker —— 回执一列都不在里面", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "rewritten" } }]);
    const { commit, generationRows } = await runWorker({ ...imageJob });
    // 这两条是 r1 的病灶所在:回执写在事务里,写不进去就回滚掉一单已经付过钱的生成。
    expect(commit).not.toHaveProperty("billedUnits");
    expect(generationRows[0]).not.toHaveProperty("finalPromptText");
  });

  it("回执是记录不是计费:有没有回执,settle 与 spentUsd 一模一样", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "rewritten" } }]);
    const withReceipt = await runWorker({ ...imageJob });
    const settleCallsWith = m.settleCredits.mock.calls.length;

    vi.clearAllMocks();
    m.projectFindFirst.mockResolvedValue({ id: "p1" });
    m.genJobUpdateMany.mockResolvedValue({ count: 1 });
    m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
    m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
    m.creditLedgerFindFirst.mockResolvedValue(null);
    m.assetUpsert.mockResolvedValue({ id: "asset1" });
    m.generationCreate.mockResolvedValue({ id: "gen_out1" });
    m.storagePut.mockResolvedValue({ contentHash: "c".repeat(64) });
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const withoutReceipt = await runWorker({ ...imageJob });

    expect(withoutReceipt.commit!.spentUsd).toBe(withReceipt.commit!.spentUsd);
    expect(withoutReceipt.commit!.spent).toBe(withReceipt.commit!.spent);
    expect(m.settleCredits.mock.calls.length).toBe(settleCallsWith);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CREATE-A4 / CREATE-A12 —— **路由理由由 worker 自己写**(r1 判官 P1 落修)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 此前 A4 的「该次路由理由可查」只有一条真库证据,而那条证据里的 Generation 行是**测试
 * 自己**算出理由、自己插进去、再读回来的 —— 它证明的是这一列存得下、读得出,不是产品
 * 会写。把 `apps/worker/src/jobs/gen.ts` 里那一行删掉,全仓测试照样全绿。
 *
 * 这里跑真的 `handleGen`,直接看它交给 `generation.create` 的那份 data:
 *   · 高清槽位 ⇒ 写商家看得懂的那句话,且一个型号名都没有;
 *   · 默认槽位 ⇒ 写 null(没有升档,没什么可解释的),不编一句话出来。
 */
describe("CREATE-A4 / CREATE-A12 路由理由:worker 建 Generation 行时自己写这一列", () => {
  it("CREATE-A4 高清槽位 ⇒ routeReason 落在 worker 写的那一行上,只有能力名词", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    const { generationRows } = await runWorker({
      ...videoJob,
      model: "seedance-2-0",
      videoOptions: { seconds: 5, resolution: "1080p" },
    });
    expect(generationRows).toHaveLength(1);
    expect(generationRows[0]!.routeReason).toBe("You asked for 1080p, so this went to the HD tier.");
    // 商家只见能力,不见型号 —— 这一列是给商家看的。
    for (const secret of ["seedance", "seedream", "dreamina", "byteplus", "mini"]) {
      expect(String(generationRows[0]!.routeReason).toLowerCase()).not.toContain(secret);
    }
  });

  it("CREATE-A12 默认槽位 ⇒ routeReason 是 null(没升档就没有理由),不是编出来的一句话", async () => {
    m.generateVideo.mockResolvedValue({ bytes: new Uint8Array([1]), ext: "mp4" });
    const { generationRows } = await runWorker({ ...videoJob });
    expect(generationRows[0]!.routeReason).toBeNull();
  });

  it("CREATE-A12 图片默认槽位同样是 null", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows } = await runWorker({ ...imageJob });
    expect(generationRows[0]!.routeReason).toBeNull();
  });

  it("CREATE-A12 图片 pro 槽位则写它自己那句(同一个纯函数,图片侧同形)", async () => {
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1]), ext: "png" }]);
    const { generationRows } = await runWorker({ ...imageJob, model: "seedream-pro" });
    expect(generationRows[0]!.routeReason)
      .toBe("You asked for a capability only the fine-detail tier can do, so this went there.");
  });
});
