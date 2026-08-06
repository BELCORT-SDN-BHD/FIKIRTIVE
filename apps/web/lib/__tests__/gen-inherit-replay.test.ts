/**
 * #656 P1 —— 形状继承不得破坏 exactly-once 重放(真 Postgres、真 Prisma、真信用账本)。
 *
 * 判词(T1+T2 跨族回看,2026-08-06):
 *   「`gen-actions.ts:113` 把快照读取的一切异常吞成 null;`batch-idempotency.ts:155` 将其
 *    物化为 1:1;继承重算发生在精确键重放核对**之前**(`gen-actions.ts:317`)。⇒「响应丢失后
 *    的合法重试」若恰逢一次瞬时读错,9:16(原)对 1:1(重算)被 `gen-actions.ts:166` 判
 *    conflict;客户端把 conflict 当确定性拒绝,删除耐久动作回执(`useCanvasGen.ts:264,607`);
 *    下一次点击获新 actionId,可在旧任务存活时再次 reserve —— 非 fail-closed,存在双扣可能。」
 *
 * 商家视角的那一幕:「改这张图」出的是竖版,第一次点击其实已经落库扣款,只是回应丢在路上;
 * 商家原地重试,而这一瞬数据库抖了一下 —— 于是同一个动作被判成「换了内容」,回执被删,
 * 再点一次就是一笔新钱。
 *
 * 本文件钉死的行为:
 *  ① 快照读**出错**是「结果不明」,必须上抛成可重试错误 —— 不判 conflict、不物化成默认形状、
 *     绝不产生第二笔 reserve;
 *  ② 故障过去后同一个 actionId 重放,拿回原来那一单(一次 reserve,一个任务);
 *  ③ 对照:源头**真的没有**快照(迁移前老行)仍诚实回落 1:1 —— 「读不到」与「读出错」是两种状态。
 *
 * 一个积分都花不出去:provider 从不被调用,worker 从不跑,只有 startGen 周边的 web 接线被替身
 * (auth guard、impersonation、队列、guardian、model registry、next/cache)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startCanvasGen } = await import("../gen-actions");
const { prisma } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // 1 张图 = 1 个显示积分 = 10 个内部单位

async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Inherit replay test" } });
  return id;
}
/** 源图那一单 —— 继承画幅的唯一依据就是它入队时冻结的规格快照。 */
async function seedSourceImage(
  ownerId: string,
  projectId: string,
  imageOptions: { aspectRatio: string } | null,
): Promise<string> {
  const generationId = `gen_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: `job_${randomUUID()}`,
      ownerId,
      projectId,
      prompt: "the original product shot",
      kind: "IMAGE",
      model: "seedream",
      count: 1,
      status: "DONE",
      generationIds: [generationId],
      ...(imageOptions ? { imageOptions } : {}),
    },
  });
  return generationId;
}
async function reserves(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId, kind: "RESERVE" }, orderBy: { createdAt: "asc" } });
}
async function canvasJobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({ where: { ownerId, projectId, idempotencyKey: { not: null } }, select: { id: true, imageOptions: true } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}

/**
 * 那一次瞬时读错。只打继承快照那一条读(它是唯一按 `generationIds` 找源单的查询),
 * 其余每一条读都照常走真数据库 —— 所以红的只可能是「吞异常」这一条路。
 */
type FindFirst = (args?: unknown) => Promise<unknown>;
const genJobModel = prisma.genJob as unknown as { findFirst: FindFirst };
const realGenJobFindFirst: FindFirst = genJobModel.findFirst.bind(genJobModel);

function breakSnapshotRead(): () => void {
  genJobModel.findFirst = (args?: unknown) => {
    const where = (args as { where?: Record<string, unknown> } | undefined)?.where;
    if (where && "generationIds" in where) {
      return Promise.reject(new Error("transient snapshot read failure"));
    }
    return realGenJobFindFirst(args);
  };
  return () => {
    genJobModel.findFirst = realGenJobFindFirst;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#656 P1 —— 继承快照读故障不得变成 conflict,更不得变成第二次 reserve", () => {
  it("响应丢失后的合法重试 + 一次瞬时读错:返回可重试错误,不判 conflict,账本只有一次 reserve", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const sourceGenerationId = await seedSourceImage(ownerId, projectId, { aspectRatio: "9:16" });

    const actionId = `action-${randomUUID()}`;
    const request = {
      actionId,
      expectedCredits: 1,
      projectId,
      prompt: "make the background warmer",
      count: 1,
      kind: "image" as const,
      model: "seedream",
      sourceGenerationId,
    };

    // ① 第一次请求:成功落库(继承出 9:16),但回应丢在路上,商家什么也没看见。
    const first = await startCanvasGen(request);
    if ("error" in first) throw new Error(first.error);
    expect(first.disposition).toBe("fresh");
    const accepted = await prisma.genJob.findFirstOrThrow({ where: { id: first.id, ownerId }, select: { imageOptions: true } });
    expect(accepted.imageOptions).toEqual({ aspectRatio: "9:16" });
    expect(await reserves(ownerId)).toHaveLength(1);

    // ② 合法重试,恰逢一次瞬时读错。
    const restore = breakSnapshotRead();
    const retry = await startCanvasGen(request);
    restore();

    // 「结果不明」必须原样说出来:不是拒绝,不是内容冲突。
    expect("error" in retry).toBe(true);
    if (!("error" in retry)) throw new Error("expected an error");
    expect(retry.disposition).not.toBe("conflict");
    expect(retry.disposition).toBe("retryable");
    expect(retry.refunded).toBeUndefined();

    // 钱路:一次也没有多扣,一单也没有多开。
    expect(await reserves(ownerId)).toHaveLength(1);
    expect(await canvasJobs(ownerId, projectId)).toHaveLength(1);
    const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: ownerId } });
    expect(account.reserved).toBe(IMG);
    expect(account.balance).toBe(1000 - IMG);
  });

  it("故障过去后,同一个 actionId 拿回原来那一单 —— 一次 reserve,一个任务", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const sourceGenerationId = await seedSourceImage(ownerId, projectId, { aspectRatio: "9:16" });

    const request = {
      actionId: `action-${randomUUID()}`,
      expectedCredits: 1,
      projectId,
      prompt: "make the background warmer",
      count: 1,
      kind: "image" as const,
      model: "seedream",
      sourceGenerationId,
    };

    const first = await startCanvasGen(request);
    if ("error" in first) throw new Error(first.error);

    const restore = breakSnapshotRead();
    await startCanvasGen(request);
    restore();

    const replay = await startCanvasGen(request);
    expect(replay).toEqual({ id: first.id, disposition: "reused" });
    expect(await reserves(ownerId)).toHaveLength(1);
    expect(await canvasJobs(ownerId, projectId)).toHaveLength(1);
  });

  it("对照:源头真的没有快照(迁移前的老行)仍诚实回落 1:1,照常受理", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const sourceGenerationId = await seedSourceImage(ownerId, projectId, null);

    const accepted = await startCanvasGen({
      actionId: `action-${randomUUID()}`,
      expectedCredits: 1,
      projectId,
      prompt: "make the background warmer",
      count: 1,
      kind: "image" as const,
      model: "seedream",
      sourceGenerationId,
    });
    if ("error" in accepted) throw new Error(accepted.error);
    expect(accepted.disposition).toBe("fresh");
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: accepted.id, ownerId }, select: { imageOptions: true } });
    expect(job.imageOptions).toEqual({ aspectRatio: "1:1" });
    expect(await reserves(ownerId)).toHaveLength(1);
  });
});
