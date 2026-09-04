/**
 * canvas-variation-confirm-ledger —— 变体确认卡按下 `Generate · N credits` 之后，
 * **账本上真的发生了什么**。
 *
 * 规格：`docs/specs/creation-engine.md` 验收 **CREATE-A1**（花钱前先见确认；画布路径的判定
 * 落在确认卡片上）。触发＝Codex 只读走查 **QA-CRE-FE9-001**（P0，`Create variations` 一击
 * 即 reserve）＋ Founder 2026-09-04 07:05 裁决「第一下只开确认，按 Generate 才预留」。
 *
 * 界面那一头（第一下零调用、Cancel 零调用、CTA 逐字 `Generate · N credits`、报不出价不给按）
 * 钉在 `canvas-variation-confirm.test.ts`；这一份只证钱：
 *   · 按一次 `Generate · N credits` ⇒ **恰好一组** reserve → settle，
 *     报价 == `reserve:<jobId>` 绝对值 == `settle:<jobId>` 绝对值；
 *   · 失败那条路同形：恰好一组 reserve → refund，余额净变化 0；
 *   · **连按两下** ⇒ 确认卡交出的是同一个 actionId ⇒ 同一个幂等键 ⇒ 一个 job、一组账本，
 *     第二下拿回 `reused`（这就是「复用直出那条路已有的幂等边界」的账本证据）；
 *   · 换了材料（比如换一张源图）才是**另一次**授权：另一个键、另一组账本。
 *
 * 真 Postgres(*_test)、真 Prisma、真 credit ledger（经真 `startCanvasGen` → `startGen` 的
 * `reserveCredits`）；worker 的结算走它自己那两个函数（`settleCredits`/`refundReservation`）
 * 原样模拟 —— 零真实 provider 调用、零真实花费。只有 startGen 周边的 web 管线是替身
 * （auth guard、impersonation、queue、guardian、model registry、next/cache），与
 * `gen-ledger.test.ts` / `otto-resolution-tier-ledger.test.ts` 同一套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { displayCredits, pricedGenCredits } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
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
const { canvasActionKey } = await import("../batch-idempotency");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");

const PROMPT = "a cup steaming on a rattan mat";

// ── real-DB helpers (gen-ledger pattern) ─────────────────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Variation confirm ledger test" } });
  return id;
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({ where: { ownerId, projectId }, select: { id: true, status: true, idempotencyKey: true } });
}
async function workerSettle(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "DONE", spent: true, finishedAt: new Date() } });
}
async function workerRefund(ownerId: string, jobId: string) {
  await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: jobId }));
  await prisma.genJob.update({ where: { id: jobId, ownerId }, data: { status: "FAILED", error: "provider failed", finishedAt: new Date() } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}

/**
 * 确认卡按下 `Generate · N credits` 那一刻真正发出去的东西。
 *
 * 形状照抄 `FlowCanvas.runImageEvolve` → `useCanvasGen.generateImage` 那条路：一张源图、
 * count 1、卡自己记着的形状，外加**确认卡上那个 actionId**。同一次确认（含双击）交出同一个
 * actionId —— 幂等键由服务端从它算出来，调用方一个字都不许出。
 */
function confirmPress(over: { projectId: string; actionId: string; sourceGenerationId?: string }) {
  return {
    actionId: over.actionId,
    expectedCredits: DISPLAY_QUOTE,
    projectId: over.projectId,
    prompt: PROMPT,
    entityIds: [],
    count: 1,
    kind: "image" as const,
    model: "seedream" as const,
    aspectRatio: "9:16",
    ...(over.sourceGenerationId ? { sourceGenerationId: over.sourceGenerationId } : {}),
  };
}

/** 单一价目源现算的那个数（内部 credits）—— 账本上的绝对值就是它。零字面量。 */
const QUOTE = pricedGenCredits({
  kind: "IMAGE", model: "seedream", count: 1, referenceVideoGenerationId: null, videoOptions: null,
});
/** 确认卡渲染给商家看的那个数（显示 credits）—— `startCanvasGen` 的价格绑定核的就是它，
 *  所以这里必须与 `useCanvasGen` 送出去的同一口径，不能拿内部数冒充。 */
const DISPLAY_QUOTE = displayCredits(QUOTE);

function idOf(res: Awaited<ReturnType<typeof startCanvasGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A1 —— 变体确认卡：按 Generate 才动钱，一次确认一组账本", () => {
  it("CREATE-A1: 按一次 `Generate · N credits` ⇒ 恰好一组 reserve → settle，报价 == reserve == settle", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const before = await account(ownerId);
    const res = idOf(await startCanvasGen(confirmPress({ projectId, actionId: `canvas-action-${randomUUID()}` })));
    expect(res.disposition).toBe("fresh");

    // ① 预留：恰好一行，数就是确认卡上那个数。
    const afterReserve = await ledger(ownerId);
    const reserves = afterReserve.filter((r) => r.kind === "RESERVE");
    expect(reserves).toHaveLength(1);
    expect(reserves[0]!.refId).toBe(res.id);
    expect(reserves[0]!.reservedDelta).toBe(QUOTE);
    expect(reserves[0]!.balanceDelta).toBe(-QUOTE);
    expect((await account(ownerId)).balance).toBe(before.balance - QUOTE);

    // ② 结算：worker 从 RESERVE 行读金额，不重算价。
    await workerSettle(ownerId, res.id);
    const rows = await ledger(ownerId);
    const settles = rows.filter((r) => r.kind === "SETTLE");
    expect(settles).toHaveLength(1);
    expect(settles[0]!.refId).toBe(res.id);
    expect(Math.abs(settles[0]!.reservedDelta)).toBe(QUOTE);
    // 一组就是一组：整本账上只有这两行。
    expect(rows).toHaveLength(2);
    expect((await jobs(ownerId, projectId))).toHaveLength(1);
  });

  it("CREATE-A1: 生成失败 ⇒ 恰好一组 reserve → refund，余额净变化 0", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const res = idOf(await startCanvasGen(confirmPress({ projectId, actionId: `canvas-action-${randomUUID()}` })));
    await workerRefund(ownerId, res.id);

    const rows = await ledger(ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "SETTLE")).toHaveLength(0);
    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000);
    expect(acct.reserved).toBe(0);
  });

  it("CREATE-A1: 连按两下 `Generate · N credits` ⇒ 同一个键、一个 job、一组账本（不产生第二组）", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    // 一次确认 = 一个 actionId。双击交出的是同一个,所以服务端算出的是同一个键。
    const actionId = `canvas-action-${randomUUID()}`;

    const first = idOf(await startCanvasGen(confirmPress({ projectId, actionId })));
    const second = idOf(await startCanvasGen(confirmPress({ projectId, actionId })));

    expect(second.id).toBe(first.id);
    // 契约上的字就是 `reused`：同一个还活着的键 ⇒ 拿回同一单，不是第二单。
    expect(second.disposition).toBe("reused");
    const rows = await ledger(ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await account(ownerId)).balance).toBe(1000 - QUOTE);
    // 键由服务端从 actionId 算，调用方出不了键。
    expect((await jobs(ownerId, projectId))[0]!.idempotencyKey).toBe(canvasActionKey(actionId).key);
  });

  it("CREATE-A1: 真的并发双击（两个请求一起飞）也只有一组账本", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const actionId = `canvas-action-${randomUUID()}`;

    const [a, b] = await Promise.all([
      startCanvasGen(confirmPress({ projectId, actionId })),
      startCanvasGen(confirmPress({ projectId, actionId })),
    ]);

    expect(idOf(a).id).toBe(idOf(b).id);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await account(ownerId)).balance).toBe(1000 - QUOTE);
  });

  it("CREATE-A1: 换一张源图再确认 ⇒ 另一次授权、另一个键、另一组账本（不是重放）", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const first = idOf(await startCanvasGen(confirmPress({
      projectId, actionId: `canvas-action-${randomUUID()}`, sourceGenerationId: `gen_${randomUUID()}`,
    })));
    const second = idOf(await startCanvasGen(confirmPress({
      projectId, actionId: `canvas-action-${randomUUID()}`, sourceGenerationId: `gen_${randomUUID()}`,
    })));

    expect(second.id).not.toBe(first.id);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(2);
    expect(await jobs(ownerId, projectId)).toHaveLength(2);
    expect((await account(ownerId)).balance).toBe(1000 - QUOTE * 2);
  });
});
