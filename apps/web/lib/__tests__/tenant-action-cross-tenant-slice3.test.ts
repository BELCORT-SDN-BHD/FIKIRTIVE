/**
 * 租户围栏切片③（CRM 面）—— TENANT-A2 行为测试:真实数据库、真实守卫、真实动作函数。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）；票 #1378。
 *
 * TENANT-A2：用 A 商家的会话，把请求体里的 id 换成 B 商家的资源，做改名、删除、读取各一次 ——
 * 三次全部失败；B 的数据与行数一字未改；A 自己的同一动作正常成功。三个动作横跨这一片改动的
 * 三个文件（同切片②「每片自己的三个动作横跨自己那批文件」同一口径）：
 *   改名 —— `updateContact`（crm-actions.ts）
 *   删除 —— `deleteSegment`（segment-actions.ts）
 *   读取 —— `getContact`（crm-view-data.ts）
 *
 * 手法：不 mock `@fikirtive/db` —— 真实 Prisma 走真实 tenant-guard
 * （`packages/db/src/tenant-guard.ts`）。只 mock `@/lib/auth-guard` 的 `requireOwner`
 * （按测试切换 A/B 会话）与 `resolveUserPrincipal`（#464 B1 既有的共享 stub），因为这两处只
 * 负责「从会话拿身份」，不是这份规格要钉住的那一半；另 mock `isImpersonating`（false，两个
 * 动作里各有一处拒 impersonation 的检查，本测试不关心那条）与 `next/cache` 的
 * `revalidatePath`（离开 Next 请求作用域直接调用会抛错）。
 *
 * 额外用 `vi.spyOn` 包一层已建帧的真实 Prisma 方法，顺手证明 TENANT-A1：敏感操作那一刻
 * `getPrincipal()` 真的返回一个 `kind:"user"`、`ownerId` 与当次会话相符的完整帧。
 *
 * 最后一条不靠动作自己的显式 `where:{ownerId}` 过滤（那个放到 main 上、完全不经过
 * tenant-guard 也会绿，证不到守卫本身在拦）：用 `vi.spyOn` 篡改真实（已建帧）的
 * `Contact.findFirst` 的 `where.ownerId`，指向 B，断言运行时守卫本身直接抛出
 * tenant-guard 签名错误 —— 与 `tenant-action-cross-tenant-slice2.test.ts` P2-1 那条同一写法。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newId } from "@fikirtive/core";
import type { Prisma } from "@fikirtive/db";

const { mockRequireOwner } = vi.hoisted(() => ({ mockRequireOwner: vi.fn() }));

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { runAsSystem, runAsTenant, getPrincipal } = await import("@fikirtive/db/principal");
const { updateContact } = await import("@/lib/crm-actions");
const { getContact } = await import("@/lib/crm-view-data");
const { deleteSegment } = await import("@/lib/segment-actions");

const ORG_A = "org_tenant_slice3_a";
const ORG_B = "org_tenant_slice3_b";
const GATE_A = { email: "aisha@fikirtive.test", ownerId: ORG_A } as const;
const GATE_B = { email: "bakar@fikirtive.test", ownerId: ORG_B } as const;

let contactA: string;
let contactB: string;
let segmentA: string;
let segmentB: string;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

function seedRulesJson(): Prisma.InputJsonValue {
  return { match: "all", rules: [] } as unknown as Prisma.InputJsonValue;
}

beforeEach(async () => {
  contactA = id("contact_a");
  contactB = id("contact_b");
  // Segment ids must be ULIDs — `buildSegment`/`deleteSegment` validate against `ULID_PATTERN`
  // before touching the database (`segment-actions.ts`), so a `prefix_random` id (fine for
  // Contact, which has no such check) would fail input validation before the tenant fence is
  // even reached.
  segmentA = newId();
  segmentB = newId();

  // Organization 不是 owner-scoped 模型,守卫不看它,系统帧原样能写。Contact / Segment 都在
  // TENANT_MODELS(ownerId 族),而那一族**恒为 enforce**(不受 warn/enforce 挡位影响,
  // 见 tenant-guard.ts:544)——一个不带租户的系统帧写它们会被拒(「requires runAsTenant before
  // system writes」),所以两家各自的种子行要分两次、各自在 `runAsTenant` 里落地。
  await runAsSystem("test-seed", () =>
    prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }], skipDuplicates: true }),
  );
  const now = new Date();
  await runAsTenant(ORG_A, () =>
    Promise.all([
      prisma.contact.create({
        data: { id: contactA, ownerId: ORG_A, name: "A's customer", source: "manual", firstTouchAt: now, lastSeenAt: now },
      }),
      prisma.segment.create({
        data: { id: segmentA, ownerId: ORG_A, name: `A's segment ${segmentA}`, phrase: "All of: tag is x", rulesJson: seedRulesJson(), kind: "custom" },
      }),
    ]),
  );
  await runAsTenant(ORG_B, () =>
    Promise.all([
      prisma.contact.create({
        data: { id: contactB, ownerId: ORG_B, name: "B's customer", source: "manual", firstTouchAt: now, lastSeenAt: now },
      }),
      prisma.segment.create({
        data: { id: segmentB, ownerId: ORG_B, name: `B's segment ${segmentB}`, phrase: "All of: tag is y", rulesJson: seedRulesJson(), kind: "custom" },
      }),
    ]),
  );

  mockRequireOwner.mockResolvedValue({ ...GATE_A });
});

afterAll(async () => {
  await runAsTenant(ORG_A, () =>
    Promise.all([
      prisma.segment.deleteMany({ where: { ownerId: ORG_A } }),
      prisma.contact.deleteMany({ where: { ownerId: ORG_A } }),
    ]),
  );
  await runAsTenant(ORG_B, () =>
    Promise.all([
      prisma.segment.deleteMany({ where: { ownerId: ORG_B } }),
      prisma.contact.deleteMany({ where: { ownerId: ORG_B } }),
    ]),
  );
  // updateContact / deleteSegment each write an audit ActionEvent row (append-only, EXEMPT —
  // platform-wide by design, tenant-guard.ts:204) that the org FK still points at, so it has to
  // go before the organizations can.
  await runAsSystem("test-seed", () =>
    prisma.actionEvent.deleteMany({ where: { ownerId: { in: [ORG_A, ORG_B] } } }),
  );
  await runAsSystem("test-seed", () =>
    prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } }),
  );
});

// TENANT-A5（规格 §2）：CRM 面完整商家旅程（建客户→跟进）—— 这一句与钱面切片①、动作面切片②
// 同一口径(`packages/db/src/tenant-guard-money-slice1.test.ts:186`)，由 S5 现场走查判定，不占位
// 假装。
it.todo("TENANT-A5 CRM 面完整旅程（建客户→跟进）由 S5 现场走查判定");

describe("TENANT-A2 CRM 面 —— A 的会话把 id 换成 B 的资源，改名/删除/读取各一次", () => {
  it("TENANT-A2 改名：updateContact 用 A 的帧改 B 的客户三次尝试失败，B 的名字一字未改；A 改自己的客户正常成功", async () => {
    const forged = await updateContact({ contactId: contactB, patch: { name: "hijacked-by-a" } });
    expect(forged).toEqual({ error: "Contact not found." });

    const bRow = await runAsSystem("test-seed", () =>
      prisma.contact.findFirst({ where: { id: contactB, ownerId: ORG_B }, select: { name: true } }),
    );
    expect(bRow?.name).toBe("B's customer");

    const own = await updateContact({ contactId: contactA, patch: { name: "A's renamed customer" } });
    expect(own).toEqual({ ok: true });
    const aRow = await runAsSystem("test-seed", () =>
      prisma.contact.findFirst({ where: { id: contactA, ownerId: ORG_A }, select: { name: true } }),
    );
    expect(aRow?.name).toBe("A's renamed customer");
  });

  it("TENANT-A2 删除：deleteSegment 用 A 的帧删 B 的分群三次尝试失败，B 的行没有被软删；A 删自己的分群正常成功", async () => {
    const forged = await deleteSegment({ segmentId: segmentB });
    expect(forged).toEqual({ error: "Segment not found." });

    const bRow = await runAsSystem("test-seed", () =>
      prisma.segment.findFirst({ where: { id: segmentB, ownerId: ORG_B }, select: { deletedAt: true } }),
    );
    expect(bRow?.deletedAt).toBeNull();

    const own = await deleteSegment({ segmentId: segmentA });
    expect(own).toEqual({ ok: true, idempotent: false });
    const aRow = await runAsSystem("test-seed", () =>
      prisma.segment.findFirst({ where: { id: segmentA, ownerId: ORG_A }, select: { deletedAt: true } }),
    );
    expect(aRow?.deletedAt).not.toBeNull();
  });

  it("TENANT-A2 读取：getContact 用 A 的帧读 B 的客户失败；A 读自己的客户正常成功", async () => {
    const forged = await getContact(contactB);
    expect(forged).toEqual({ error: "Contact not found." });

    const own = await getContact(contactA);
    expect("contact" in own && own.contact.id).toBe(contactA);
  });

  it('TENANT-A1 补充证明：getContact 的敏感操作那一刻，真实动作函数自己建的帧是完整的 kind:"user" 帧，两个商家先后打进来互不串帧', async () => {
    // 不是伪造帧——`vi.spyOn` 包一层真实(已建帧)的 Prisma 方法,在它执行的那一刻读
    // getPrincipal(),看到的就是 `getContactInFrame` 自己通过 `runAsUser` 建的那顶帧;
    // 真正的查询原样转发给保存下来的原始实现,行为不变。
    const original = prisma.contact.findFirst.bind(prisma.contact) as (...args: unknown[]) => unknown;
    const seen: Array<{ kind: string | undefined; ownerId: string | null }> = [];
    // Manual reassignment, NOT `spy.mockRestore()` — same measured reason as
    // tenant-action-cross-tenant-slice2.test.ts: `mockRestore()` leaves this Prisma delegate's
    // method `undefined` afterwards instead of bringing back the real implementation.
    vi.spyOn(prisma.contact, "findFirst").mockImplementation(((...args: unknown[]) => {
      const principal = getPrincipal();
      seen.push({ kind: principal?.kind, ownerId: (principal as { ownerId?: string } | undefined)?.ownerId ?? null });
      return original(...args);
    }) as never);

    try {
      mockRequireOwner.mockResolvedValueOnce({ ...GATE_A });
      await getContact(contactA);
      mockRequireOwner.mockResolvedValueOnce({ ...GATE_B });
      await getContact(contactB);
    } finally {
      prisma.contact.findFirst = original as never;
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ kind: "user", ownerId: ORG_A });
    expect(seen[1]).toEqual({ kind: "user", ownerId: ORG_B });
  });

  // 真正证闸的用例(照 tenant-action-cross-tenant-slice2.test.ts P2-1 同一写法)：上面三条
  // TENANT-A2 用例拿到的 "Contact not found." / "Segment not found." 全部来自动作本来就有的
  // 显式 `where:{ownerId}` —— 放到 main 上、完全不经过 tenant-guard 也会绿,证不到守卫本身在
  // 拦。这一条不靠动作自己的显式过滤:用 `vi.spyOn` 拦下真实(已建帧)的 `Contact.findFirst`,
  // 在真正的查询之前把它的 `where.ownerId` 篡改成 B 的 orgId,再转发给原始实现——模拟「动作层的
  // 显式过滤万一漏了一处」。Contact 在 TENANT_MODELS(`ownerId` 族,tenant-guard.ts:39),这一族
  // 恒为 enforce(不受钱表族 warn/enforce 挡位影响,tenant-guard.ts:542-543),所以命中应该直接
  // 抛错,而不是像钱表族那样只 console.warn。
  it("TENANT-A2 补充证明：篡改查询的 where.ownerId 指向 B，运行时守卫本身直接拒绝（不是动作层显式过滤在顶）", async () => {
    const original = prisma.contact.findFirst.bind(prisma.contact) as (...args: unknown[]) => unknown;
    vi.spyOn(prisma.contact, "findFirst").mockImplementation(((...args: unknown[]) => {
      const [queryArgs] = args as [{ where?: Record<string, unknown> }];
      if (queryArgs?.where && "ownerId" in queryArgs.where) {
        queryArgs.where = { ...queryArgs.where, ownerId: ORG_B };
      }
      return original(...args);
    }) as never);

    try {
      await expect(getContact(contactA)).rejects.toThrow(
        "[tenant-guard] Contact.findFirst tried to use ownerId outside the active tenant",
      );
    } finally {
      prisma.contact.findFirst = original as never;
    }
  });
});
