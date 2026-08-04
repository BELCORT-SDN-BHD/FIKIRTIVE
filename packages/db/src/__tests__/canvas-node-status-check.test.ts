/**
 * #602 T3 — the card status column is a FINITE SET, and the database is what says so.
 *
 * Everything else in this ticket is a rule that lives in TypeScript: a derivation, a set of
 * writers, a validated action. All of it is true only for as long as every future writer keeps
 * agreeing with it, and the writer that motivated this constraint is the one that did not — a
 * server action that passed the browser's status string to the column unread, for as long as it
 * has existed. So the vocabulary is written down where a writer cannot argue with it.
 *
 * Two things are asserted against a real database: every word the writers legitimately produce is
 * accepted, and a word from outside the set is refused. The second is the whole point — before
 * this migration it was accepted, and a row carrying a word no renderer knows renders as an
 * eternal spinner (F21).
 *
 * Zero money: only Organization / Project / CanvasNode rows are touched here.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

/** The set the constraint enforces — kept here as literals on purpose. Importing it from the same
 *  module the production code uses would make this test agree with itself; spelling it out means
 *  a change to either side has to be made twice, deliberately. */
const ROW_STATUSES = [
  "pending",
  "done",
  "failed",
  "cancelled",
  "timeout",
  "missing",
  "deleted",
  "unknown",
] as const;

let orgId: string;
let projectId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  projectId = `proj_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "state algebra" } });
});

async function insertCard(status: string): Promise<void> {
  await prisma.canvasNode.create({
    data: {
      id: `node_${randomUUID()}`,
      ownerId: orgId,
      projectId,
      type: "image",
      x: 0, y: 0, w: 320, h: 320,
      status,
    },
  });
}

describe("what a canvas card row is allowed to say", () => {
  it.each(ROW_STATUSES)("stores %s — every word a writer legitimately produces", async (status) => {
    await expect(insertCard(status)).resolves.toBeUndefined();
    const row = await prisma.canvasNode.findFirst({ where: { ownerId: orgId, projectId }, select: { status: true } });
    expect(row?.status).toBe(status);
  });

  it.each([
    // The shape that started this: the create action's unvalidated client string.
    ["generating"],
    ["GENERATING"],
    ["queued"],
    ["ready"],
    [""],
  ])("refuses %s — a word outside the set cannot reach the column", async (status) => {
    await expect(insertCard(status)).rejects.toThrow();
    expect(await prisma.canvasNode.count({ where: { ownerId: orgId, projectId } })).toBe(0);
  });

  it("refuses an out-of-set word on an UPDATE too, not only on insert", async () => {
    await insertCard("pending");
    const card = await prisma.canvasNode.findFirstOrThrow({ where: { ownerId: orgId, projectId }, select: { id: true } });

    await expect(
      prisma.canvasNode.updateMany({ where: { id: card.id, ownerId: orgId }, data: { status: "generating" } }),
    ).rejects.toThrow();

    const after = await prisma.canvasNode.findFirstOrThrow({
      where: { id: card.id, ownerId: orgId },
      select: { status: true },
    });
    expect(after.status).toBe("pending");
  });

  it("names the constraint the migration created, so a silent drop is visible here", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
       WHERE conrelid = '"CanvasNode"'::regclass AND contype = 'c'`;
    expect(rows.map((row) => row.conname)).toContain("CanvasNode_status_check");
  });
});
