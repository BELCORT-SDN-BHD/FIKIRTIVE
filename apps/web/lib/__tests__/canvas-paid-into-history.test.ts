/**
 * canvas-paid-into-history —— 画布上**节点级**付费出图出片，写不写进这块画布的对话历史。
 *
 * 规格：`docs/specs/creation-engine.md` 验收 **CREATE-A1**（画布路径的判定落在 Otto 确认
 * 卡片上）。触发＝Founder 2026-09-04 20:45 裁决(编排者代记)：「画布即对话 → 落成规则。
 * 画布上任何付费出图出片都写进这张画布的对话历史（请求、确认、结果），刷新与换浏览器都在。」
 *
 * 主输入框那条路(PR #1211)已经是这样了；这一份钉的是从前一格未动的那四条节点级路：
 * 卡上的「再来一张」(`FlowCanvas.runImageEvolve`)、Animate、视频「照这条再来一次」、
 * t2v 弹窗。四条都经 `useCanvasGen` → `startCanvasGen` → `startGen`，形状照抄
 * `canvas-variation-confirm-ledger.test.ts`。
 *
 * 证四件事：
 *   ① 按下即落 **USER**(动作原话)＋**一张已批准状态的卡**(有 genJobId ⇒ 不可再批)；
 *   ② 卡上那个数就是这一趟真的预扣的那个数 —— 与 `reserve:<jobId>` 绝对值同源，不新算；
 *   ③ **幂等**：同一个动作重试(同一个 actionId)⇒ 一个 job、一组账本、**历史不重复落**；
 *   ④ 这张卡在付费入口 fail closed：直接拿它去 `startCoworkGen` 一律拒，$0、零新增 job。
 *
 * 变异证伪：把 `startGen` 里那次 `appendCanvasPaidAction` 去掉 ⇒ ①③ 全红。
 *
 * 真 Postgres(*_test)、真 Prisma、真 ledger；零真实 provider 调用、零真实花费。
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

const { startCanvasGen, startCoworkGen } = await import("../gen-actions");
const { CANVAS_PAID_ACTION_TEXT } = await import("../canvas-thread-log");
const { prisma } = await import("@fikirtive/db");

const IMAGE_PROMPT = "a cup steaming on a rattan mat";
const VIDEO_PROMPT = "slow push in on the cup";

const IMAGE_QUOTE = displayCredits(pricedGenCredits({
  kind: "IMAGE", model: "seedream", count: 1, referenceVideoGenerationId: null, videoOptions: null,
}));
const VIDEO_QUOTE = displayCredits(pricedGenCredits({
  kind: "VIDEO", model: "seedance-2-mini", count: 1, referenceVideoGenerationId: null,
  videoOptions: { seconds: 5, resolution: "720p" },
}));

async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Canvas paid into history" } });
  return id;
}
/** 这块画布上那条活着的对话 —— 节点级动作要落进去的正是它。 */
async function seedThread(ownerId: string, projectId: string): Promise<string> {
  const id = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id, ownerId, projectId, title: "Untitled", surface: "canvas" } });
  return id;
}
/** 商家画布上那张已经出好的图 —— 「再来一张」/ Animate 的底图。 */
async function seedGeneration(ownerId: string, projectId: string): Promise<string> {
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId,
      ownerId,
      contentHash: randomUUID().replace(/-/g, ""),
      ext: "png",
      mime: "image/png",
      sizeBytes: BigInt(1024),
      source: "GENERATED",
    },
  });
  const id = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id, ownerId, projectId, shotId: null, assetId,
      source: "GENERATED", promptText: IMAGE_PROMPT, entitySnapshot: { entities: [] },
    },
  });
  return id;
}
async function history(ownerId: string, threadId: string) {
  return prisma.chatMessage.findMany({ where: { ownerId, threadId }, orderBy: { seq: "asc" } });
}
async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
function idOf(res: Awaited<ReturnType<typeof startCanvasGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

/** 「再来一张」那一下真正发出去的东西（`useCanvasGen.generateImage` 的形状）。 */
function makeAnotherPress(over: { projectId: string; threadId: string; actionId: string; sourceGenerationId: string }) {
  return {
    actionId: over.actionId,
    expectedCredits: IMAGE_QUOTE,
    projectId: over.projectId,
    threadId: over.threadId,
    prompt: IMAGE_PROMPT,
    entityIds: [],
    count: 1,
    kind: "image" as const,
    model: "seedream" as const,
    aspectRatio: "9:16",
    sourceGenerationId: over.sourceGenerationId,
  };
}

/** t2v 弹窗那一下（没有首帧的付费出片）。 */
function makeVideoPress(over: { projectId: string; threadId: string; actionId: string }) {
  return {
    actionId: over.actionId,
    expectedCredits: VIDEO_QUOTE,
    projectId: over.projectId,
    threadId: over.threadId,
    prompt: VIDEO_PROMPT,
    entityIds: [],
    count: 1,
    kind: "video" as const,
    model: "seedance-2-mini" as const,
    durationSeconds: 5,
    resolution: "720p",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CREATE-A1 —— 画布节点级付费动作进对话历史（请求＋确认）", () => {
  it("CREATE-A1: 「再来一张」按下即在这块画布的对话里落一条 USER 与一张已批准的卡", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const sourceGenerationId = await seedGeneration(ownerId, projectId);

    expect(await history(ownerId, threadId)).toHaveLength(0);

    const job = idOf(await startCanvasGen(makeAnotherPress({
      projectId, threadId, sourceGenerationId, actionId: `canvas-action-${randomUUID()}`,
    })));
    expect(job.disposition).toBe("fresh");

    const messages = await history(ownerId, threadId);
    expect(messages.map((m) => [m.role, m.kind])).toEqual([["USER", "TEXT"], ["AGENT", "GEN_CARD"]]);

    // ① 请求 —— 动作原话（服务端闭集）＋商家自己那句话。
    expect(messages[0]!.text).toBe(`${CANVAS_PAID_ACTION_TEXT.makeAnother}: ${IMAGE_PROMPT}`);

    // ② 确认 —— 卡面那个数就是这一趟真的预扣的那个数（同一份 pricedGenCredits）。
    const card = messages[1]!;
    const payload = card.payload as Record<string, unknown>;
    expect(payload.estimatedCredits).toBe(IMAGE_QUOTE);
    expect(payload.structuredPrompt).toBe(IMAGE_PROMPT);
    expect(payload.kind).toBe("image");
    expect(payload.specChips).toContain("9:16");
    const reserve = (await ledger(ownerId)).filter((row) => row.refId === job.id && row.kind === "RESERVE");
    expect(reserve).toHaveLength(1);
    expect(displayCredits(reserve[0]!.reservedDelta)).toBe(payload.estimatedCredits);

    // 已批准状态 —— 卡上写着它自己那一行任务，于是 `deriveCardState` 永远不是 idle，
    // 界面上不可能再出一次 `Generate · N credits`。
    expect(card.genJobId).toBe(job.id);
  });

  it("CREATE-A1: t2v 弹窗那一下同形——USER 说 Make a video，卡按视频档报价", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);

    const job = idOf(await startCanvasGen(makeVideoPress({
      projectId, threadId, actionId: `canvas-action-${randomUUID()}`,
    })));

    const messages = await history(ownerId, threadId);
    expect(messages.map((m) => [m.role, m.kind])).toEqual([["USER", "TEXT"], ["AGENT", "GEN_CARD"]]);
    expect(messages[0]!.text).toBe(`${CANVAS_PAID_ACTION_TEXT.makeVideo}: ${VIDEO_PROMPT}`);
    const payload = messages[1]!.payload as Record<string, unknown>;
    expect(payload.kind).toBe("video");
    expect(payload.estimatedCredits).toBe(VIDEO_QUOTE);
    expect(messages[1]!.genJobId).toBe(job.id);
  });

  it("CREATE-A1: Animate 那一下的卡说「你的图会成为第一帧」，动作原话是 Animate this", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const sourceGenerationId = await seedGeneration(ownerId, projectId);

    idOf(await startCanvasGen({
      ...makeVideoPress({ projectId, threadId, actionId: `canvas-action-${randomUUID()}` }),
      sourceGenerationId,
    }));

    const messages = await history(ownerId, threadId);
    expect(messages[0]!.text).toBe(`${CANVAS_PAID_ACTION_TEXT.animate}: ${VIDEO_PROMPT}`);
    const payload = messages[1]!.payload as Record<string, unknown>;
    expect(payload.canvasAction).toBe("animate");
  });

  it("CREATE-A1: 同一个动作重试（同一 actionId）⇒ 一个 job、一组账本、历史不重复落", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const sourceGenerationId = await seedGeneration(ownerId, projectId);
    const actionId = `canvas-action-${randomUUID()}`;

    const first = idOf(await startCanvasGen(makeAnotherPress({ projectId, threadId, sourceGenerationId, actionId })));
    const second = idOf(await startCanvasGen(makeAnotherPress({ projectId, threadId, sourceGenerationId, actionId })));
    expect(second.id).toBe(first.id);
    expect(second.disposition).toBe("reused");

    expect(await history(ownerId, threadId)).toHaveLength(2);
    expect(await prisma.genJob.count({ where: { ownerId, projectId } })).toBe(1);
    expect((await ledger(ownerId)).filter((row) => row.kind === "RESERVE")).toHaveLength(1);
  });

  it("CREATE-A1: 画布铸出来的这张卡进不了付费入口——直接调 startCoworkGen 一律拒，$0", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const sourceGenerationId = await seedGeneration(ownerId, projectId);

    idOf(await startCanvasGen(makeAnotherPress({
      projectId, threadId, sourceGenerationId, actionId: `canvas-action-${randomUUID()}`,
    })));
    const card = (await history(ownerId, threadId))[1]!;
    const jobsBefore = await prisma.genJob.count({ where: { ownerId, projectId } });
    const ledgerBefore = (await ledger(ownerId)).length;

    const refused = await startCoworkGen({
      idempotencyKey: `cowork:${card.id}`,
      projectId,
      threadId,
      prompt: IMAGE_PROMPT,
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
    });
    expect(refused).toEqual({ error: "That was already generated from the canvas — start a new action instead." });
    expect(await prisma.genJob.count({ where: { ownerId, projectId } })).toBe(jobsBefore);
    expect((await ledger(ownerId)).length).toBe(ledgerBefore);
  });

  it("CREATE-A1: 画布上没有活着的对话时不凭空造一条——零消息、生成照常", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const sourceGenerationId = await seedGeneration(ownerId, projectId);

    const job = idOf(await startCanvasGen({
      actionId: `canvas-action-${randomUUID()}`,
      expectedCredits: IMAGE_QUOTE,
      projectId,
      prompt: IMAGE_PROMPT,
      entityIds: [],
      count: 1,
      kind: "image" as const,
      model: "seedream" as const,
      sourceGenerationId,
    }));
    expect(job.disposition).toBe("fresh");
    expect(await prisma.chatMessage.count({ where: { ownerId } })).toBe(0);
  });
});
