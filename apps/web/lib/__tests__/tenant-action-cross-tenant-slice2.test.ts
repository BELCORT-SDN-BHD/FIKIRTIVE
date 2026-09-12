/**
 * 租户围栏切片②（商家动作面）—— TENANT-A2 行为测试:真实数据库、真实守卫、真实动作函数。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）；票 #1377。
 *
 * TENANT-A2：用 A 商家的会话，把请求体里的 id 换成 B 商家的资源，做改名、删除、读取各一次 ——
 * 三次全部失败；B 的数据与行数一字未改；A 自己的同一动作正常成功。
 *
 * 手法：不 mock `@fikirtive/db` —— 真实 Prisma 走真实 tenant-guard
 * （`packages/db/src/tenant-guard.ts`）。只 mock `@/lib/auth-guard` 的 `requireOwner`
 * （按测试切换 A/B 会话）与 `resolveUserPrincipal`（#464 B1 既有的共享 stub），因为这两处只
 * 负责「从会话拿身份」，不是这份规格要钉住的那一半。
 *
 * 额外用 `vi.spyOn` 包一层已建帧的真实 Prisma 方法，顺手证明 TENANT-A1：敏感操作那一刻
 * `getPrincipal()` 真的返回一个 `kind:"user"`、`ownerId` 与当次会话相符的完整帧。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireOwner } = vi.hoisted(() => ({ mockRequireOwner: vi.fn() }));

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));

const { prisma } = await import("@fikirtive/db");
const { runAsSystem, runAsTenant, getPrincipal } = await import("@fikirtive/db/principal");
const { renameCollection, getCollection } = await import("@/lib/library-collections");
const { deleteCanvasNode } = await import("@/lib/canvas-actions");

const ORG_A = "org_tenant_slice2_a";
const ORG_B = "org_tenant_slice2_b";
const GATE_A = { email: "aisha@fikirtive.test", ownerId: ORG_A } as const;
const GATE_B = { email: "bakar@fikirtive.test", ownerId: ORG_B } as const;

let collectionA: string;
let collectionB: string;
let projectA: string;
let projectB: string;
let nodeA: string;
let nodeB: string;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

beforeEach(async () => {
  collectionA = id("col_a");
  collectionB = id("col_b");
  projectA = id("proj_a");
  projectB = id("proj_b");
  nodeA = id("node_a");
  nodeB = id("node_b");

  // Organization 不是 owner-scoped 模型,守卫不看它,系统帧原样能写。Collection / CanvasNode
  // 都在 TENANT_MODELS(ownerId 族)里,而那一族**恒为 enforce**(不受 warn/enforce 挡位影响,
  // 见 tenant-guard.ts:544)——一个不带租户的系统帧写它们会被拒(「requires runAsTenant before
  // system writes」),所以两家各自的种子行要分两次、各自在 `runAsTenant` 里落地。
  await runAsSystem("test-seed", () =>
    prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }], skipDuplicates: true }),
  );
  await runAsTenant(ORG_A, () =>
    Promise.all([
      prisma.collection.create({ data: { id: collectionA, ownerId: ORG_A, name: "A's moodboard" } }),
      prisma.canvasNode.create({
        data: { id: nodeA, ownerId: ORG_A, projectId: projectA, type: "text", x: 0, y: 0, w: 1, h: 1, text: "a" },
      }),
    ]),
  );
  await runAsTenant(ORG_B, () =>
    Promise.all([
      prisma.collection.create({ data: { id: collectionB, ownerId: ORG_B, name: "B's moodboard" } }),
      prisma.canvasNode.create({
        data: { id: nodeB, ownerId: ORG_B, projectId: projectB, type: "text", x: 0, y: 0, w: 1, h: 1, text: "b" },
      }),
    ]),
  );

  mockRequireOwner.mockResolvedValue({ ...GATE_A });
});

afterAll(async () => {
  await runAsTenant(ORG_A, () =>
    Promise.all([
      prisma.canvasNode.deleteMany({ where: { ownerId: ORG_A } }),
      prisma.collectionItem.deleteMany({ where: { ownerId: ORG_A } }),
      prisma.collection.deleteMany({ where: { ownerId: ORG_A } }),
    ]),
  );
  await runAsTenant(ORG_B, () =>
    Promise.all([
      prisma.canvasNode.deleteMany({ where: { ownerId: ORG_B } }),
      prisma.collectionItem.deleteMany({ where: { ownerId: ORG_B } }),
      prisma.collection.deleteMany({ where: { ownerId: ORG_B } }),
    ]),
  );
  await runAsSystem("test-seed", () =>
    prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } }),
  );
});

// TENANT-A5（规格 §2）：动作面完整商家旅程（建项目→生成→排期）—— 这一句与钱面切片①同一口径
// (`packages/db/src/tenant-guard-money-slice1.test.ts:186`)，由 S5 现场走查判定，不占位假装。
it.todo("TENANT-A5 商家动作面完整旅程（建项目→生成→排期）由 S5 现场走查判定");

describe("TENANT-A2 商家动作面 —— A 的会话把 id 换成 B 的资源，改名/删除/读取各一次", () => {
  it("TENANT-A2 改名：renameCollection 用 A 的帧改 B 的合集三次尝试失败，B 的名字一字未改；A 改自己的合集正常成功", async () => {
    const forged = await renameCollection(collectionB, "hijacked-by-a");
    expect(forged).toEqual({ error: "Not found." });

    const bRow = await runAsSystem("test-seed", () =>
      prisma.collection.findFirst({ where: { id: collectionB, ownerId: ORG_B }, select: { name: true } }),
    );
    expect(bRow?.name).toBe("B's moodboard");

    const own = await renameCollection(collectionA, "A's renamed board");
    expect(own).toEqual({ name: "A's renamed board" });
    const aRow = await runAsSystem("test-seed", () =>
      prisma.collection.findFirst({ where: { id: collectionA, ownerId: ORG_A }, select: { name: true } }),
    );
    expect(aRow?.name).toBe("A's renamed board");
  });

  it("TENANT-A2 读取：getCollection 用 A 的帧读 B 的合集失败；A 读自己的合集正常成功", async () => {
    const forged = await getCollection(collectionB);
    expect(forged).toEqual({ error: "Not found." });

    const own = await getCollection(collectionA);
    expect("collection" in own && own.collection.id).toBe(collectionA);
  });

  it("TENANT-A2 删除：deleteCanvasNode 用 A 的帧删 B 的画布卡失败，B 的行没有被软删；A 删自己的卡正常成功", async () => {
    const forged = await deleteCanvasNode(projectB, nodeB);
    expect(forged).toEqual({ error: "Node not found." });

    const bNode = await runAsSystem("test-seed", () =>
      prisma.canvasNode.findFirst({ where: { id: nodeB }, select: { status: true } }),
    );
    expect(bNode?.status).not.toBe("deleted");

    const own = await deleteCanvasNode(projectA, nodeA);
    expect(own).toEqual({ ok: true });
    const aNode = await runAsSystem("test-seed", () =>
      prisma.canvasNode.findFirst({ where: { id: nodeA }, select: { status: true } }),
    );
    expect(aNode?.status).toBe("deleted");
  });

  it('TENANT-A1 补充证明：getCollection 的敏感操作那一刻，真实动作函数自己建的帧是完整的 kind:"user" 帧，两个商家先后打进来互不串帧', async () => {
    // 不是伪造帧——`vi.spyOn` 包一层真实（已建帧）的 Prisma 方法，在它执行的那一刻读
    // getPrincipal()，看到的就是 `getCollectionInFrame` 自己通过 `runAsUser` 建的那顶帧；
    // 真正的查询原样转发给保存下来的原始实现，行为不变。
    // Prisma 的 `findFirst` 返回的是可再链式 `.include` 的 `Prisma__CollectionClient`,不是一个
    // 普通 Promise——mockImplementation 严格按那个类型对不上,这里用 `as never` 松绑,只为了在
    // 真正的查询之前插一句 getPrincipal() 探针,查询本身原样转发给保存下来的原始实现。
    const original = prisma.collection.findFirst.bind(prisma.collection) as (...args: unknown[]) => unknown;
    const seen: Array<{ kind: string | undefined; ownerId: string | null }> = [];
    const spy = vi.spyOn(prisma.collection, "findFirst").mockImplementation(((...args: unknown[]) => {
      const principal = getPrincipal();
      seen.push({ kind: principal?.kind, ownerId: (principal as { ownerId?: string } | undefined)?.ownerId ?? null });
      return original(...args);
    }) as never);

    try {
      mockRequireOwner.mockResolvedValueOnce({ ...GATE_A });
      await getCollection(collectionA);
      mockRequireOwner.mockResolvedValueOnce({ ...GATE_B });
      await getCollection(collectionB);
    } finally {
      spy.mockRestore();
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ kind: "user", ownerId: ORG_A });
    expect(seen[1]).toEqual({ kind: "user", ownerId: ORG_B });
  });
});
