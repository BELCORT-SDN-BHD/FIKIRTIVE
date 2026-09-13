/**
 * gen-fairness.test.ts — #1388(零排队③,spec creation-engine.md §5 2026-09-12 场⑦ item④)。
 *
 * 判官 BLOCK 回炉后的版本:触发语义改成「撞厂商限速」(`providerRequestGate` 饱和),不是
 * 「槽位占满」——规格 §5 行④逐字「『每商家最多 N-1 槽』降级为撞厂商限速时的兜底规则」。
 * 常态(闸门有空位)下任何商家都能用满,连一次 DB 查询都不做;只有闸门饱和 **且**
 * 这个商家自己已经占满 N-1 槽 **且** 别家有任务在等,三者同时成立才让位。
 *
 * 红案(修复前必须失败):闸门饱和 + 商家 A 占满 3 槽(N-1)+ 商家 B 排队时,A 自己排队中的
 * 第 4 条不该被认领。修复前 `shouldDeferGenClaimForFairness` 不存在,这组测试红
 * (`Module '"./gen.js"' has no exported member`)。
 *
 * 同时钉四件判官安全定向要求的事:
 *   4e — 已经产出过的作业(generationIds 非空)绝不让位;
 *   4c — 让位有年龄上界,过线不再让;
 *   4d — 公平让位重投携带 carriedRetryCount,不把已用的重试预算洗白;
 *   5b — 「别家是否在排队」用 findFirst,不用 count。
 * 以及常态(未设 WORKER_ROLE,或闸门未饱和)逐字节不受影响。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __setProviderRequestGateForTests, RequestGate } from "@fikirtive/generation";

type JobRow = {
  id: string;
  ownerId: string;
  projectId: string;
  threadId: string | null;
  shotId: string | null;
  status: string;
  kind: string;
  model: string;
  prompt: string;
  entityIds: string[];
  variantSel: null;
  count: number;
  videoOptions: null;
  imageOptions: null;
  generationIds: string[];
  spent: boolean;
  spentUsd: number | null;
  sourceGenerationId: null;
  tailGenerationId: null;
  referenceVideoGenerationId: null;
  startedAt: Date | null;
  attempts: number;
  progress: number;
  finishedAt: Date | null;
  error: string;
  createdAt: Date;
};

const m = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const settleCredits = vi.fn();
  const refundReservation = vi.fn();
  const generateImages = vi.fn();
  const chatMessages: Record<string, unknown>[] = [];

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; lt?: Date; isEmpty?: boolean; not?: unknown };
        if (c.in) return c.in.includes(value);
        if (c.lt !== undefined) return value instanceof Date && value.getTime() < c.lt.getTime();
        if (c.isEmpty !== undefined) return Array.isArray(value) && (value.length === 0) === c.isEmpty;
        if (c.not !== undefined) return value !== c.not;
        return false;
      }
      return value === cond;
    });

  const updateMany = vi.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    let count = 0;
    for (const row of rows.values()) {
      if (!matches(row, where)) continue;
      for (const [key, value] of Object.entries(data)) {
        if (value !== null && typeof value === "object" && !(value instanceof Date) && "increment" in (value as object)) {
          row[key] = (row[key] as number) + (value as { increment: number }).increment;
        } else row[key] = value;
      }
      count++;
    }
    return Promise.resolve({ count });
  });

  const count = vi.fn(({ where }: { where: Record<string, unknown> }) => {
    let n = 0;
    for (const row of rows.values()) if (matches(row, where)) n++;
    return Promise.resolve(n);
  });

  /** 判官安全定向 5b —— 「别家是否在排队」现在读 findFirst,不是 count。 */
  const findFirst = vi.fn(({ where }: { where: Record<string, unknown> }) => {
    for (const row of rows.values()) if (matches(row, where)) return Promise.resolve({ ...row });
    return Promise.resolve(null);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows.get(where.id) ? { ...rows.get(where.id) } : null)),
      updateMany,
      count,
      findFirst,
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.get(where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    project: { findFirst: vi.fn(async () => ({ id: "p1" })) },
    generation: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: `gen_${Math.random().toString(36).slice(2)}` })) },
    asset: { upsert: vi.fn(async () => ({ id: "asset1" })) },
    entity: { findMany: vi.fn(async () => []) },
    chatMessage: {
      findFirst: vi.fn(async () => ({ seq: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (chatMessages.some((msg) => msg.genJobId === data.genJobId)) {
          throw Object.assign(new Error("unique constraint"), { code: "P2002" });
        }
        chatMessages.push(data);
        return data;
      }),
    },
    creditLedger: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const storage = { put: vi.fn(async () => ({ contentHash: "hash1" })), presignedGet: vi.fn(async () => "https://example.test/x") };
  return { prisma, rows, settleCredits, refundReservation, generateImages, storage, chatMessages, updateMany, count, findFirst };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: m.storage }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: vi.fn() } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import {
  handleGen,
  shouldDeferGenClaimForFairness,
  GEN_FAIRNESS_REQUEUE_DELAY_SECONDS,
  GEN_FAIRNESS_DEFER_MAX_AGE_MS,
} from "./gen.js";

function seedJob(over: Partial<JobRow> & Pick<JobRow, "id" | "ownerId">): void {
  m.rows.set(over.id, {
    projectId: "p1", threadId: `t-${over.id}`, shotId: null, status: "QUEUED", kind: "IMAGE",
    model: "seedream", prompt: "a shop front", entityIds: [], variantSel: null, count: 1,
    videoOptions: null, imageOptions: null, generationIds: [], spent: false, spentUsd: null,
    sourceGenerationId: null, tailGenerationId: null, referenceVideoGenerationId: null,
    startedAt: null, attempts: 0, progress: 0, finishedAt: null, error: "", createdAt: new Date(),
    ...over,
  } as unknown as Record<string, unknown>);
}

const outputs = [{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }];
const WAIT_ENV = { WORKER_ROLE: "wait" } as NodeJS.ProcessEnv;
const N = 4;
const CAP = N - 1;

/** 把进程内的 providerRequestGate 单例换成一个可控的假闸门:limit=1、立刻 acquire 一格且
 *  从不释放 ⇒ inFlight(1) >= limit(1) ⇒ 饱和(撞限速)。 */
async function saturateProviderGate(): Promise<void> {
  const gate = new RequestGate(1);
  await gate.acquire();
  __setProviderRequestGateForTests(gate);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rows.clear();
  m.chatMessages.length = 0;
  m.storage.put.mockResolvedValue({ contentHash: "hash1" });
  m.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
  m.prisma.entity.findMany.mockResolvedValue([]);
  m.prisma.chatMessage.findFirst.mockResolvedValue({ seq: 1 });
  m.prisma.creditLedger.findFirst.mockResolvedValue(null);
  m.prisma.asset.upsert.mockResolvedValue({ id: "asset1" });
  m.generateImages.mockResolvedValue(outputs);
  // 默认:闸门未饱和(单例懒建,默认闸位 6,谁都没占) —— 常态。
  __setProviderRequestGateForTests(undefined);
});

afterEach(() => {
  // 不让这份测试留下的闸门状态漏给同文件后面的用例。
  __setProviderRequestGateForTests(undefined);
});

describe("shouldDeferGenClaimForFairness — 判据本身", () => {
  it("闸门未饱和(常态,没撞限速)—— 永远不让位,连一次 DB 查询都不做", async () => {
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED" });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "bwait", ownerId: "orgB", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    // 闸门保持默认(未饱和)。即使商家已经占满 N-1 槽、别家也在等,没撞限速就不让位。
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
    expect(m.count).not.toHaveBeenCalled();
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it("槽位 ≤1(未设 WORKER_ROLE,legacy all/compute)—— 永远不让位,连查询都不做(即使闸门饱和)", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, {} as NodeJS.ProcessEnv)).resolves.toBe(false);
    expect(m.count).not.toHaveBeenCalled();
  });

  it("这一单已经产出过(generationIds 非空)—— 判官安全定向 4e:绝不让位,不查询", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED", generationIds: ["gen_already_made"] });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "bwait", ownerId: "orgB", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
    expect(m.count).not.toHaveBeenCalled();
  });

  it("闸门饱和,但商家占用槽位 < N-1 —— 槽位有空,常态先到先得,不让位", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED" });
    seedJob({ id: "g2", ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "g3", ownerId: "orgA", status: "GENERATING" }); // orgA 占 2 < CAP(3)
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
  });

  it("闸门饱和、商家占满 N-1 槽,但没有别家在排队 —— 不浪费闲置容量,不让位", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED" });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
  });

  it("闸门饱和、商家占满 N-1 槽,且别家有任务在排队 —— 三条同时成立,让位(true)", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED" });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "bwait", ownerId: "orgB", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(true);
    // 5b —— 用 findFirst,不用 count 去数「别家排队」这件事。
    expect(m.findFirst).toHaveBeenCalled();
  });

  it("判官安全定向 4c —— 让位有年龄上界:过线之后,即使三条件都成立也不再让", async () => {
    await saturateProviderGate();
    const oldEnough = new Date(Date.now() - (GEN_FAIRNESS_DEFER_MAX_AGE_MS + 1000));
    seedJob({ id: "g1", ownerId: "orgA", status: "QUEUED", createdAt: oldEnough });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "bwait", ownerId: "orgB", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
    // 过线之后连 DB 都不必再查——年龄闸挡在两次 count/findFirst 之前。
    expect(m.count).not.toHaveBeenCalled();
  });

  it("这一单已经不是 QUEUED(重投一条正在跑/已终态的行)—— 永远不让位,不查询", async () => {
    await saturateProviderGate();
    seedJob({ id: "g1", ownerId: "orgA", status: "GENERATING" });
    for (let i = 0; i < CAP; i++) seedJob({ id: `run${i}`, ownerId: "orgA", status: "GENERATING" });
    seedJob({ id: "bwait", ownerId: "orgB", status: "QUEUED" });
    const job = m.rows.get("g1") as unknown as { id: string; ownerId: string; status: string; generationIds: string[]; createdAt: Date };
    await expect(shouldDeferGenClaimForFairness(job, WAIT_ENV)).resolves.toBe(false);
    expect(m.count).not.toHaveBeenCalled();
  });
});

describe("公平兜底(撞限速触发):商家 A 占满 3 槽(N-1)后,它自己排队中的第 4 条让位给商家 B", () => {
  beforeEach(() => { process.env.WORKER_ROLE = "wait"; });
  afterEach(() => { delete process.env.WORKER_ROLE; });

  it("handleGen 不认领第 4 条 —— 不发供应商请求、行原样留在 QUEUED、回信带 carriedRetryCount 让派活层重投", async () => {
    await saturateProviderGate();
    for (let i = 0; i < CAP; i++) seedJob({ id: `a-run${i}`, ownerId: "merchantA", status: "GENERATING" });
    seedJob({ id: "a-4th", ownerId: "merchantA", status: "QUEUED" });
    seedJob({ id: "b-wait", ownerId: "merchantB", status: "QUEUED" });

    const outcome = await handleGen({ genJobId: "a-4th" }, 0);

    expect(outcome).toEqual({
      deferredForFairness: true,
      requeueAfterSeconds: GEN_FAIRNESS_REQUEUE_DELAY_SECONDS,
      carriedRetryCount: 0,
    });
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.settleCredits).not.toHaveBeenCalled();
    const row = m.rows.get("a-4th")!;
    expect(row.status).toBe("QUEUED"); // 未被认领 —— 不是「认领了又回滚」
    expect(row.spent).toBe(false);
    const claimAttempts = m.updateMany.mock.calls.filter((c) => c[0]?.data?.status === "GENERATING");
    expect(claimAttempts).toHaveLength(0);
  });

  it("闸门未饱和(没撞限速)—— 即使 A 占满 3 槽、B 在等,第 4 条也照常认领(不是常态限额)", async () => {
    // 不调用 saturateProviderGate() —— 闸门保持默认未饱和状态。
    for (let i = 0; i < CAP; i++) seedJob({ id: `a-run${i}`, ownerId: "merchantA", status: "GENERATING" });
    seedJob({ id: "a-4th", ownerId: "merchantA", status: "QUEUED" });
    seedJob({ id: "b-wait", ownerId: "merchantB", status: "QUEUED" });

    const outcome = await handleGen({ genJobId: "a-4th" }, 0);

    expect(outcome).toBeUndefined(); // 没撞限速,先到先得,正常认领
    expect(m.generateImages).toHaveBeenCalledTimes(1);
    expect(m.rows.get("a-4th")!.status).toBe("DONE");
  });

  it("B 的短任务不用排在 A 被让位的第 4 条后面 —— B 照常认领并结算,与 A 的排队无关", async () => {
    await saturateProviderGate();
    for (let i = 0; i < CAP; i++) seedJob({ id: `a-run${i}`, ownerId: "merchantA", status: "GENERATING" });
    seedJob({ id: "a-4th", ownerId: "merchantA", status: "QUEUED" });
    seedJob({ id: "b-wait", ownerId: "merchantB", status: "QUEUED" });

    // 派活层拿到 A 第 4 条的让位回信之后,轮询器立刻空出来去抢 B 已经排队的这一单
    // (index.ts 的既有形状——这里直接验的是 handleGen 对 B 那一单的处理,不复述派活层接线)。
    // B 自己的这一单本身没有占满 N-1 槽,所以即使闸门饱和,fairness 判据在它自己身上也不成立
    // ——它是「在等的别家」,不是「已经占满槽位、需要让位的那一边」。
    const outcome = await handleGen({ genJobId: "b-wait" }, 0);
    expect(outcome).toBeUndefined();

    expect(m.generateImages).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect((m.settleCredits.mock.calls[0]![1] as { orgId: string }).orgId).toBe("merchantB");
    expect(m.rows.get("b-wait")!.status).toBe("DONE");
    expect(m.rows.get("a-4th")!.status).toBe("QUEUED");
  });
});

describe("幂等:让位不是回滚,重投一次(争用解除后)照常认领并结算一次", () => {
  beforeEach(() => { process.env.WORKER_ROLE = "wait"; });
  afterEach(() => { delete process.env.WORKER_ROLE; });

  it("第一次让位(0 次供应商调用),争用解除后第二次投递正常认领结算(恰好 1 次调用)", async () => {
    await saturateProviderGate();
    for (let i = 0; i < CAP; i++) seedJob({ id: `a-run${i}`, ownerId: "merchantA", status: "GENERATING" });
    seedJob({ id: "a-4th", ownerId: "merchantA", status: "QUEUED" });
    seedJob({ id: "b-wait", ownerId: "merchantB", status: "QUEUED" });

    const first = await handleGen({ genJobId: "a-4th" }, 0);
    expect(first).toEqual({
      deferredForFairness: true,
      requeueAfterSeconds: GEN_FAIRNESS_REQUEUE_DELAY_SECONDS,
      carriedRetryCount: 0,
    });
    expect(m.generateImages).not.toHaveBeenCalled();

    // 争用解除:B 的那一单结束、A 也少了一条在跑的,而且闸门不再饱和(供应商那边也松了)。
    m.rows.get("b-wait")!.status = "DONE";
    m.rows.get("a-run0")!.status = "DONE";
    __setProviderRequestGateForTests(undefined);

    // 派活层按回信重投同一个 genJobId(携带 carriedRetryCount)——第二次投递。
    const second = await handleGen({ genJobId: "a-4th", carriedRetryCount: first!.carriedRetryCount }, 0);
    expect(second).toBeUndefined(); // 这一次不再让位,正常走完

    expect(m.generateImages).toHaveBeenCalledTimes(1); // 恰好一次——让位那一轮零调用,不是漏计
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.rows.get("a-4th")!.status).toBe("DONE");
    expect(m.rows.get("a-4th")!.spent).toBe(true);
  });

  it("判官安全定向 4d —— carriedRetryCount 不让 GEN_RETRY_LIMIT 被一次公平让位悄悄清零", async () => {
    // 这一单已经真实重投过 GEN_RETRY_LIMIT-1 次失败(pg-boss 的 retryCount),然后恰好在下一次
    // 投递时撞上公平让位——carriedRetryCount 必须把这个数带过去,不能让重投出的新消息把它
    // 的 retryCount 洗回 0。
    await saturateProviderGate();
    for (let i = 0; i < CAP; i++) seedJob({ id: `a-run${i}`, ownerId: "merchantA", status: "GENERATING" });
    seedJob({ id: "a-4th", ownerId: "merchantA", status: "QUEUED" });
    seedJob({ id: "b-wait", ownerId: "merchantB", status: "QUEUED" });

    // 这条消息自己的 pg-boss retryCount 是 1(已经失败重投过一次),函数入参就是 1。
    const outcome = await handleGen({ genJobId: "a-4th" }, 1);
    expect(outcome).toEqual({
      deferredForFairness: true,
      requeueAfterSeconds: GEN_FAIRNESS_REQUEUE_DELAY_SECONDS,
      carriedRetryCount: 1, // 让位携带的是「这条消息自己已经积累的 1」,不是 0
    });
  });
});

describe("常态不受影响:闸门未饱和,或未设 WORKER_ROLE(legacy all,N=1)逐字节不受影响", () => {
  it("四家各一单同时认领,谁都不让位 —— 与 #796/#760 既有行为一致(未设 WORKER_ROLE)", async () => {
    await saturateProviderGate(); // 即使闸门饱和——N≤1 时公平闸本来就短路,不受影响
    for (const id of ["c1", "c2", "c3", "c4"]) seedJob({ id, ownerId: `org-${id}`, status: "QUEUED" });
    m.generateImages.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return outputs;
    });

    const outcomes = await Promise.all(["c1", "c2", "c3", "c4"].map((id) => handleGen({ genJobId: id }, 0)));

    expect(outcomes.every((o) => o === undefined)).toBe(true);
    expect(m.generateImages).toHaveBeenCalledTimes(4);
    expect(m.settleCredits).toHaveBeenCalledTimes(4);
    for (const id of ["c1", "c2", "c3", "c4"]) expect(m.rows.get(id)!.status).toBe("DONE");
  });
});

/**
 * ── 红/绿证据(施工纪律要求先红后绿)───────────────────────────────────────────────
 * 本文件全部测试在修复落地**前**跑过一次(vitest 运行期报错,不是编译期):
 * 「shouldDeferGenClaimForFairness — 判据本身」整组因为 `shouldDeferGenClaimForFairness` /
 * `GEN_FAIRNESS_DEFER_MAX_AGE_MS` 不存在,导入阶段直接抛出("SyntaxError: The requested module
 * './gen.js' does not provide an export named ...")、这一文件的全部用例随之失败;「公平兜底」
 * 组第一条因为 `handleGen` 无条件认领而失败(`outcome` 是 `undefined`,不是让位信号;
 * `generateImages` 被调用了 1 次,不是 0 次)。修复落地后全绿——见 PR 描述里的命令输出。
 */
