/**
 * Fixtures for the resident E2E suite (#799).
 *
 * WHAT IS SEEDED AND WHAT IS NOT. Everything a merchant would have BEFORE the journey starts is
 * written here: the workspace, the person, the invite row, the wallet, the ledger history. What
 * the journey is ABOUT is never seeded — a deletion journey deletes through the product's own
 * button, a refund-visibility journey reads the product's own page.
 *
 * MONEY SHAPES ARE THE REAL ONES. Every reserve/settle/refund fixture below writes the exact rows
 * `packages/db/src/credits.ts` writes, with the same idempotency keys (`reserve:<refId>`,
 * `settle:<refId>`, `refund:<refId>`) and the same account arithmetic. That is what lets a journey
 * assert on the merchant's screen and mean something: the page is folding rows of the same shape
 * production folds. A fixture that invented its own ledger shape would be testing the fixture.
 *
 * NOTHING HERE SPENDS. No provider is configured for the app under test (see support/env.ts), so
 * a generation fixture is a row describing a job that already happened, never a call to anybody.
 */
import { randomUUID } from "node:crypto";
import { prisma, runAsTenant, INTERNAL_PER_DISPLAY } from "./db.js";

/** Displayed credits → the internal unit the ledger and the account column are kept in. */
function internal(displayed: number): number {
  return Math.round(displayed * INTERNAL_PER_DISPLAY);
}

function id(prefix: string): string {
  return `e2e_${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Fixed instants, so nothing in a journey depends on when it ran. They are far enough apart that
 *  "newest first" is a fact about the rows rather than about clock resolution. */
const T0 = new Date("2026-03-01T02:00:00.000Z");
function at(minutesAfterT0: number): Date {
  return new Date(T0.getTime() + minutesAfterT0 * 60_000);
}

export type Workspace = {
  slug: string;
  orgId: string;
  userId: string;
  baUserId: string;
  email: string;
  personName: string;
  workspaceName: string;
  projectId: string;
  /** Ledger clock: each fixture takes the next slot, so ordering is deterministic. */
  next: () => Date;
};

/**
 * One merchant, ready to sign in: workspace, person, invite row, wallet, and a first project.
 *
 * `openingGrant` is in DISPLAYED credits — the unit the merchant reads everywhere — and lands as
 * one GRANT row plus the matching balance, exactly like the welcome grant.
 */
export async function seedWorkspace(opts: {
  /** Unique across the whole suite: it becomes this merchant's email address, and two journeys
   *  sharing an address would share a person. Keep it short and readable — it shows up in the
   *  product's own UI when a journey fails. */
  slug: string;
  workspaceName: string;
  personName: string;
  openingGrant: number;
}): Promise<Workspace> {
  const email = `${opts.slug}@e2e.test`;
  const orgId = id(`org_${opts.slug}`);
  const userId = id(`user_${opts.slug}`);
  const baUserId = id(`ba_${opts.slug}`);
  const projectId = id(`proj_${opts.slug}`);
  let tick = 0;

  await prisma.organization.create({
    data: {
      id: orgId,
      name: opts.workspaceName,
      // Fixed timezone so every rendered charge time is derived from the workspace setting
      // rather than from the runner's own zone.
      settings: { timezone: "Asia/Kuala_Lumpur" },
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      email,
      name: opts.personName,
      emailVerified: at(0),
      role: "viewer",
    },
  });
  await prisma.betterAuthUser.create({
    data: { id: baUserId, email, name: opts.personName, emailVerified: true },
  });
  const membership = await prisma.membership.create({
    data: { id: id(`mem_${opts.slug}`), userId, orgId, role: "owner", status: "active" },
  });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, role: "owner" } });
  // The deny-by-default door stays a real door: the address is INVITED, not exempted.
  await prisma.allowedEmail.create({
    data: { email, status: "active", invitedBy: "e2e-seed" },
  });
  await prisma.creditAccount.create({
    data: { orgId, balance: internal(opts.openingGrant), reserved: 0 },
  });
  await prisma.creditLedger.create({
    data: {
      id: id("grant"),
      orgId,
      balanceDelta: internal(opts.openingGrant),
      reservedDelta: 0,
      kind: "GRANT",
      source: "BETA",
      reason: "e2e opening grant",
      idempotencyKey: `e2e:grant:${orgId}`,
      createdBy: "e2e-seed",
      createdAt: at(tick++),
    },
  });
  await runAsTenant(orgId, () =>
    prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Ramadan promo" } }),
  );

  return {
    slug: opts.slug,
    orgId,
    userId,
    baUserId,
    email,
    personName: opts.personName,
    workspaceName: opts.workspaceName,
    projectId,
    next: () => at(++tick),
  };
}

type JobKind = "IMAGE" | "VIDEO";

async function seedGenJob(ws: Workspace, refId: string, kind: JobKind, status: string, spent: boolean) {
  await runAsTenant(ws.orgId, () =>
    prisma.genJob.create({
      data: {
        id: refId,
        ownerId: ws.orgId,
        projectId: ws.projectId,
        prompt: "A cup of kopi on a rattan table",
        kind: kind as never,
        model: kind === "VIDEO" ? "e2e-mock-video" : "e2e-mock-image",
        status: status as never,
        spent,
        createdAt: at(0),
      },
    }),
  );
}

/** A generation still in flight: the hold is taken, nothing is finalised. */
export async function seedOpenHold(
  ws: Workspace,
  opts: { credits: number; kind?: JobKind },
): Promise<{ refId: string }> {
  const refId = id("job");
  const cost = internal(opts.credits);
  await seedGenJob(ws, refId, opts.kind ?? "VIDEO", "GENERATING", false);
  await prisma.creditLedger.create({
    data: {
      id: id("reserve"),
      orgId: ws.orgId,
      balanceDelta: -cost,
      reservedDelta: cost,
      kind: "RESERVE",
      source: "SYSTEM",
      refId,
      idempotencyKey: `reserve:${refId}`,
      createdAt: ws.next(),
    },
  });
  await prisma.creditAccount.update({
    where: { orgId: ws.orgId },
    data: { balance: { decrement: cost }, reserved: { increment: cost } },
  });
  return { refId };
}

/** A generation that finished and was charged. `used` defaults to the full hold, which is what a
 *  generation does; a smaller `used` is the conversation-turn shape (charge what it used, give
 *  the rest back in the same row). */
export async function seedSettledJob(
  ws: Workspace,
  opts: { held: number; used?: number; kind?: JobKind },
): Promise<{ refId: string }> {
  const refId = id("job");
  const held = internal(opts.held);
  const used = internal(opts.used ?? opts.held);
  await seedGenJob(ws, refId, opts.kind ?? "IMAGE", "DONE", true);
  await prisma.creditLedger.createMany({
    data: [
      {
        id: id("reserve"),
        orgId: ws.orgId,
        balanceDelta: -held,
        reservedDelta: held,
        kind: "RESERVE",
        source: "SYSTEM",
        refId,
        idempotencyKey: `reserve:${refId}`,
        createdAt: ws.next(),
      },
      {
        id: id("settle"),
        orgId: ws.orgId,
        balanceDelta: held - used,
        reservedDelta: -held,
        kind: "SETTLE",
        source: "SYSTEM",
        refId,
        idempotencyKey: `settle:${refId}`,
        createdAt: ws.next(),
      },
    ],
  });
  // The two real moves, in order: RESERVE takes the hold out of the balance, SETTLE clears the
  // hold and gives back whatever was not used.
  await prisma.creditAccount.update({
    where: { orgId: ws.orgId },
    data: { balance: { decrement: held }, reserved: { increment: held } },
  });
  await prisma.creditAccount.update({
    where: { orgId: ws.orgId },
    data: { balance: { increment: held - used }, reserved: { decrement: held } },
  });
  return { refId };
}

/** A generation that failed after the hold was taken: the whole hold comes back. */
export async function seedRefundedJob(
  ws: Workspace,
  opts: { held: number; kind?: JobKind },
): Promise<{ refId: string }> {
  const refId = id("job");
  const held = internal(opts.held);
  await seedGenJob(ws, refId, opts.kind ?? "VIDEO", "FAILED", false);
  await prisma.creditLedger.createMany({
    data: [
      {
        id: id("reserve"),
        orgId: ws.orgId,
        balanceDelta: -held,
        reservedDelta: held,
        kind: "RESERVE",
        source: "SYSTEM",
        refId,
        idempotencyKey: `reserve:${refId}`,
        createdAt: ws.next(),
      },
      {
        id: id("refund"),
        orgId: ws.orgId,
        balanceDelta: held,
        reservedDelta: -held,
        kind: "REFUND",
        source: "SYSTEM",
        refId,
        idempotencyKey: `refund:${refId}`,
        createdAt: ws.next(),
      },
    ],
  });
  // Net zero on the account, written as the two real moves rather than as "nothing happened".
  await prisma.creditAccount.update({
    where: { orgId: ws.orgId },
    data: { balance: { decrement: held }, reserved: { increment: held } },
  });
  await prisma.creditAccount.update({
    where: { orgId: ws.orgId },
    data: { balance: { increment: held }, reserved: { decrement: held } },
  });
  return { refId };
}

/** A saved element — what the Library shows and what the delete journey deletes. */
export async function seedElement(ws: Workspace, name: string): Promise<{ entityId: string }> {
  const entityId = id("entity");
  await runAsTenant(ws.orgId, () =>
    prisma.entity.create({
      data: { id: entityId, ownerId: ws.orgId, type: "PRODUCT" as never, name, createdAt: at(0) },
    }),
  );
  return { entityId };
}

/** An empty conversation thread in the seeded project — landing on it is what puts the merchant
 *  straight on the chat composer (with its attach button) instead of the "new chat" front door,
 *  the same way opening a project with a prior conversation would. */
export async function seedThread(ws: Workspace): Promise<{ threadId: string }> {
  const threadId = id("thread");
  await runAsTenant(ws.orgId, () =>
    prisma.chatThread.create({
      data: { id: threadId, ownerId: ws.orgId, projectId: ws.projectId, title: "", createdAt: at(0) },
    }),
  );
  return { threadId };
}

/**
 * 一张 Otto 的方案卡，摆在商家眼前等他按确认。
 *
 * 2026-09-04 走查 P0-3：走查里这张卡藏在默认折起的 Conversation 抽屉里，而 Otto 在始终可见的
 * 那张卡上写「你会在上面看到两张卡」—— 上面什么都没有。种一张真的 GEN_CARD（服务端写的那份
 * payload 形状：报得出价 + 服务端建的 specChips），旅程再去看商家**不打开任何抽屉**时看得见什么。
 *
 * 没有 GenJob：这张卡还没被批准，所以一分钱都没花，ledger 上一行都没有。
 */
export async function seedPlanCard(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; credits: number; kind?: "image" | "video"; prompt?: string },
): Promise<{ cardId: string }> {
  const cardId = id("card");
  const kind = opts.kind ?? "image";
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: cardId,
        threadId,
        ownerId: ws.orgId,
        role: "AGENT" as never,
        kind: "GEN_CARD" as never,
        seq: opts.seq,
        text: "",
        payload: {
          kind,
          structuredPrompt: opts.prompt ?? "A cup of kopi on a rattan table, warm morning light",
          estimatedCredits: opts.credits,
          specChips: kind === "video" ? ["16:9", "5s", "720p"] : ["1:1", "Brand and product photo"],
          params: { count: 1, aspectRatio: kind === "video" ? "16:9" : "1:1" },
        },
        createdAt: at(opts.seq),
      },
    }),
  );
  return { cardId };
}

/** 一句 Otto 说的话，带 markdown —— 走查 P1-1 里屏幕上出现的就是它的星号。 */
export async function seedAgentText(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; text: string },
): Promise<void> {
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: id("msg"),
        threadId,
        ownerId: ws.orgId,
        role: "AGENT" as never,
        kind: "TEXT" as never,
        seq: opts.seq,
        text: opts.text,
        createdAt: at(opts.seq),
      },
    }),
  );
}

/**
 * 商家刚刚按下「Generate · N credits」之后的样子：卡还在，卡上挂着一个已经在排队的付费任务。
 *
 * 批准动作本身要有供应商才能跑，而这套 e2e 手上一把供应商钥匙都没有（`support/env.ts`），
 * 所以旅程种的是**按下去之后**那一刻的库状态，再去看画布该不该有东西 —— 走查 P0-1 里它没有。
 */
export async function seedApprovedPlanCard(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; kind?: "image" | "video"; prompt?: string },
): Promise<{ cardId: string; refId: string }> {
  const { cardId } = await seedPlanCard(ws, threadId, { seq: opts.seq, credits: 1, kind: opts.kind, prompt: opts.prompt });
  const refId = id("job");
  await runAsTenant(ws.orgId, () =>
    prisma.genJob.create({
      data: {
        id: refId,
        ownerId: ws.orgId,
        projectId: ws.projectId,
        prompt: opts.prompt ?? "A cup of kopi on a rattan table, warm morning light",
        kind: ((opts.kind ?? "image") === "video" ? "VIDEO" : "IMAGE") as never,
        model: "e2e-mock-image",
        status: "QUEUED" as never,
        spent: false,
        idempotencyKey: `cowork:${cardId}`,
        createdAt: at(opts.seq),
      },
    }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.updateMany({
      where: { id: cardId, ownerId: ws.orgId },
      data: { genJobId: refId },
    }),
  );
  return { cardId, refId };
}

/**
 * 一次**失败**过的生成留下的痕迹：卡 + 那条终局消息 + Otto 随后说的那句话。
 *
 * Codex QA-CRE-004（2026-09-04 只读审计 §4.2）复现步骤 ①：同一个画布先经历一次失败。
 * 三样东西都是产品自己写的形状 —— `appendCoworkResult` 写 TURN_ERROR（它自己那句给商家
 * 读的话就在 `text` 上），模型随后按 `packages/otto/src/instructions.ts` 的指令说一句
 * 「didn't go through」。旅程要证的是**这句话后来会不会赖着不走**，所以它必须真的在库里。
 */
export async function seedFailedGeneration(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; ottoSays: string },
): Promise<{ refId: string }> {
  const refId = id("job");
  await seedGenJob(ws, refId, "IMAGE", "FAILED", false);
  const { cardId } = await seedPlanCard(ws, threadId, { seq: opts.seq, credits: 1 });
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.updateMany({ where: { id: cardId, ownerId: ws.orgId }, data: { genJobId: refId } }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: id("err"),
        threadId,
        ownerId: ws.orgId,
        role: "AGENT" as never,
        kind: "TURN_ERROR" as never,
        seq: opts.seq + 1,
        text: "That one didn't come through — you weren't charged.",
        genJobId: refId,
        createdAt: at(opts.seq + 1),
      },
    }),
  );
  await seedAgentText(ws, threadId, { seq: opts.seq + 2, text: opts.ottoSays });
  return { refId };
}

/**
 * 一次**成功**的生成留下的痕迹：一件真的资产 + 那条 GEN_RESULT。
 *
 * Codex QA-CRE-004 复现步骤 ②：失败之后再完成一次成功的生成。产出与收费两个数字都写在
 * 产品自己写的地方 —— urls 由 `resolveCoworkResultUrls` 从 GenJob.generationIds 解析
 * （所以这里种的是真的 Generation + Asset 行，不是一段假 url），`costCredits` 是 worker
 * 写在 GEN_RESULT payload 上那个真的收费数。卡上那句「Made 1 video · 11 credits.」只能
 * 由它们拼出来，旅程才证得了「成功状态可理解」。
 */
export async function seedFinishedGeneration(
  ws: Workspace,
  threadId: string,
  opts: { seq: number; kind?: "image" | "video"; costCredits: number },
): Promise<{ refId: string }> {
  const kind = opts.kind ?? "video";
  const refId = id("job");
  const assetId = id("asset");
  const generationId = id("gen");
  await runAsTenant(ws.orgId, () =>
    prisma.asset.create({
      data: {
        id: assetId,
        ownerId: ws.orgId,
        // 64 hex —— `storage-key.ts` 的 HEX_64 是真的门，随便一段字符串会让整块画布打不开。
        contentHash: randomUUID().replace(/-/g, "").repeat(2),
        ext: kind === "video" ? "mp4" : "png",
        mime: kind === "video" ? "video/mp4" : "image/png",
        sizeBytes: BigInt(1024),
        source: "GENERATED" as never,
        createdAt: at(opts.seq),
      },
    }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.generation.create({
      data: {
        id: generationId,
        ownerId: ws.orgId,
        projectId: ws.projectId,
        assetId,
        source: "GENERATED" as never,
        entitySnapshot: { entities: [] },
        threadId,
        createdAt: at(opts.seq),
      },
    }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.genJob.create({
      data: {
        id: refId,
        ownerId: ws.orgId,
        projectId: ws.projectId,
        prompt: "Pan across the kopi set on a rattan table",
        kind: (kind === "video" ? "VIDEO" : "IMAGE") as never,
        model: kind === "video" ? "seedance-2-mini" : "seedream",
        status: "DONE" as never,
        spent: true,
        generationIds: [generationId],
        idempotencyKey: `cowork:${refId}`,
        createdAt: at(opts.seq),
      },
    }),
  );
  const { cardId } = await seedPlanCard(ws, threadId, {
    seq: opts.seq, credits: opts.costCredits, kind, prompt: "Pan across the kopi set on a rattan table",
  });
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.updateMany({ where: { id: cardId, ownerId: ws.orgId }, data: { genJobId: refId } }),
  );
  await runAsTenant(ws.orgId, () =>
    prisma.chatMessage.create({
      data: {
        id: id("res"),
        threadId,
        ownerId: ws.orgId,
        role: "AGENT" as never,
        kind: "GEN_RESULT" as never,
        seq: opts.seq + 1,
        text: "",
        payload: { kind, costCredits: opts.costCredits },
        genJobId: refId,
        createdAt: at(opts.seq + 1),
      },
    }),
  );
  return { refId };
}

/** The wallet as the database holds it — internal units, straight from the account row. */
export async function readAccount(ws: Workspace): Promise<{ balance: number; reserved: number }> {
  const account = await prisma.creditAccount.findUniqueOrThrow({
    where: { orgId: ws.orgId },
    select: { balance: true, reserved: true },
  });
  return account;
}

export async function countLedgerRows(ws: Workspace, refId: string): Promise<number> {
  return prisma.creditLedger.count({ where: { orgId: ws.orgId, refId } });
}
