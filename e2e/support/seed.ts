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
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma, runAsTenant, INTERNAL_PER_DISPLAY } from "./db.js";
import { freshPng } from "./upload-fixture.js";

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

/**
 * One piece of media already sitting in this merchant's Library — the rows AND the bytes.
 *
 * Two things have to line up or the Library will honestly refuse to draw the tile: the
 * `Asset` + `Generation` rows, and a real object under the local-disk storage key the read
 * model checks with `storage.exists()`. So this writes both, using the product's own key
 * scheme (`u/<ownerId>/<sha256>.<ext>`) and a genuinely fresh PNG per call.
 *
 * `source` is what splits the Library's two grids: `UPLOAD` is the merchant's own file
 * (Uploads tab), anything else is something we made for them (Generation history).
 * A journey that is ABOUT favouriting or collecting starts from media that already exists —
 * making the media is journey 13's subject, not this one's.
 */
export async function seedLibraryMedia(
  ws: Workspace,
  opts: { prompt: string; source?: "GENERATED" | "UPLOAD"; filename?: string },
): Promise<{ generationId: string; assetId: string }> {
  const bytes = freshPng();
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  // apps/web resolves its local storage root as <repo>/.data/storage (see apps/web/lib/storage.ts).
  const file = path.resolve(
    import.meta.dirname,
    "../../.data/storage",
    `u/${ws.orgId}/${contentHash}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);

  const assetId = id("asset");
  const generationId = id("gen");
  const source = opts.source ?? "GENERATED";
  await runAsTenant(ws.orgId, async () => {
    await prisma.asset.create({
      data: {
        id: assetId,
        ownerId: ws.orgId,
        contentHash,
        ext: "png",
        mime: "image/png",
        sizeBytes: BigInt(bytes.byteLength),
        originalFilename: opts.filename ?? "",
        source: source as never,
        width: 1,
        height: 1,
        createdAt: ws.next(),
      },
    });
    await prisma.generation.create({
      data: {
        id: generationId,
        ownerId: ws.orgId,
        projectId: ws.projectId,
        assetId,
        source: source as never,
        promptText: opts.prompt,
        entitySnapshot: {},
        createdAt: ws.next(),
      },
    });
  });
  return { generationId, assetId };
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
