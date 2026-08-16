/**
 * #925 —— MONEY INVARIANT, proven on real Postgres (*_test), real Prisma, real credit ledger.
 *
 * 「父卡不指着的子卡不许开销」。形状:一张 $0、已 prepare 但从未 confirm 的分镜子卡,其父卡
 * (STORYBOARD_CARD)的指针被任何路径换掉之后,一条陈旧标签页仍然摸得到这张子卡的 id —— 因为
 * `coworkGenerate`→`startGen` 原来只认子卡自己的结构,从不回头核对父卡此刻还指不指着它。
 *
 * 覆盖三条已知替换路径里的两条(第三条 prepare-mismatch 复用与 regen 完全相同的
 * `firstFrameChildMatches` 比对与 mint-and-swap 形状,不再重复举证):
 *   1. 编辑放行格(#888):子卡还没起任何作业,`inFlightPointerBlock` 只挡「在途」,挡不住
 *      「压根没起过」—— editShotPrompt 把指针键整个删掉,父卡不再指向它。
 *   2. regen 铸替换卡:单镜重出撞见 prompt/形状 mismatch,铸一张新子卡并把指针换成新 id,
 *      旧子卡原样留在库里,父卡不再指向它。
 *
 * 零回归:当前指针的子卡正常 confirm 并扣费;对同一张已经合法扣过费的子卡重放 confirm(标签页
 * 重放/重新点击)仍然幂等地拿回同一个 GenJob,不是第二次收费;非分镜的普通 cowork 卡(payload
 * 没有 storyboardCardId)完全不受这条闸影响;跨租户的伪造 storyboardCardId 同样 fail closed。
 *
 * Only the web plumbing around startGen is mocked (auth guard, impersonation, queue, guardian,
 * model registry, next/cache) — the SAME mock set gen-ledger.test.ts uses. Zero provider calls,
 * zero real spend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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

const { coworkGenerate } = await import("../cowork-actions");
const { prepareStoryboardFirstFrames, regenShotFirstFrameCard } = await import("../storyboard-gate1-actions");
const { editShotPrompt } = await import("../storyboard-actions");
const { prisma, Prisma } = await import("@fikirtive/db");

// ── real-DB helpers (gen-ledger.test.ts pattern) ─────────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Storyboard parent pointer test" } });
  return id;
}
async function seedThread(ownerId: string, projectId: string): Promise<string> {
  const id = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id, ownerId, projectId, title: "Otto" } });
  return id;
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
}
/** Unwrap a StartGenResult-shaped action result, or fail the test with its error. */
function idOf(res: { id: string } | { error: string }): { id: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

/** One STORYBOARD_CARD, one shot, no children minted yet — the shape `buildStoryboardPayload`
 *  produces for a fresh Otto proposal (propose-storyboard.helpers.ts), hand-built here since the
 *  builder isn't exported from the package's public surface. */
async function seedStoryboardCard(
  ownerId: string,
  threadId: string,
  shotId: string,
): Promise<string> {
  const id = `sb_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id, threadId, ownerId, role: "AGENT", kind: "STORYBOARD_CARD", seq: 1, text: "",
      payload: {
        storyboardTitle: "Product hero reel",
        shots: [
          { shotId, index: 0, firstFramePrompt: "sunrise over hills", videoPrompt: "camera pans across the hills" },
        ],
      } as unknown as Prisma.InputJsonObject,
    },
  });
  return id;
}

async function readStoryboardPayload(ownerId: string, cardId: string): Promise<{
  shots: { shotId: string; firstFrameCardId?: string; videoCardId?: string; firstFramePrompt: string }[];
}> {
  // tenant-guard (packages/db/src/tenant-guard.ts) refuses an id-only read outside an active
  // runAsUser frame — findFirst + ownerId, not findUniqueOrThrow by bare id.
  const row = await prisma.chatMessage.findFirstOrThrow({ where: { id: cardId, ownerId }, select: { payload: true } });
  return row.payload as unknown as {
    shots: { shotId: string; firstFrameCardId?: string; videoCardId?: string; firstFramePrompt: string }[];
  };
}

async function jobCountFor(ownerId: string, childCardId: string): Promise<number> {
  return prisma.genJob.count({ where: { ownerId, idempotencyKey: `cowork:${childCardId}` } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#925 — a stale tab confirming an orphaned storyboard child card must not spend", () => {
  it("edit-release path (#888): editing the shot before the child ever started a job deletes the pointer — the orphaned child cannot be confirmed, and nothing is charged", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const shotId = `shot_${randomUUID()}`;
    const storyboardCardId = await seedStoryboardCard(ownerId, threadId, shotId);

    // Gate①: mint the $0 first-frame child — never confirmed.
    const prep = await prepareStoryboardFirstFrames({ cardId: storyboardCardId });
    if ("error" in prep) throw new Error(prep.error);
    expect(prep.children).toHaveLength(1);
    const staleChildId = prep.children[0]!.childCardId;

    // The parent still points at it — this is the "current, valid" state a browser tab opened.
    const beforeEdit = await readStoryboardPayload(ownerId, storyboardCardId);
    expect(beforeEdit.shots[0]!.firstFrameCardId).toBe(staleChildId);

    // #888 edit-release gap: the shot's prompt changes while the child never started a job —
    // inFlightPointerBlock only blocks an IN-FLIGHT pointer, so the edit proceeds and the stale
    // child's pointer is deleted from the parent's payload entirely (not replaced — gone).
    const edited = await editShotPrompt({ cardId: storyboardCardId, index: 0, firstFramePrompt: "sunset over hills" });
    if ("error" in edited) throw new Error(edited.error);
    const afterEdit = await readStoryboardPayload(ownerId, storyboardCardId);
    expect(afterEdit.shots[0]!.firstFrameCardId).toBeUndefined(); // the parent no longer points anywhere

    // A stale browser tab still holds `staleChildId` and confirms it directly.
    const acctBefore = await account(ownerId);
    const res = await coworkGenerate({ cardId: staleChildId, prompt: "sunrise over hills", entityIds: [], variantSel: {} });

    // MONEY ASSERTION (the point of this test): a parent-orphaned child must be REFUSED, $0.
    expect("error" in res).toBe(true);
    expect(await jobCountFor(ownerId, staleChildId)).toBe(0); // no GenJob was ever created for it
    const acctAfter = await account(ownerId);
    expect(acctAfter.reserved).toBe(acctBefore.reserved); // zero reservation
    expect(acctAfter.balance).toBe(acctBefore.balance); // zero charge
  });

  it("regen-mint path: a single-shot regen that mints a replacement child orphans the old one — confirming the OLD id is refused, $0", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const shotId = `shot_${randomUUID()}`;
    const storyboardCardId = await seedStoryboardCard(ownerId, threadId, shotId);

    const prep = await prepareStoryboardFirstFrames({ cardId: storyboardCardId });
    if ("error" in prep) throw new Error(prep.error);
    const oldChildId = prep.children[0]!.childCardId;

    // Simulate the parent's frame prompt having drifted from what the existing child was frozen
    // with (the real precondition `regenShotFirstFrameCard`'s reuse-vs-mismatch comparison keys
    // on — `firstFrameChildMatches` in storyboard-gate1-actions.ts) WITHOUT going through
    // editShotPrompt (which would delete the pointer itself and collapse this into the first
    // test). This models the same underlying reality named in #925 as "prepare mismatch":
    // the parent's current prompt and the frozen child no longer agree.
    const cur = await readStoryboardPayload(ownerId, storyboardCardId);
    // updateMany (not update): a plain filter accepts an explicit ownerId outside any
    // runAsUser frame — `update`'s unique-where relies on the frame's auto tenant-scoping,
    // which this raw test helper doesn't run inside of.
    await prisma.chatMessage.updateMany({
      where: { id: storyboardCardId, ownerId },
      data: {
        payload: {
          storyboardTitle: "Product hero reel",
          shots: [{ ...cur.shots[0]!, firstFramePrompt: "golden hour over the hills" }],
        } as unknown as Prisma.InputJsonObject,
      },
    });

    // regenShotFirstFrameCard recomputes the would-be card from the CURRENT (drifted) prompt —
    // it no longer matches the existing child's frozen structuredPrompt, so it mints a fresh
    // replacement and swaps the pointer. The old child is now a real, DB-persisted orphan.
    const regen = await regenShotFirstFrameCard({ cardId: storyboardCardId, shotId });
    if ("error" in regen) throw new Error(regen.error);
    const newChildId = regen.child.childCardId;
    expect(newChildId).not.toBe(oldChildId);
    const afterRegen = await readStoryboardPayload(ownerId, storyboardCardId);
    expect(afterRegen.shots[0]!.firstFrameCardId).toBe(newChildId); // parent now points at the NEW child only

    // A stale tab still holds the OLD child id.
    const acctBefore = await account(ownerId);
    const res = await coworkGenerate({ cardId: oldChildId, prompt: "sunrise over hills", entityIds: [], variantSel: {} });

    expect("error" in res).toBe(true);
    expect(await jobCountFor(ownerId, oldChildId)).toBe(0);
    const acctAfter = await account(ownerId);
    expect(acctAfter.reserved).toBe(acctBefore.reserved);
    expect(acctAfter.balance).toBe(acctBefore.balance);
  });
});

describe("#925 — zero regression: the paths this fix must not touch", () => {
  it("confirming the CURRENT pointer child works exactly as before — one GenJob, one reservation", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const shotId = `shot_${randomUUID()}`;
    const storyboardCardId = await seedStoryboardCard(ownerId, threadId, shotId);

    const prep = await prepareStoryboardFirstFrames({ cardId: storyboardCardId });
    if ("error" in prep) throw new Error(prep.error);
    const childId = prep.children[0]!.childCardId;

    const acctBefore = await account(ownerId);
    const res = idOf(await coworkGenerate({ cardId: childId, prompt: "sunrise over hills", entityIds: [], variantSel: {} }));

    expect(await jobCountFor(ownerId, childId)).toBe(1);
    const acctAfter = await account(ownerId);
    expect(acctAfter.reserved).toBeGreaterThan(0); // charged
    expect(acctAfter.balance).toBeLessThan(acctBefore.balance);
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: res.id, ownerId }, select: { idempotencyKey: true } });
    expect(job.idempotencyKey).toBe(`cowork:${childId}`);
  });

  it("reload/retry after a legitimate confirm stays idempotent — the same GenJob comes back, never a second charge", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);
    const shotId = `shot_${randomUUID()}`;
    const storyboardCardId = await seedStoryboardCard(ownerId, threadId, shotId);

    const prep = await prepareStoryboardFirstFrames({ cardId: storyboardCardId });
    if ("error" in prep) throw new Error(prep.error);
    const childId = prep.children[0]!.childCardId;

    const first = idOf(await coworkGenerate({ cardId: childId, prompt: "sunrise over hills", entityIds: [], variantSel: {} }));
    const acctAfterFirst = await account(ownerId);

    // A stale tab reload calls confirm again on the SAME (now legitimately spent) child id.
    // coworkGenerate's own `cowork:<cardId>` fast-path returns the existing job before this
    // fix's check ever runs — proving the new invariant does not interfere with normal replay.
    const second = idOf(await coworkGenerate({ cardId: childId, prompt: "sunrise over hills", entityIds: [], variantSel: {} }));
    expect(second.id).toBe(first.id);
    expect(await jobCountFor(ownerId, childId)).toBe(1); // still exactly one job
    const acctAfterSecond = await account(ownerId);
    expect(acctAfterSecond.balance).toBe(acctAfterFirst.balance); // no second charge
    expect(acctAfterSecond.reserved).toBe(acctAfterFirst.reserved);
  });

  it("a plain (non-storyboard) cowork card — no storyboardCardId on its payload — is entirely unaffected by this gate", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const threadId = await seedThread(ownerId, projectId);

    // A regular direct-propose GEN_CARD (the shape buildProposeCard produces on its own, with
    // no storyboardCardId/shotId back-link) — never touched by any storyboard gate.
    const cardId = `card_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: cardId, threadId, ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
        payload: {
          kind: "image",
          structuredPrompt: "a cup steaming on a marble counter",
          entityIds: [],
          variantSel: {},
          model: "seedream",
          estimatedCredits: 1,
          params: { count: 1 },
        } as unknown as Prisma.InputJsonObject,
      },
    });

    const acctBefore = await account(ownerId);
    idOf(await coworkGenerate({ cardId, prompt: "a cup steaming on a marble counter", entityIds: [], variantSel: {} }));
    expect(await jobCountFor(ownerId, cardId)).toBe(1);
    const acctAfter = await account(ownerId);
    expect(acctAfter.balance).toBeLessThan(acctBefore.balance);
  });

  it("a forged/foreign storyboardCardId on the child's payload fails closed (owner-scoped parent lookup finds nothing) rather than leaking cross-tenant state", async () => {
    const ownerA = await seedOrg(1000);
    const ownerB = await seedOrg(1000);
    const projectA = await seedProject(ownerA);
    const threadA = await seedThread(ownerA, projectA);
    const projectB = await seedProject(ownerB);
    const threadB = await seedThread(ownerB, projectB);
    const shotId = `shot_${randomUUID()}`;

    // Tenant B's real storyboard card, with a real current-pointer child (irrelevant to A).
    const storyboardCardB = await seedStoryboardCard(ownerB, threadB, shotId);
    asOwner(ownerB);
    const prepB = await prepareStoryboardFirstFrames({ cardId: storyboardCardB });
    if ("error" in prepB) throw new Error(prepB.error);

    // Tenant A's child card claims (via a hand-crafted payload — never reachable through any
    // real mint path, since mintChild always stamps the SAME owner's parent id) to belong to
    // tenant B's storyboard card.
    const forgedChildId = `card_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: forgedChildId, threadId: threadA, ownerId: ownerA, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
        payload: {
          kind: "image",
          structuredPrompt: "forged cross-tenant pointer",
          entityIds: [],
          variantSel: {},
          model: "seedream",
          estimatedCredits: 1,
          params: { count: 1 },
          storyboardCardId: storyboardCardB, // foreign id
          shotId,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    asOwner(ownerA);
    const acctBeforeA = await account(ownerA);
    const res = await coworkGenerate({ cardId: forgedChildId, prompt: "forged cross-tenant pointer", entityIds: [], variantSel: {} });

    // The owner-scoped parent lookup (WHERE ownerId = ownerA) can never find tenant B's card —
    // fail closed, exactly like a genuinely orphaned child.
    expect("error" in res).toBe(true);
    expect(await jobCountFor(ownerA, forgedChildId)).toBe(0);
    const acctAfterA = await account(ownerA);
    expect(acctAfterA.reserved).toBe(acctBeforeA.reserved);
    expect(acctAfterA.balance).toBe(acctBeforeA.balance);
  });
});
