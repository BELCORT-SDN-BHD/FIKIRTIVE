/**
 * FSE-207 —— 跨租户画布深链:诚实拒绝页 ＋ **零写入**,用真 Postgres 钉。
 *
 * 规格 `docs/specs/creation-engine.md` §5(2026-09-11 登记行)。Founder 2026-09-12 在 #1358
 * 场内裁定 :172④ 那句「零写入」是**硬口径**,本条随之由 P2 升 P1。复测句逐字:「跨租户打
 * 深链,地址不得被改写、不得新建 project、必须有一句人话」。
 *
 * 为什么必须是真库:走查那一轮(`docs/audits/fullstack-staging-2026-09-11/run-ledger.md`
 * §R2-19、`backend-evidence.md` §5.2)报的不是「查询语句写错了」,报的是**库里多了一行**
 * —— 一行 `Project`(`name='New canvas'`)和一行 `ActionEvent type='project.create'`,归属
 * 正确、没有泄漏、但没人要。把 prisma 整个替身掉的测试证不了「没多一行」,只证得了「我
 * 没调那个函数」。所以这一份数真行:打完那条跨租户深链,整库的 `Project` 与 `ActionEvent`
 * 行数一格不动。
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

/**
 * 「零写入」数的就是这两张表 —— 走查里多出来的正是它们各一行(`Project name='New canvas'`
 * ＋ `ActionEvent type='project.create'`)。
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

beforeAll(async () => {
  tenantA = await seedTenant();
  tenantB = await seedTenant();
  canvasOfA = await seedCanvas(tenantA.ownerId, "Raya campaign");
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  });
});

describe("FSE-207 跨租户画布深链", () => {
  it("FSE-207 — opening another workspace's canvas link writes nothing to the database", async () => {
    // 访问者自己先有一张画布,好把「有没有新建」与「有没有 bootstrap」分开:多出来的任何
    // 一行都只可能是这条深链造的。
    await seedCanvas(tenantB.ownerId, "Own canvas");
    signIn(tenantB);
    const before = await writeCounts();

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: canvasOfA }),
    });

    expect(element.type).toBe(CanvasDeepLinkRefused);
    expect(await writeCounts()).toEqual(before);
  });

  it("FSE-207 — the refusal does not rewrite the address", async () => {
    signIn(tenantB);

    await ImmersiveCanvasEntry({ searchParams: Promise.resolve({ project: canvasOfA }) });

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("FSE-207 — the other workspace's canvas is not touched by the visit", async () => {
    const before = await prisma.project.findFirstOrThrow({
      where: { id: canvasOfA, ownerId: tenantA.ownerId },
      select: { ownerId: true, name: true, updatedAt: true },
    });
    signIn(tenantB);

    await ImmersiveCanvasEntry({ searchParams: Promise.resolve({ project: canvasOfA }) });

    const after = await prisma.project.findFirstOrThrow({
      where: { id: canvasOfA, ownerId: tenantA.ownerId },
      select: { ownerId: true, name: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });

  it("FSE-207 — a merchant's own canvas deep link still opens that canvas, and still writes nothing", async () => {
    const ownCanvas = await seedCanvas(tenantB.ownerId, "Merdeka gift box");
    signIn(tenantB);
    const before = await writeCounts();

    const element = await ImmersiveCanvasEntry({
      searchParams: Promise.resolve({ project: ownCanvas }),
    });

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(element.type).not.toBe(CanvasDeepLinkRefused);
    expect(element.props.runtimeContext.activeProjectId).toBe(ownCanvas);
    expect(await writeCounts()).toEqual(before);
  });

  it("FSE-207 — a first-time merchant with no canvas and no deep link is still bootstrapped exactly one canvas", async () => {
    // 拒绝闸把画布清单的读挪到了 bootstrap 前面,这一条钉住它没把第一次进画布的租户弄丢。
    const fresh = await seedTenant();
    signIn(fresh);

    const element = await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) });

    const owned = await prisma.project.findMany({ where: { ownerId: fresh.ownerId } });
    expect(owned).toHaveLength(1);
    expect(element.props.runtimeContext.activeProjectId).toBe(owned[0]!.id);
    // 侧栏清单也要有它 —— 只作 activeProjectId 的话商家看到的是一张不在清单里的画布。
    expect(element.props.runtimeContext.projects).toEqual([
      { id: owned[0]!.id, name: owned[0]!.name },
    ]);
  });
});
