/**
 * gen-fairness-claim-db.test.ts — #1388(零排队③交付的④:公平兜底),在**真库**上、用**真 claim
 * 路径**证。
 *
 * 判官复核回炉 P1-1(2026-09-13):验收句原话「商家 A 连发 4 条长视频后，商家 B 的短任务立即
 * 开跑不等队」**不在这份测试要证的范围内**——判官实证:把 gen.ts 回滚到 main(没有公平闸)
 * 之后,「B 不等在 A 后面」这条断言依旧绿,因为 B 能被认领从来就不取决于 A 有没有让位(B 自己
 * 没有占满 N-1 槽,公平闸的判据从一开始就不管它)。这份测试真正证的是**公平闸让位这一件事
 * 本身**:撞限速时,已经占满兜底上限的商家的下一次认领会让位,而不是不管三七二十一继续认领。
 *
 * 验收句的完整语义需要规格③(等待型并发提升,抬 `WAIT_DEFAULTS[GEN_QUEUE]`)——在 gate=6(单
 * 副本默认)下 N 无法超过今天的 4(`clock-invariants.test.ts` 已钉板:N=5 即打平 GEN_STALE_MS
 * 35m),而且验收句字面那个最小场景(只有 A 的 4 条视频,没有别的流量)按今天的实现**走不到
 * 让位**:A 的第 4 条视频尝试认领时,闸门在途请求数只有 3(A 自己前 3 条视频各占 1 格),小于
 * 闸位 6,没有撞限速,公平闸的外层判据直接放行,A 的第 4 条照常认领、占满全部 4 槽,B 要等到
 * 某一条视频结束(最坏约 16m)。这一整段登记在 `docs/specs/creation-engine.md` §5 2026-09-13
 * 条目,留给 Founder 裁范围——不是这份测试文件、也不是这张票能单方面兑现的东西。
 *
 * 场景对照:公平闸的兜底上限是 N-1(N=4,`WORKER_ROLE=wait` 下 gen 队列的槽位数),所以商家 A
 * 前 3 条(N-1)已经在飞(GENERATING)是这道闸的**触发条件**,不是需要另外证明的东西(那是
 * #796/#760 的既有并发,gen-concurrency.test.ts 已经证过)。这份测试要证的是它之后发生的事:
 * 撞限速时,A 自己排队中的第 4 条让位;而**独立地**,商家 B 的任务照常被认领(它没有占满 N-1
 * 槽,判据在它身上不成立)——两件事各自成立,不是「A 让位所以 B 才能走」的因果链。
 *
 * mock 的只有付费引擎和对象存储(同 gen-receipt-db.test.ts 的既定分工),组织、项目、GenJob
 * 行、认领路径全是真的。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  submitVideo: vi.fn(),
  pollVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, submitVideo: m.submitVideo, pollVideo: m.pollVideo } }));
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
  "撞厂商限速时，占满 N-1 槽的商家让位，等待中的别家立即被认领",
  () => {
    it(
      "真库 + 真 claim 路径:A 前 3 条(N-1)已在飞、第 4 条撞限速时让位(status 仍 QUEUED、未认领、未扣款);B 的 QUEUED 独立地被真认领并结算",
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
        expect(m.submitVideo).not.toHaveBeenCalled();
        const aFourthRow = await prisma.genJob.findFirstOrThrow({ where: { id: aFourthId, ownerId: merchantA.orgId }, select: { status: true, spent: true } });
        expect(aFourthRow.status).toBe("QUEUED"); // 未被认领——不是「认领了又回滚」
        expect(aFourthRow.spent).toBe(false);

        // B 的短任务:它自己没有占满 N-1 槽,公平闸判据在它身上不成立(与 A 是否让位无关)
        // ——独立地真认领、真结算。
        const bOutcome = await handleGen({ genJobId: bJobId }, 0);
        expect(bOutcome).toBeUndefined();
        expect(m.generateImages).toHaveBeenCalledTimes(1);
        const bRow = await prisma.genJob.findFirstOrThrow({ where: { id: bJobId, ownerId: merchantB.orgId }, select: { status: true, spent: true } });
        expect(bRow.status).toBe("DONE");
        expect(bRow.spent).toBe(true);

        // 让位那一半的另一处核对,直接看数据库:A 被让位的第 4 条依旧原样留在 QUEUED,A 自己
        // 占用的 GENERATING 槽位没有超过公平闸的兜底上限(N-1=3)。
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
