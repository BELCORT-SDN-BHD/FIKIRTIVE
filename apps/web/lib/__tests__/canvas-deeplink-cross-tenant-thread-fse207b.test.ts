/**
 * FSE-207b —— 跨租户 thread 深链:诚实拒绝页 ＋ **零写入**,用真 Postgres 钉。
 *
 * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 FSE-207 登记行,「未做」①)。PR #1396
 * 只把 `?project=` 这一支收成诚实拒绝页 ＋ 零写入(Founder 2026-09-12 #1358 裁「跨租户深链
 * 零写入」为**硬口径**),登记里明写「`?thread=` 解析不了时仍按旧口径规范化重定向(改写
 * 地址、零写入),本票口径只裁画布深链」—— 这一票把 `thread` 深链收成**同一口径**:复用
 * 同一个判定(`isUnresolvedDeepLinkId`)与同一张拒绝页(`CanvasDeepLinkRefused`),不再造
 * 第二份。跨租户 `?thread=` → 原地址诚实拒绝页、零写入(含不触发 bootstrap);本租户合法
 * `?thread=` 照常打开。
 *
 * 为什么必须是真库(与 FSE-207 同理):走查那类问题报的不是「查询语句写错了」,是**库里
 * 多一行**;把 prisma 整个替身掉的测试只证得了「我没调那个函数」,证不了「哪儿都没多一
 * 行」。所以这一份数真行:打完一条跨租户 thread 深链,整库的 `Project` 与 `ActionEvent`
 * 行数一格不动 —— 这两张表正是 `getOrCreateDefaultProject()` 兜底会写的那两张
 * (`project.create` 审计行同源,`docs/audits/fullstack-staging-2026-09-11/run-ledger.md`
 * §R2-19、`backend-evidence.md` §5.2)。
 *
 * 「空租户会被 bootstrap 画布」是本票要修的具体症状:一个还没有任何画布的租户打一条
 * 别家的 `?thread=`,旧口径会在把地址改写成兜底画布之前先经过
 * `getOrCreateDefaultProject()`,凭空多出一张画布 —— 写入的因头是「这次访问」不是「这条
 * 链接」,字面不违反「零写入」,但商家没要这张画布,屏幕上也没有一句话说明白发生了什么,
 * 违的是硬口径要守住的精神。最后一条测试专门钉这一支。
 *
 * 零钱路:全程不预扣、不结算、不退款,一个积分都花不出去。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockRequireOwner = vi.fn();
const mockRedirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});

vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: vi.fn() }));
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("../storage", () => ({
  storage: { put: vi.fn(), get: vi.fn(), del: vi.fn(), url: () => "" },
  extFromFilename: () => "png",
  mimeOf: () => "image/png",
  kindOf: () => "image",
}));
vi.mock("../queue", () => ({ getBoss: vi.fn() }));
// 画布外壳是客户端组件(react-flow 一整棵树),这一份只关心 Entry 交出来的是哪一棵树。
vi.mock("@/components/canvas/NorthstarCanvasWorkspace", () => ({
  NorthstarCanvasWorkspace: function NorthstarCanvasWorkspace() {
    return null;
  },
}));

const { ImmersiveCanvasEntry } = await import("@/components/canvas/ImmersiveCanvasEntry");
const { CanvasDeepLinkRefused } = await import("@/components/canvas/CanvasDeepLinkRefused");
const { prisma } = await import("@fikirtive/db");

type Tenant = { ownerId: string; email: string };

/** 一个租户 ＝ 一行 organization ＋ 一行 creditAccount(余额读路要得到它)。 */
async function seedTenant(): Promise<Tenant> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: 0, reserved: 0 } });
  return { ownerId, email: `${ownerId}@example.test` };
}

async function seedCanvas(ownerId: string, name: string): Promise<string> {
  const id = `canvas_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name } });
  return id;
}

async function seedThread(ownerId: string, projectId: string, title: string): Promise<string> {
  const id = `thread_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id, ownerId, projectId, title } });
  return id;
}

/**
 * 「零写入」数的就是这两张表 —— 走查里多出来的正是它们各一行(`Project name='New canvas'`
 * ＋ `ActionEvent type='project.create'`),thread 深链走同一条 bootstrap 路径,写的还是
 * 这两张表(照 #1396 `canvas-deeplink-cross-tenant-fse207.test.ts` 的写法)。
 *
 * 走 `$queryRaw` 而不是 `prisma.project.count()`:租户守卫不许无 ownerId 条件的 model 查询
 * (那道守卫本身是对的),而这里要问的偏偏是**整库**有没有多一行 —— 按 ownerId 数就只能证明
 * 「我以为它会写到哪里」没多行,证不了「哪儿都没多」。
 */
async function writeCounts(): Promise<{ projects: bigint; actionEvents: bigint }> {
  const [[projects], [actionEvents]] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "Project"`,
    prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "ActionEvent"`,
  ]);
  return { projects: projects!.count, actionEvents: actionEvents!.count };
}

function signIn(tenant: Tenant): void {
  mockRequireOwner.mockResolvedValue({ email: tenant.email, ownerId: tenant.ownerId });
}

let tenantA: Tenant;
let tenantB: Tenant;
let canvasOfA: string;
let threadOfA: string;

beforeAll(async () => {
  tenantA = await seedTenant();
  tenantB = await seedTenant();
  canvasOfA = await seedCanvas(tenantA.ownerId, "Raya campaign");
  threadOfA = await seedThread(tenantA.ownerId, canvasOfA, "Deepavali hero shots");
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  });
});

describe("FSE-207b 跨租户 thread 深链", () => {
  it("FSE-207b — 跨租户 thread 深链全库行数零变化(Project ＋ ActionEvent)", async () => {
    // 访问者自己先有一张画布与一条对话,好把「有没有新建」与「有没有 bootstrap」分开:多
    // 出来的任何一行都只可能是这条深链造的。
    const ownCanvas = await seedCanvas(tenantB.ownerId, "Own canvas");
    await seedThread(tenantB.ownerId, ownCanvas, "Own conversation");
    signIn(tenantB);
    const before = await writeCounts();

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ thread: threadOfA }),
    });

    expect(element.type).toBe(CanvasDeepLinkRefused);
    expect(await writeCounts()).toEqual(before);
  });

  it("FSE-207b — the refusal does not rewrite the address", async () => {
    signIn(tenantB);

    await ImmersiveCanvasEntry({ searchParams: Promise.resolve({ thread: threadOfA }) });

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("FSE-207b — the other workspace's thread is not touched by the visit", async () => {
    const before = await prisma.chatThread.findFirstOrThrow({
      where: { id: threadOfA, ownerId: tenantA.ownerId },
      select: { ownerId: true, title: true, updatedAt: true },
    });
    signIn(tenantB);

    await ImmersiveCanvasEntry({ searchParams: Promise.resolve({ thread: threadOfA }) });

    const after = await prisma.chatThread.findFirstOrThrow({
      where: { id: threadOfA, ownerId: tenantA.ownerId },
      select: { ownerId: true, title: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });

  it("FSE-207b — a merchant's own thread deep link still opens that thread, and still writes nothing", async () => {
    const ownCanvas = await seedCanvas(tenantB.ownerId, "Merdeka gift box");
    const ownThread = await seedThread(tenantB.ownerId, ownCanvas, "Gift box planning");
    signIn(tenantB);
    const before = await writeCounts();

    const element = await ImmersiveCanvasEntry({
      // 带上 project,把它钉在自己那张画布的范围里 —— 这条测试要证的是 thread 本身的
      // 归属判定,不是「没带 project 时选中哪一张画布」那道另外的题(未受本票影响)。
      searchParams: Promise.resolve({ project: ownCanvas, thread: ownThread }),
    });

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(element.type).not.toBe(CanvasDeepLinkRefused);
    expect(element.props.runtimeContext.activeThreadId).toBe(ownThread);
    expect(await writeCounts()).toEqual(before);
  });

  it("FSE-207b — a workspace with no canvas yet is not bootstrapped by a cross-tenant thread link", async () => {
    // 本票要修的具体症状:零画布租户打一条别家的 thread 深链,旧口径会在改写地址之前先
    // 经过 getOrCreateDefaultProject() 建一张兜底画布——现在必须连一张都不建。
    const fresh = await seedTenant();
    signIn(fresh);
    const before = await writeCounts();

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ thread: threadOfA }),
    });

    expect(element.type).toBe(CanvasDeepLinkRefused);
    expect(await writeCounts()).toEqual(before);
    const owned = await prisma.project.findMany({ where: { ownerId: fresh.ownerId } });
    expect(owned).toHaveLength(0);
  });
});
