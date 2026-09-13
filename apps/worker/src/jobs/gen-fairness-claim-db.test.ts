/**
 * gen-fairness-claim-db.test.ts — #1388(零排队③)验收句逐字,在**真库**上、用**真 claim 路径**证。
 *
 * 判官 BLOCK 回炉定向③:验收句不再挂 e2e 旅程(那边没有 worker,断言即种子,证明力是同义反复;
 * 且旧的 journey 24 与已合并的 #1427 撞号)。真派发决策(公平闸让位/放行)现在挂在这份**真
 * Postgres + 真 `handleGen` + 真 QUEUED→GENERATING CAS**的集成测试上——mock 的只有付费引擎
 * 和对象存储(同 gen-receipt-db.test.ts 的既定分工),组织、项目、GenJob 行、认领路径全是真的。
 *
 * 场景对照:公平闸的兜底上限是 N-1(N=4,`WORKER_ROLE=wait` 下 gen 队列的槽位数),所以商家 A
 * 连发 4 条长视频、前 3 条(N-1)已经在飞(GENERATING)是这道闸的**触发条件**,不是需要另外
 * 证明的东西(那是 #796/#760 的既有并发,gen-concurrency.test.ts 已经证过)。这份测试要证的是
 * 它之后发生的事:A 自己排队中的第 4 条让位,商家 B 的短任务不用排在它后面。
 *
 * 走查(第三轮)负责的是①②③叠加之后的**整体真实体验**(真开第二台 worker、真把并发打开、
 * 真人在真产品里点),这份测试负责的是**这一个 claim 路径的机制**——分工写在 PR 描述里。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits } from "@fikirtive/db";
import { __setProviderRequestGateForTests, RequestGate } from "@fikirtive/generation";
import { handleGen } from "./gen.js";

const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000;
const CAP = 3; // N-1,N=4(WAIT_DEFAULTS[GEN_QUEUE])

type Org = { orgId: string; projectId: string };

async function seedOrg(): Promise<Org> {
  const orgId = `org_${randomUUID()}`;
  const projectId = `prj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Fairness claim path" } });
  return { orgId, projectId };
}

async function seedGenJob(org: Org, opts: { id: string; status: "QUEUED" | "GENERATING"; kind?: "IMAGE" | "VIDEO"; reserve?: boolean }): Promise<void> {
  await prisma.genJob.create({
    data: {
      id: opts.id,
      ownerId: org.orgId,
      projectId: org.projectId,
      prompt: opts.kind === "VIDEO" ? "a fifteen minute product walkthrough" : "a quick poster",
      kind: (opts.kind ?? "IMAGE") as never,
      model: opts.kind === "VIDEO" ? "seedance-2-mini" : "seedream",
      count: 1,
      status: opts.status as never,
      spent: false,
      ...(opts.status === "GENERATING" ? { startedAt: new Date() } : {}),
    },
  });
  if (opts.reserve) {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: org.orgId, refId: opts.id, cost: HOLD }));
  }
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(() => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));
  m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);
  process.env.WORKER_ROLE = "wait";
  __setProviderRequestGateForTests(undefined);
});

afterEach(() => {
  delete process.env.WORKER_ROLE;
  __setProviderRequestGateForTests(undefined);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** 撞限速:闸门 limit=1、立刻占用且从不释放 ⇒ inFlight(1) >= limit(1)。 */
async function saturateProviderGate(): Promise<void> {
  const gate = new RequestGate(1);
  await gate.acquire();
  __setProviderRequestGateForTests(gate);
}

describe(
  "商家 A 连发 4 条长视频后，商家 B 的短任务立即开跑不等队",
  () => {
    it(
      "真库 + 真 claim 路径:A 前 3 条(N-1)已在飞、第 4 条撞限速时让位;B 的 QUEUED 立即被真认领并结算,不等在 A 的第 4 条后面",
      async () => {
        const merchantA = await seedOrg();
        const merchantB = await seedOrg();

        // A 连发 4 条长视频:前 3 条(公平闸的兜底上限 N-1)已经在飞——这是触发条件,不是本
        // 测试要证明的东西(#796/#760 的既有并发已经证过)。
        const aRunningIds = await Promise.all(
          Array.from({ length: CAP }, async (_, i) => {
            const id = `gen_a_run${i}_${randomUUID()}`;
            await seedGenJob(merchantA, { id, status: "GENERATING", kind: "VIDEO" });
            return id;
          }),
        );
        const aFourthId = `gen_a_4th_${randomUUID()}`;
        await seedGenJob(merchantA, { id: aFourthId, status: "QUEUED", kind: "VIDEO" });

        // B 的短任务,在 A 的 4 条之后才提交,带着真预扣(它要真的走完认领→结算)。
        const bJobId = `gen_b_${randomUUID()}`;
        await seedGenJob(merchantB, { id: bJobId, status: "QUEUED", kind: "IMAGE", reserve: true });

        // 撞限速:供应商闸门饱和(公平闸的外层触发条件,判官安全定向②)。
        await saturateProviderGate();

        // A 自己排队中的第 4 条:撞限速 + 占满 N-1 + B 在等,三条同时成立 ⇒ 真的让位。
        const aOutcome = await handleGen({ genJobId: aFourthId }, 0);
        expect(aOutcome).toMatchObject({ deferredForFairness: true });
        expect(m.generateVideo).not.toHaveBeenCalled();
        const aFourthRow = await prisma.genJob.findFirstOrThrow({ where: { id: aFourthId, ownerId: merchantA.orgId }, select: { status: true, spent: true } });
        expect(aFourthRow.status).toBe("QUEUED"); // 未被认领——不是「认领了又回滚」
        expect(aFourthRow.spent).toBe(false);

        // B 的短任务:它自己没有占满 N-1 槽,公平闸判据在它身上不成立——真认领、真结算,
        // 不用排在 A 被让位的第 4 条后面。
        const bOutcome = await handleGen({ genJobId: bJobId }, 0);
        expect(bOutcome).toBeUndefined();
        expect(m.generateImages).toHaveBeenCalledTimes(1);
        const bRow = await prisma.genJob.findFirstOrThrow({ where: { id: bJobId, ownerId: merchantB.orgId }, select: { status: true, spent: true } });
        expect(bRow.status).toBe("DONE");
        expect(bRow.spent).toBe(true);

        // 不等队的另一半,直接核对数据库:A 被让位的第 4 条依旧原样留在 QUEUED,A 自己占用
        // 的 GENERATING 槽位没有超过公平闸的兜底上限(N-1=3)。
        const aFourthStillQueued = await prisma.genJob.findFirstOrThrow({ where: { id: aFourthId, ownerId: merchantA.orgId }, select: { status: true } });
        expect(aFourthStillQueued.status).toBe("QUEUED");
        const aGenerating = await prisma.genJob.count({ where: { ownerId: merchantA.orgId, status: "GENERATING" as never } });
        expect(aGenerating).toBe(CAP);
        void aRunningIds; // 仅用于占位/可读性,断言已经覆盖它们的 GENERATING 计数
      },
      DB_CASE_TIMEOUT_MS,
    );
  },
);
