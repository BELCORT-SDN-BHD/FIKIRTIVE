/**
 * gen-ledger — the account-layer FULL-REAL ledger proof for W-B3-E-P (spec §5.2 E-P / §6.1).
 *
 * The DIRECT startGen spend chain (`pricedGenCredits` quote → confirm → `startGen` reserve →
 * worker settle/refund), proven on real Postgres (*_test), real Prisma, real credit ledger —
 * the factory-batch layer already has this proof through `runVariantBatch`/`runBulkGrid`
 * (factory-batch-ledger.test.ts, W-B3-F-P); THIS file proves the same invariants for the
 * plain-key path every canvas/cowork/direct caller uses, plus the cancel route.
 *
 * The worker's terminal outcomes are exercised via the SAME settleCredits / refundReservation
 * the worker calls (the worker reads the released amount FROM the RESERVE row and never
 * recomputes a price — see apps/worker/src/jobs/gen.ts; precedent: factory-batch-ledger).
 * Zero provider calls, zero real spend. Only the web plumbing around startGen is mocked
 * (auth guard, impersonation, queue, guardian, model registry, next/cache).
 *
 * Proves (EP-A2/A3/A5 + EP-A4 route ④ + 六态②):
 *  - quote == reserve == settle for a plain image batch (count 1-4) AND a plain video job;
 *  - the same idempotency key replays while ACTIVE (sequential AND concurrent) without a second charge;
 *  - under D-035, reusing a plain key after DONE/FAILED is an authorized new generation;
 *  - a retry after FAILED is a NEW job that settles once — the failed job's late finalizers no-op;
 *  - across a count 1-4 job set with partial failure: reserved == settled + refunded, and ONLY
 *    the failed jobs are refunded (each failed job releases its FULL count-hold);
 *  - insufficient balance fails closed with no job, no ledger row, no balance change;
 *  - cancel refunds a QUEUED job exactly once, refuses an in-flight job honestly ("stop button"
 *    verdict 2026-07-14: no new action + queued refund + honest "too late"), and never claws
 *    back a settled charge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { INTERNAL_PER_DISPLAY, displayCredits, pricedGenCredits } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({ requireOwner: mockRequireOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
// MONEY-A6 需要能**换掉**这个假货:它默认放行(其余用例不测 guardian),但演员那条用例要让
// **真的** checkCast 跑起来 —— 只有真 guardian 会去查 Entity 行,而「查得到」正是那条用例的证据。
const mockCheckCast = vi.hoisted(() => vi.fn(async (_req: unknown): Promise<unknown> => null));
vi.mock("../cowork-guardian", () => ({ checkCast: mockCheckCast }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startGen, startCoworkGen } = await import("../gen-actions");
const { cancelGenJob } = await import("../cowork-actions");
const { prisma, settleCredits, refundReservation } = await import("@fikirtive/db");

const IMG = INTERNAL_PER_DISPLAY; // 1 displayed credit per image = 10 internal

// ── real-DB helpers (factory-batch-ledger pattern) ───────────────────────────
async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "Gen ledger test" } });
  return id;
}
async function account(ownerId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerId } });
}
async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}
async function jobs(ownerId: string, projectId: string) {
  return prisma.genJob.findMany({ where: { ownerId, projectId }, select: { id: true, status: true, count: true, kind: true, videoOptions: true } });
}
// The worker's terminal outcomes, via the SAME ledger fns the worker calls.
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
/** Unwrap a StartGenResult or fail the test with its error. */
function idOf(res: Awaited<ReturnType<typeof startGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks 只清调用记录,**不清实现** —— MONEY-A6 那条会换上真 guardian,
  // 不在这里放回默认,它就会漏给后面每一个用例。
  mockCheckCast.mockImplementation(async () => null);
});

describe("W-B3-E-P ledger — EP-A2: quote == reserve == settle, plain image batch (count 1-4)", () => {
  it("a count=4 image job reserves exactly the pricedGenCredits quote and settles the same number", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // ① QUOTE — the single pricing authority, pinned to the literal price sheet.
    const quote = pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 4, referenceVideoGenerationId: null, videoOptions: null });
    expect(quote).toBe(4 * IMG);

    // ② RESERVE — the real startGen against real Postgres.
    const res = idOf(await startGen({
      projectId, prompt: "product hero on white", entityIds: [], count: 4,
      kind: "image", model: "seedream", idempotencyKey: `img4-${randomUUID().slice(0, 8)}`,
    }));
    expect(res.disposition).toBe("fresh");
    const reserveRow = (await ledger(ownerId)).find((r) => r.kind === "RESERVE" && r.refId === res.id);
    expect(reserveRow).toBeDefined();
    expect(reserveRow!.reservedDelta).toBe(quote); // reserve == quote
    expect(reserveRow!.balanceDelta).toBe(-quote);
    expect((await account(ownerId)).reserved).toBe(quote);
    expect((await account(ownerId)).balance).toBe(1000 - quote);

    // ③ SETTLE — the worker's commit reads the RESERVE row; net charge == quote.
    await workerSettle(ownerId, res.id);
    const rows = await ledger(ownerId);
    const settleRow = rows.find((r) => r.kind === "SETTLE" && r.refId === res.id);
    expect(settleRow).toBeDefined();
    expect(settleRow!.reservedDelta).toBe(-quote); // settle releases exactly the reserve
    expect(settleRow!.balanceDelta).toBe(0); // GEN path: A == B, nothing given back
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - quote); // charged exactly the quote — 三数一致
  });
});

describe("W-B3-E-P ledger — EP-A2: quote == reserve == settle, plain video job", () => {
  it("a seedance-2-mini 720p/10s job reserves exactly the 22-displayed-credit quote and settles the same", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const quote = pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, referenceVideoGenerationId: null, videoOptions: { seconds: 10, resolution: "720p" } });
    expect(quote).toBe(22 * IMG); // flat 720p/10s tier(#644 裁决 2026-08-06:14 → 22 显示 credits)

    const res = idOf(await startGen({
      projectId, prompt: "product spin, longer take", entityIds: [], count: 1,
      kind: "video", model: "seedance-2-mini", durationSeconds: 10, resolution: "720p",
      idempotencyKey: `vid10-${randomUUID().slice(0, 8)}`,
    }));
    expect(res.disposition).toBe("fresh");

    // the persisted job carries the options the quote was computed from (worker settles the frozen row)
    const [job] = await jobs(ownerId, projectId);
    expect(job).toMatchObject({ id: res.id, kind: "VIDEO", count: 1 });
    expect(job.videoOptions).toMatchObject({ seconds: 10, resolution: "720p" });

    const reserveRow = (await ledger(ownerId)).find((r) => r.kind === "RESERVE" && r.refId === res.id);
    expect(reserveRow!.reservedDelta).toBe(quote);
    expect((await account(ownerId)).reserved).toBe(quote);

    await workerSettle(ownerId, res.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - quote); // settle == reserve == quote
  });

  /**
   * #785 —— 多素材参考**不改一格钱**,在真库上证一遍。
   *
   * 为什么这条值得单开一个案例:这一票让商家 @ 的产品图/代言人照片真的进了视频引擎,
   * 而「多送了素材」听上去就像该多收钱。它不该 —— 引擎的计费公式是
   * `(参考视频秒数 + 出片秒数) × 像素 × 帧率`(见 `byteplusVideoCogsUsd`),**参考图不在
   * 公式里**;收费那一侧(`pricedGenCredits`)同样只看引擎/时长/分辨率/张数。
   *
   * 所以这里钉的是同一档视频**带 @元素**与**不带**的三个数完全相同:报价、预扣、结算。
   * 哪天有人把参考照数量接进价格,这条当场红 —— 而那正是必须先经 Founder 裁价的改动。
   */
  it("#785: @elements on a video job change nothing about the money — quote, reserve and settle are identical", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const quote = pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, referenceVideoGenerationId: null, videoOptions: { seconds: 5, resolution: "720p" } });

    const base = {
      projectId, prompt: "our product on a beach", count: 1,
      kind: "video" as const, model: "seedance-2-mini", durationSeconds: 5, resolution: "720p",
    };
    const bare = idOf(await startGen({ ...base, entityIds: [], idempotencyKey: `v785-bare-${randomUUID().slice(0, 8)}` }));
    const withElements = idOf(await startGen({
      ...base,
      entityIds: ["ent_product", "ent_face", "ent_logo"],
      idempotencyKey: `v785-elem-${randomUUID().slice(0, 8)}`,
    }));

    const rows = await ledger(ownerId);
    const reserveOf = (id: string) => rows.find((r) => r.kind === "RESERVE" && r.refId === id)!;
    expect(reserveOf(bare.id).reservedDelta).toBe(quote);
    expect(reserveOf(withElements.id).reservedDelta).toBe(quote); // 带素材 ⇒ 同一格价钱

    // 元素真的落在了那一单上(否则上面那句「同价」就是拿两个空单在比)。
    const elemJob = await prisma.genJob.findFirstOrThrow({ where: { id: withElements.id, ownerId }, select: { entityIds: true } });
    expect(elemJob.entityIds).toEqual(["ent_product", "ent_face", "ent_logo"]);

    await workerSettle(ownerId, bare.id);
    await workerSettle(ownerId, withElements.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - quote * 2); // 两单各扣一格价钱,一分不多
  });

  /**
   * MONEY-A6(规格 docs/specs/money-engine.md §2 验收表)—— **读侧**那一半。
   *
   *   > 商家用演员库角色出一条视频,再用同参数(同时长同分辨率)出一条不带演员的
   *   > ⇒ 两次报价逐字相等;消费历史**不存在**「演员费」行
   *
   * 上一条(#785)钉的是**写侧**:报价、预扣、结算三个数相同。那证明了我们没多收钱,
   * 但没证明商家**看不到**一笔演员费 —— 验收行的后半句问的是消费历史那一屏。这两件事
   * 可以分开坏:账本一格没多扣,而消费历史多折出一条「Actor」类目行(或者把带演员那一单
   * 折成两条),商家照样会打开账单问「这个演员费是什么」。一条他要为之付钱的行,和一条
   * 他以为要为之付钱的行,对信任的伤害是一样的。
   *
   * 所以这一条走**真实卡片入口** `startCoworkGen` 下两单(一单带演员、一单裸),然后:
   *   ① 账本侧逐格对:行数、kind 序列、金额,各恰好 RESERVE + SETTLE 两行;
   *   ② 把两单的账本行分别交给**商家消费历史真正用的那个函数** `buildSpendHistory`,
   *      对条目数、类目、金额、pending、detail 逐格比 —— 相同参数下两屏必须一模一样;
   *   ③ 反向:两边都不许出现任何「演员 / actor」味道的类目或文案。
   *
   * 两个 org 是**故意**的:一单一个账本,「恰好两行」「历史恰好一条」才是干净的判定,
   * 不用在混着两单的行里挑。
   *
   * **为什么必须走 `startCoworkGen` 而不是直接调 `startGen`**(复审三 P1):演员的**审批身份**
   * (`approvedEntities`)只有一条合法来源 —— 服务端读出来的那张 GEN_CARD。直接调 `startGen`
   * 并自带一份快照会被 `gen-actions.ts` 的可信来源闸当场拒掉(「out of bounds」),而**不带**
   * 快照则整个 `frozenEntities` 分支不执行、`GenJob.approvedEntities` 落空。也就是说:上一版
   * 那两单其实都没走过演员真正会走的那段代码,将来谁把「演员费」挂在 `frozenEntities` 那条路
   * 上,这条验收照样全绿。所以两单都从卡片入口进,裸单的卡上是空快照 —— 比较条件对称,
   * 而带演员那一单是真的把审批身份冻进了任务行。
   */
  it("MONEY-A6: an actor-backed video reads in spend history exactly like a bare one — no actor line, anywhere", async () => {
    const { buildSpendHistory } = await import("../spend-history");
    const TZ = "Asia/Kuala_Lumpur";

    const base = {
      prompt: "our product on a beach", count: 1,
      kind: "video" as const, model: "seedance-2-mini", durationSeconds: 5, resolution: "720p",
    };
    /** 活行的名字与卡上快照的名字是同一个常量 —— startGen 的漂移闸比的就是这两者。 */
    const ACTOR_NAME = "Nadia";
    const quote = pricedGenCredits({ kind: "VIDEO", model: "seedance-2-mini", count: 1, referenceVideoGenerationId: null, videoOptions: { seconds: 5, resolution: "720p" } });

    /**
     * 一个**真的**演员:CHARACTER 类型的 Entity,名下挂一张 base 参考图。
     *
     * 两样都必须真:①真 Entity 行 —— 真 guardian 查不到就报 `missing-entity`,startGen 当场
     * 返回 error,这条用例直接炸(所以「查得到」是被证明的,不是被假设的);②真 base 参考图 ——
     * 一个没有参考图的 CHARACTER 会踩 `character-no-refs` 那道闸,同样炸。合起来:这一单走的
     * 是商家用演员库角色出片时,服务端真正会走的那条路。
     */
    async function seedActor(ownerId: string): Promise<string> {
      const entityId = `ent_${randomUUID()}`;
      const assetId = `ast_${randomUUID()}`;
      await prisma.entity.create({ data: { id: entityId, ownerId, type: "CHARACTER", name: ACTOR_NAME } });
      await prisma.asset.create({
        data: {
          id: assetId, ownerId, contentHash: randomUUID().replace(/-/g, ""),
          ext: "png", mime: "image/png", sizeBytes: BigInt(1024), originalFilename: "nadia.png",
        },
      });
      await prisma.referenceImage.create({
        data: { id: `ref_${randomUUID()}`, ownerId, entityId, assetId, position: 0 },
      });
      return entityId;
    }

    /**
     * 一张**真的** GEN_CARD:商家批准演员出镜时,服务端持久化下来的那张卡。
     *
     * `startCoworkGen` 只认这一份 —— 它按 `cowork:<cardId>` 从库里读卡,拿卡上的
     * `approvedEntities` **覆盖**掉调用方提交的同名字段,再把那个进程内对象交给 `startGen`。
     * 审批身份能进任务行的路径只有这一条,伪造不了(#774 那条判词的执行形态)。
     */
    async function seedGenCard(input: {
      ownerId: string; projectId: string;
      approvedEntities: { id: string; type: string; name: string }[];
    }): Promise<{ threadId: string; cardId: string }> {
      const threadId = `thr_${randomUUID()}`;
      const cardId = `msg_${randomUUID()}`;
      await prisma.chatThread.create({
        data: { id: threadId, ownerId: input.ownerId, projectId: input.projectId, title: "Otto" },
      });
      await prisma.chatMessage.create({
        data: {
          id: cardId, threadId, ownerId: input.ownerId, role: "AGENT", kind: "GEN_CARD", seq: 1,
          text: "",
          payload: {
            kind: "video", model: "seedance-2-mini",
            // 卡面冻结价:`startGen` 拿它跟现算价逐格核对(卡面价≠现算价一律拒,MONEY-A11)。
            // **现算**,不手抄 —— 这一格是显示 credits,报价函数给的是 internal。
            estimatedCredits: displayCredits(quote),
            approvedEntities: input.approvedEntities,
          },
        },
      });
      return { threadId, cardId };
    }

    /** 下一单、结算、把这个 org 的账本折成商家看到的那几条。 */
    async function orderAndRead(tag: string, withActor: boolean) {
      const ownerId = await seedOrg(1000);
      asOwner(ownerId);
      const projectId = await seedProject(ownerId);
      const entityIds = withActor ? [await seedActor(ownerId)] : [];
      // 卡上的审批快照:名字与类型必须与活行**逐字**相同,否则 startGen 的漂移闸会拒
      // (「renamed or changed type since this plan」)—— 这条用例顺带正向证明了那道闸。
      const approvedEntities = entityIds.map((id) => ({ id, type: "CHARACTER", name: ACTOR_NAME }));
      const { threadId, cardId } = await seedGenCard({ ownerId, projectId, approvedEntities });
      const job = idOf(await startCoworkGen({
        ...base, projectId, entityIds, threadId,
        // `cowork:<cardId>` 是卡片入口的口令;换个前缀 startCoworkGen 当场拒。
        // tag 只用来读日志,不进键 —— 键必须逐字是这张卡的 id。
        idempotencyKey: `cowork:${cardId}`,
      }));
      void tag;
      await workerSettle(ownerId, job.id);

      const rows = await ledger(ownerId);
      // buildSpendHistory 吃的是**新在前**(它靠顺序决定条目顺序);`ledger()` 给的是旧在前。
      const entries = buildSpendHistory(
        [...rows].reverse().map((r) => ({
          id: r.id, kind: r.kind, source: r.source, refId: r.refId,
          balanceDelta: r.balanceDelta, reservedDelta: r.reservedDelta, createdAt: r.createdAt,
        })),
        new Map([[job.id, "VIDEO" as const]]),
        TZ,
      );
      return { ownerId, jobId: job.id, entityIds, rows, entries, balance: (await account(ownerId)).balance };
    }

    // 这条用例让**真的** checkCast 跑 —— 它会真的去查 Entity 行。传一个不存在的 id 进去,
    // 真 guardian 报 missing-entity ⇒ startGen 返回 error ⇒ idOf 抛 ⇒ 用例红。
    // 也就是说:下面「演员被解析到了」不是一句断言,是这条用例能跑完的前提。
    const { checkCast: realCheckCast } =
      await vi.importActual<typeof import("../cowork-guardian")>("../cowork-guardian");
    mockCheckCast.mockImplementation((req) => realCheckCast(req as Parameters<typeof realCheckCast>[0]));

    const bare = await orderAndRead("bare", false);
    const actor = await orderAndRead("actor", true);
    const actorEntityId = actor.entityIds[0]!;

    // 演员真的挂在那一单上 —— 否则下面所有「相同」都是拿两个空单在比。
    const actorJob = await prisma.genJob.findFirstOrThrow({
      where: { id: actor.jobId, ownerId: actor.ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    const bareJob = await prisma.genJob.findFirstOrThrow({
      where: { id: bare.jobId, ownerId: bare.ownerId },
      select: { entityIds: true, approvedEntities: true },
    });
    expect(actorJob.entityIds, "带演员那一单没真的带上演员").toEqual([actorEntityId]);
    expect(bareJob.entityIds, "裸单不该带元素").toEqual([]);

    // 真 guardian 确实拿着这个 id 被调过(而且它内部真的查了 Entity —— 查不到就不会走到这里)。
    expect(mockCheckCast, "guardian 没被以这一单的演员 id 调用").toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: actor.ownerId, entityIds: [actorEntityId] }),
    );

    // **审批身份真的冻进了任务行**(复审三 P1)。这一格是 `gen-actions.ts` 里
    // `frozenEntities` 那条分支唯一的持久化痕迹:它非空,就说明这一单确实穿过了
    // 「卡片读出 → 漂移核对 → 冻结」那整段代码,而不是绕过它下的单。
    // 将来谁把「演员费」挂在那条路上,这条验收才拦得住。
    expect(actorJob.approvedEntities, "演员的审批身份没冻进任务行 —— 这一单没走卡片分支").toEqual([
      { id: actorEntityId, type: "CHARACTER", name: ACTOR_NAME },
    ]);
    // 裸单是同一个入口、同一张卡的形状,只是快照为空 —— 比较条件对称。
    expect(bareJob.approvedEntities, "裸单不该带任何审批身份").toBeNull();
    // 那一行确实是个带参考图的 CHARACTER —— 「演员」这个词在这条用例里有实体含义。
    const actorRow = await prisma.entity.findFirstOrThrow({
      where: { id: actorEntityId, ownerId: actor.ownerId },
      select: { type: true, _count: { select: { referenceImages: { where: { deletedAt: null, variantId: null } } } } },
    });
    expect(actorRow.type).toBe("CHARACTER");
    expect(actorRow._count.referenceImages, "演员没有 base 参考图,真 guardian 本该拦下它").toBe(1);

    // ① 账本侧:行数、kind 序列、金额,逐格相等。
    const kindsOf = (rows: typeof bare.rows) => rows.map((r) => r.kind);
    expect(kindsOf(bare.rows), "裸单的账本行不是恰好 RESERVE + SETTLE").toEqual(["RESERVE", "SETTLE"]);
    expect(kindsOf(actor.rows), "带演员的单多/少了账本行 —— 演员不该产生第三条腿").toEqual(kindsOf(bare.rows));
    const moneyOf = (rows: typeof bare.rows) =>
      rows.map((r) => ({ kind: r.kind, balanceDelta: r.balanceDelta, reservedDelta: r.reservedDelta }));
    expect(moneyOf(actor.rows), "带演员的单在账本上被多扣/少扣了").toEqual(moneyOf(bare.rows));
    expect(actor.balance).toBe(bare.balance);
    expect(actor.balance).toBe(1000 - quote);

    // ② 读侧:商家那一屏逐格相等(id / 时间戳天然不同,比的是他读到的意思)。
    const readAs = (entries: typeof bare.entries) =>
      entries.map((e) => ({ category: e.category, label: e.label, delta: e.delta, pending: e.pending, detail: e.detail }));
    expect(bare.entries, "裸单的消费历史不是恰好一条").toHaveLength(1);
    expect(actor.entries, "带演员的单在消费历史里被折成了不止一条").toHaveLength(bare.entries.length);
    expect(readAs(actor.entries), "同参数下两单的消费历史读起来不一样").toEqual(readAs(bare.entries));
    expect(bare.entries[0]!.category).toBe("video");

    // ③ 反向:一个「演员费」味道的字都不许出现在商家读到的东西里。
    //    三个字段扫的是**同一个**正则:上一版 category 少了「演员」、label/detail 只认完整
    //    "talent fee",于是一条中文的「演员费」类目、或者一句 "talent surcharge",三格里
    //    有两格是漏的。禁词表只有一份,三格各扫一次。
    const ACTOR_WORDS = /actor|talent|演员|model[- ]?fee/i;
    for (const [who, entries] of [["裸单", bare.entries], ["带演员", actor.entries]] as const) {
      for (const entry of entries) {
        for (const [field, value] of [
          ["category", entry.category],
          ["label", entry.label],
          ["detail", entry.detail ?? ""],
        ] as const) {
          expect(value, `${who}的消费历史 ${field} 里出现了「演员费」味道的字`).not.toMatch(ACTOR_WORDS);
        }
      }
    }
  });
});

describe("W-B3-E-P ledger — EP-A5(在途面): same-key replay while the first job is ACTIVE never double-charges", () => {
  // Scope honesty (NODE-307-R1 item 1): these two cases cover the IN-FLIGHT (QUEUED/GENERATING)
  // replay only — the dedup class the active-only partial index implements. Under D-035, a
  // TERMINAL-state (post-DONE/FAILED) same-key replay is a new authorized generation; see below.
  // Do not read this title as "all replays are deduped".
  it("a sequential double-submit of the same key reuses the in-flight job — one job, one RESERVE", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `dup-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    const second = idOf(await startGen(req));

    expect(first.disposition).toBe("fresh");
    expect(second).toEqual({ id: first.id, disposition: "reused" });
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect((await account(ownerId)).reserved).toBe(IMG); // held once, never twice
  });

  it("a CONCURRENT double-submit of the same key charges once — the partial-unique index is the race-proof backstop", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `race-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "double-click", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const [left, right] = (await Promise.all([startGen(req), startGen(req)])).map(idOf);

    expect(left.id).toBe(right.id); // both callers land on the SAME job
    expect([left.disposition, right.disposition].sort()).toEqual(["fresh", "reused"]);
    expect(await jobs(ownerId, projectId)).toHaveLength(1);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(1); // the loser's tx rolled back
    expect((await account(ownerId)).reserved).toBe(IMG);
    expect((await account(ownerId)).balance).toBe(1000 - IMG);
  });
});

describe("W-B3-E-P ledger — EP-A5: a retry is a NEW job that settles once; the failed job's late finalizers no-op", () => {
  it("FAILED job refunded; retry key charges once; late settle/refund of the dead job change nothing", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    // job A fails at the provider → the worker refunds its full hold
    const a = idOf(await startGen({ projectId, prompt: "retry material", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `try-a-${randomUUID().slice(0, 8)}` }));
    await workerRefund(ownerId, a.id);
    expect((await account(ownerId)).reserved).toBe(0);
    expect((await account(ownerId)).balance).toBe(1000); // fully restored

    // the user retries with a fresh key → a NEW job, a NEW reserve — never a resurrection of A
    const b = idOf(await startGen({ projectId, prompt: "retry material", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `try-b-${randomUUID().slice(0, 8)}` }));
    expect(b.disposition).toBe("fresh");
    expect(b.id).not.toBe(a.id);
    await workerSettle(ownerId, b.id);

    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000 - IMG); // charged exactly once across the whole retry story
    expect(acct.reserved).toBe(0);
    const rows = await ledger(ownerId);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "REFUND").map((r) => r.refId)).toEqual([a.id]);
    expect(rows.filter((r) => r.kind === "SETTLE").map((r) => r.refId)).toEqual([b.id]);

    // 六态⑥恢复 no-double: late redelivery finalizers against the DEAD job are pure no-ops
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ownerId, refId: a.id }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerId, refId: a.id }));
    const after = await account(ownerId);
    expect(after.balance).toBe(1000 - IMG); // unchanged
    expect(after.reserved).toBe(0);
    expect(await ledger(ownerId)).toHaveLength(rows.length); // not one row more
  });
});

describe("W-B3-E-P ledger — D-035 terminal-state plain-key replay starts a new authorized generation", () => {
  // D-035 defines plain keys as IN-FLIGHT double-submit guards, not exactly-once-ever keys:
  // the fast path matches QUEUED/GENERATING and the partial-unique index is active-only.
  // Reuse after DONE/FAILED therefore represents explicit new consumption, with a new job and
  // reservation. Cowork and factory keys retain their separate durable replay semantics.
  it("D-035: after DONE, the same plain key creates a NEW job and a SECOND reservation", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `term-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    await workerSettle(ownerId, first.id); // DONE — the first charge settled

    const replay = idOf(await startGen(req)); // SAME key, after the terminal state

    // D-035 authority behavior — terminal replay is a new authorized generation:
    expect(replay.disposition).toBe("fresh");
    expect(replay.id).not.toBe(first.id);
    expect(await jobs(ownerId, projectId)).toHaveLength(2);
    expect((await ledger(ownerId)).filter((r) => r.kind === "RESERVE")).toHaveLength(2); // second reservation
    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000 - 2 * IMG); // first charged AND second held
    expect(acct.reserved).toBe(IMG);
  });

  it("D-035: after FAILED(+refund), the same plain key creates a new job with only the new hold", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const key = `termf-${randomUUID().slice(0, 8)}`;
    const req = { projectId, prompt: "same request", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: key };

    const first = idOf(await startGen(req));
    await workerRefund(ownerId, first.id); // FAILED — the hold fully refunded

    const replay = idOf(await startGen(req));

    expect(replay.disposition).toBe("fresh");
    expect(replay.id).not.toBe(first.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(IMG); // only the new job's hold
    expect(acct.balance).toBe(1000 - IMG); // net charge so far = 0 (refund restored the first hold)
  });
});

describe("W-B3-E-P ledger — across INDEPENDENT jobs: reserved == settled + refunded, only failed JOBS refunded", () => {
  // Scope honesty (NODE-307-R1 item 2): this proves the PER-JOB accounting identity across a
  // set of independent count-1..4 jobs — it is NOT a sub-cell partial-failure proof for a
  // single count=2-4 GenJob. The authority has no sub-cell settle/refund (one provider call,
  // one hold, one finalizer per job). The worker layer now pins D-035's exact-count,
  // all-or-nothing behavior for a single count=2-4 GenJob (gen.test.ts).
  it("across count=1/2/4 image jobs + a video job, 2 failed JOBS release exactly their own full holds", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const mk = (over: Record<string, unknown>) => ({
      projectId, prompt: "cell", entityIds: [], kind: "image", model: "seedream",
      idempotencyKey: `cell-${randomUUID().slice(0, 8)}`, ...over,
    });

    const j1 = idOf(await startGen(mk({ count: 1 })));                                              // 10 — settles
    const j2 = idOf(await startGen(mk({ count: 2, prompt: "cell two" })));                          // 20 — fails
    const j3 = idOf(await startGen(mk({ count: 4, prompt: "cell three" })));                        // 40 — fails
    const j4 = idOf(await startGen(mk({ count: 1, kind: "video", model: "seedance-2-mini", durationSeconds: 5, resolution: "720p", prompt: "cell four" }))); // 110 — settles
    expect((await account(ownerId)).reserved).toBe(10 + 20 + 40 + 110);

    await workerSettle(ownerId, j1.id);
    await workerRefund(ownerId, j2.id);
    await workerRefund(ownerId, j3.id);
    await workerSettle(ownerId, j4.id);

    const rows = await ledger(ownerId);
    // ONLY the failed JOBS are refunded, each for its FULL count-hold (a failed 4-variant job
    // releases all 4 units — nothing is silently retained)
    const refunds = rows.filter((r) => r.kind === "REFUND");
    expect(new Set(refunds.map((r) => r.refId))).toEqual(new Set([j2.id, j3.id]));
    expect(refunds.map((r) => r.balanceDelta).sort((x, y) => x - y)).toEqual([20, 40]);
    // the settled jobs kept exactly their quotes
    const settles = rows.filter((r) => r.kind === "SETTLE");
    expect(new Set(settles.map((r) => r.refId))).toEqual(new Set([j1.id, j4.id]));

    // 分账精确: reserved == settled + refunded (internal credits, per the ledger itself)
    const reserved = rows.filter((r) => r.kind === "RESERVE").reduce((s, r) => s + r.reservedDelta, 0);
    const settled = settles.reduce((s, r) => s - r.reservedDelta, 0);
    const refunded = refunds.reduce((s, r) => s - r.reservedDelta, 0);
    expect(reserved).toBe(180);
    expect(settled).toBe(120);
    expect(refunded).toBe(60);
    expect(reserved).toBe(settled + refunded);

    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - 120); // charged for the successes only
  });
});

describe("W-B3-E-P ledger — 六态②: insufficient balance fails closed", () => {
  it("an underfunded startGen leaves NO job, NO ledger row, and the balance untouched", async () => {
    const ownerId = await seedOrg(IMG - 1); // one internal credit short of a single image
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);

    const res = await startGen({ projectId, prompt: "over budget", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `broke-${randomUUID().slice(0, 8)}` });

    expect(res).toEqual({ error: expect.stringMatching(/credits/i) });
    expect(await jobs(ownerId, projectId)).toHaveLength(0); // the whole tx rolled back — no job
    expect(await ledger(ownerId)).toHaveLength(0); // and no ledger residue
    const acct = await account(ownerId);
    expect(acct.balance).toBe(IMG - 1); // untouched
    expect(acct.reserved).toBe(0);
  });
});

describe("W-B3-E-P ledger — EP-A4 route ④: cancel (the stop button)", () => {
  it("cancelling a QUEUED job refunds exactly once; a second cancel is an honest no-op", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const res = idOf(await startGen({ projectId, prompt: "stop me", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `stop-${randomUUID().slice(0, 8)}` }));
    expect((await account(ownerId)).reserved).toBe(IMG);

    const first = await cancelGenJob({ jobId: res.id });
    expect(first).toEqual({ refunded: true });
    const acct = await account(ownerId);
    expect(acct.balance).toBe(1000); // fully restored
    expect(acct.reserved).toBe(0);
    const job = await prisma.genJob.findUniqueOrThrow({ where: { id: res.id, ownerId } });
    // 取消有自己的词(#602 T3);这条测试守的是钱,而钱路一个字节没变。
    expect(job.status).toBe("CANCELLED");
    expect(job.error).toBe("Canceled by you");

    // double-click on the stop button: at-most-once refund
    const second = await cancelGenJob({ jobId: res.id });
    expect(second).toEqual({ alreadyStarted: true });
    expect((await ledger(ownerId)).filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect((await account(ownerId)).balance).toBe(1000); // not one credit more
  });

  it("cancelling an in-flight job refuses honestly ('too late') — the hold survives and the settle keeps the charge", async () => {
    const ownerId = await seedOrg(1000);
    asOwner(ownerId);
    const projectId = await seedProject(ownerId);
    const res = idOf(await startGen({ projectId, prompt: "too late", entityIds: [], count: 1, kind: "image", model: "seedream", idempotencyKey: `late-${randomUUID().slice(0, 8)}` }));

    // the worker claimed it (QUEUED → GENERATING) before the user clicked stop
    await prisma.genJob.update({ where: { id: res.id, ownerId }, data: { status: "GENERATING", startedAt: new Date() } });

    const result = await cancelGenJob({ jobId: res.id });
    expect(result).toEqual({ alreadyStarted: true }); // honest "too late" — never a fake refund
    expect((await ledger(ownerId)).filter((r) => r.kind === "REFUND")).toHaveLength(0);
    expect((await account(ownerId)).reserved).toBe(IMG); // the hold belongs to the running job

    // the run finishes → the charge settles normally; cancel never clawed anything back
    await workerSettle(ownerId, res.id);
    const acct = await account(ownerId);
    expect(acct.reserved).toBe(0);
    expect(acct.balance).toBe(1000 - IMG);
  });
});
