/**
 * 租户围栏切片①（钱面）—— 建帧这一半的验收。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）；票 #1376。
 *
 * 规格 §1.2 点名钱面的无帧站点：`billing-actions.ts:37`、`:97`（两处全无帧）与 `gen-actions.ts`
 * 的四处 `requireOwner`（其中只有 `startGen` 有帧）。TENANT-A1 要的是：在这些动作的**第一次
 * 敏感操作**那一刻，`getPrincipal()` 返回一个完整的 `kind:"user"` 帧；两个商家的请求先后打进来，
 * 互不串帧。
 *
 * 手法与 `principal-frame-b1.test.ts` 同一条（全 mock，无数据库）：每个站点的第一个敏感依赖被
 * 换成一个探针，探针从**里面**读环境帧。生产代码里没有任何测试钩子。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal, UserPrincipal } from "@fikirtive/db/principal";
import { getPrincipal } from "@fikirtive/db/principal";

const probe = vi.hoisted(() => ({ seen: [] as Array<Principal | undefined> }));

function record<T>(value: T): T {
  probe.seen.push(getPrincipal());
  return value;
}

const h = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  pricesList: vi.fn(),
  pricesRetrieve: vi.fn(),
  genJobFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
  chatMessageFindFirst: vi.fn(),
}));

function principalFor(gate: { email: string; ownerId: string }): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_for_${gate.ownerId}`,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: "owner",
    membershipId: `mem_for_${gate.ownerId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

vi.mock("@/lib/auth-guard", () => ({
  requireOwner: h.requireOwner,
  resolveUserPrincipal: async (gate: { email: string; ownerId: string }) => principalFor(gate),
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: async () => false }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    prices: { list: h.pricesList, retrieve: h.pricesRetrieve },
    checkout: { sessions: { create: vi.fn() } },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  storageKeyToSrc: (key: string) => key,
  storageKey: (owner: string, hash: string, ext: string) => `${owner}/${hash}.${ext}`,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    genJob: { findFirst: h.genJobFindFirst, findMany: vi.fn(async () => []) },
    project: { findFirst: h.projectFindFirst },
    chatMessage: { findFirst: h.chatMessageFindFirst },
    generation: { findMany: vi.fn(async () => []) },
  },
  reserveCredits: vi.fn(),
  InsufficientCredits: class InsufficientCredits extends Error {},
  SpendCapBlocked: class SpendCapBlocked extends Error {},
}));

const { listCreditPacks, createTopupCheckout } = await import("@/lib/billing-actions");
const { getGenJob, getRecentGenResults, startCoworkGen } = await import("@/lib/gen-actions");

const GATE_A = { email: "aisha@fikirtive.test", ownerId: "org_money_a" } as const;
const GATE_B = { email: "bakar@fikirtive.test", ownerId: "org_money_b" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  probe.seen.length = 0;
  h.requireOwner.mockResolvedValue({ ...GATE_A });
  h.pricesList.mockImplementation(async () => record({ data: [] }));
  h.pricesRetrieve.mockImplementation(async () => record({ active: false, metadata: {} }));
  h.genJobFindFirst.mockImplementation(async () => record(null));
  h.projectFindFirst.mockImplementation(async () => record(null));
  h.chatMessageFindFirst.mockImplementation(async () => record(null));
  process.env.STRIPE_SECRET_KEY = "sk_test_slice1";
});

/** 验收判定：一个点名了本次请求自己的店与人的 USER 帧。 */
function expectUserFrame(seen: Principal | undefined, ownerId: string, email: string) {
  expect(seen, "敏感操作那一刻没有环境帧").toBeDefined();
  // 刻意查 kind 而不是只比对形状：`runAsTenant` 那种替身也带 ownerId，但它丢了「谁在动」。
  expect(seen!.kind).toBe("user");
  expect(seen).toMatchObject({
    kind: "user",
    ownerId,
    subjectEmail: email,
    subjectUserId: `usr_for_${ownerId}`,
    orgRole: "owner",
    membershipId: `mem_for_${ownerId}`,
  });
}

describe("TENANT-A1 钱面每一个入口都在 user 帧里发生（规格 §1.2 点名的站点）", () => {
  it("TENANT-A1 listCreditPacks（billing-actions:37）在帧里问货架", async () => {
    await listCreditPacks();
    expect(h.pricesList).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
  });

  it("TENANT-A1 createTopupCheckout（billing-actions:97，充值）在帧里取价", async () => {
    const result = await createTopupCheckout("price_x");
    expect(result).toEqual({ error: "That pack is unavailable." });
    expect(h.pricesRetrieve).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
  });

  it("TENANT-A1 startCoworkGen（gen-actions 付费入口）在帧里读那张卡", async () => {
    await startCoworkGen({
      projectId: "proj_1",
      prompt: "A poster for the Raya sale",
      count: 1,
      kind: "image",
      model: "seedream",
      threadId: "thr_1",
      idempotencyKey: "cowork:card_1",
    });
    expect(h.chatMessageFindFirst).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
  });

  it("TENANT-A1 getGenJob（扣费产物的读）在帧里发生", async () => {
    await getGenJob("job_1");
    expect(h.genJobFindFirst).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
  });

  it("TENANT-A1 getRecentGenResults（扣费产物的读）在帧里发生", async () => {
    await getRecentGenResults("proj_1");
    expect(h.projectFindFirst).toHaveBeenCalledTimes(1);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
  });

  it("TENANT-A1 两个商家先后打进来，B 的请求读不到 A 的身份（帧不串）", async () => {
    h.requireOwner.mockResolvedValueOnce({ ...GATE_A });
    await getGenJob("job_a");
    h.requireOwner.mockResolvedValueOnce({ ...GATE_B });
    await getGenJob("job_b");

    expect(probe.seen).toHaveLength(2);
    expectUserFrame(probe.seen[0], GATE_A.ownerId, GATE_A.email);
    expectUserFrame(probe.seen[1], GATE_B.ownerId, GATE_B.email);
  });

  it("TENANT-A1 守卫拒门的请求根本进不了帧（建帧不放宽任何权限）", async () => {
    h.requireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listCreditPacks()).toEqual({ unreadable: true });
    await expect(getGenJob("job_1")).rejects.toThrow("Not authorized.");
    expect(probe.seen).toHaveLength(0);
  });
});
