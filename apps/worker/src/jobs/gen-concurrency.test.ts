/**
 * gen-concurrency.test.ts — #796 / #760 的两条硬证据。
 *
 * 1. **一单只收一次钱。** 并发从 1 提到 N 之后,同一个 genJob 可能被 N 个轮询器同时看到
 *    (pg-boss 的重投、清道夫重排、retry 都会产生重复投递)。这个文件让 N 个 `handleGen`
 *    真的在同一个进程里同时跑同一单,断言:供应商只被调用一次、`settleCredits` 只发生一次、
 *    没有多余的退款、结果消息只写一条。
 *
 * 2. **商家 B 不被商家 A 堵住(#760 的原话)。** 商家 A 的 15 分钟视频和商家 B 的 20 秒图片
 *    同时在跑,断言 B 在 A 还在等供应商的时候就已经结算完成 —— 而不是排在 A 后面。
 *
 * 关于这里的假 Prisma:`updateMany` 是**同步**实现的(函数体内没有 await),所以它在 JS 里
 * 不可分割 —— 这正是数据库里一条带 WHERE 的 UPDATE 的语义,也正是 handleGen 依赖的那个
 * 「QUEUED→GENERATING 谁先谁得」的条件认领。用真数据库跑这件事需要 N 条连接和真事务,
 * 而要证的东西是**认领的胜负逻辑**,不是 Postgres 的锁 —— 后者早有 #463/#602 的集成测试。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

  /** WHERE matcher — supports the exact shapes gen.ts uses: literal, {in}, {lt}, {isEmpty}. */
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

  /**
   * The conditional claim, modelled as ONE indivisible step. No await inside ⇒ no other
   * delivery can interleave between the read and the write, which is exactly what a single
   * `UPDATE … WHERE status = 'QUEUED'` guarantees in Postgres.
   */
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows.get(where.id) ? { ...rows.get(where.id) } : null)),
      updateMany,
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
        // The real table has a partial-unique index on (genJobId) for the terminal kinds —
        // model it, so a duplicate delivery cannot post a second result message.
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
  return { prisma, rows, settleCredits, refundReservation, generateImages, storage, chatMessages, updateMany };
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

import { handleGen } from "./gen.js";

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
});

describe("并发下的 exactly-once:同一单被 N 个轮询器同时投递", () => {
  it("供应商只调一次、只结算一次、不产生退款、只写一条结果消息", async () => {
    seedJob({ id: "g1", ownerId: "orgA" });
    // A slow provider WIDENS the window every duplicate delivery has to race in.
    m.generateImages.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return outputs;
    });

    // Eight simultaneous deliveries of the SAME job — the shape localConcurrency makes possible.
    await Promise.all(Array.from({ length: 8 }, () => handleGen({ genJobId: "g1" }, 0)));

    expect(m.generateImages).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.chatMessages).toHaveLength(1);
    const row = m.rows.get("g1")!;
    expect(row.status).toBe("DONE");
    expect(row.spent).toBe(true);
    // The claim ran 8 times and only one of them can have won it.
    const claims = m.updateMany.mock.calls.filter((c) => c[0]?.data?.status === "GENERATING");
    expect(claims).toHaveLength(8);
  });

  it("重复投递也不会把已经交付的任务再跑一遍(resume 而非 re-spend)", async () => {
    seedJob({ id: "g2", ownerId: "orgA" });
    m.generateImages.mockResolvedValue(outputs);
    await handleGen({ genJobId: "g2" }, 0);
    expect(m.generateImages).toHaveBeenCalledTimes(1);

    // A late redelivery arrives after DONE — must be a pure no-op on the money path.
    await handleGen({ genJobId: "g2" }, 1);
    expect(m.generateImages).toHaveBeenCalledTimes(1);
    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("并发跑不同的单:每单各结算一次,没有串味", async () => {
    for (const id of ["a1", "a2", "a3", "a4"]) seedJob({ id, ownerId: `org-${id}` });
    m.generateImages.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return outputs;
    });

    await Promise.all(["a1", "a2", "a3", "a4"].map((id) => handleGen({ genJobId: id }, 0)));

    expect(m.generateImages).toHaveBeenCalledTimes(4);
    expect(m.settleCredits).toHaveBeenCalledTimes(4);
    expect(m.refundReservation).not.toHaveBeenCalled();
    for (const id of ["a1", "a2", "a3", "a4"]) expect(m.rows.get(id)!.status).toBe("DONE");
    // Each settle names its own tenant — a concurrent run must never settle against another org.
    const orgs = m.settleCredits.mock.calls.map((c) => (c[1] as { orgId: string }).orgId).sort();
    expect(orgs).toEqual(["org-a1", "org-a2", "org-a3", "org-a4"]);
  });
});

describe("#760:商家 B 不再被商家 A 的长视频堵死", () => {
  it("A 的长活还在等供应商时,B 的短活已经结算完成", async () => {
    seedJob({ id: "long", ownerId: "merchantA" });
    seedJob({ id: "short", ownerId: "merchantB" });

    const timeline: string[] = [];
    let releaseLong: (() => void) | undefined;
    const longStarted = new Promise<void>((resolve) => {
      m.generateImages.mockImplementation(async (req: { prompt: string }) => {
        if (req.prompt === "A: fifteen minute video") {
          timeline.push("A:provider-start");
          resolve();
          // Stands in for merchant A's 15-minute video: it does not come back until we say so.
          await new Promise<void>((r) => { releaseLong = r; });
          timeline.push("A:provider-end");
          return outputs;
        }
        timeline.push("B:provider-start");
        return outputs;
      });
    });

    (m.rows.get("long") as Record<string, unknown>).prompt = "A: fifteen minute video";
    (m.rows.get("short") as Record<string, unknown>).prompt = "B: quick image";

    m.settleCredits.mockImplementation((_tx: unknown, args: { orgId: string }) => {
      timeline.push(`settle:${args.orgId}`);
      return Promise.resolve();
    });

    // Both merchants press "generate" at the same moment. Under the old serial queue only one of
    // these two handlers could be in flight at a time.
    const a = handleGen({ genJobId: "long" }, 0);
    await longStarted; // A is now parked on the provider — the worst moment for B to arrive
    const b = handleGen({ genJobId: "short" }, 0);
    await b;

    // THE ASSERTION #760 is about: B is finished and paid for while A is still waiting.
    expect(timeline).toContain("settle:merchantB");
    expect(timeline).not.toContain("A:provider-end");
    expect(m.rows.get("short")!.status).toBe("DONE");
    expect(m.rows.get("long")!.status).toBe("GENERATING");

    releaseLong!();
    await a;
    expect(m.rows.get("long")!.status).toBe("DONE");
    // Both merchants paid exactly once, and neither was refunded for the other's traffic.
    expect(m.settleCredits).toHaveBeenCalledTimes(2);
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("B 的失败不会牵连 A:一单失败退款,另一单照常结算", async () => {
    seedJob({ id: "ok", ownerId: "merchantA" });
    seedJob({ id: "boom", ownerId: "merchantB" });
    (m.rows.get("boom") as Record<string, unknown>).prompt = "explode";
    m.generateImages.mockImplementation(async (req: { prompt: string }) => {
      await new Promise((r) => setTimeout(r, 5));
      if (req.prompt === "explode") throw Object.assign(new Error("provider said no"), { charged: true });
      return outputs;
    });

    // allSettled: a terminal-failed job still RE-THROWS (sanitized) so pg-boss owns the retry
    // bookkeeping. What matters here is that the throw stays inside its own handler.
    const settled = await Promise.allSettled([handleGen({ genJobId: "ok" }, 2), handleGen({ genJobId: "boom" }, 2)]);
    expect(settled[0]!.status).toBe("fulfilled");
    expect(settled[1]!.status).toBe("rejected");

    expect(m.settleCredits).toHaveBeenCalledTimes(1);
    expect((m.settleCredits.mock.calls[0]![1] as { orgId: string }).orgId).toBe("merchantA");
    expect(m.refundReservation).toHaveBeenCalledTimes(1);
    expect((m.refundReservation.mock.calls[0]![1] as { orgId: string }).orgId).toBe("merchantB");
    expect(m.rows.get("ok")!.status).toBe("DONE");
    expect(m.rows.get("boom")!.status).toBe("FAILED");
  });
});
