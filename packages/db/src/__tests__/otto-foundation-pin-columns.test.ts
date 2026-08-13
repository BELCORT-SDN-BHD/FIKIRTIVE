/**
 * #879 step 1 — Otto foundation schema pinning (Founder-approved plan A, 2026-08-13).
 *
 * Five nullable columns (`surface`, `subjectRef`, `actorId`, `visibility`, `outletId`) pinned
 * onto ChatThread and ChatMessage NOW, before public sign-up makes backfilling every historical
 * row impossible. Semantics land in #879 step 2 — this round is pure shape, zero behavior
 * change: every column must be nullable (nothing writes them except the one otto/stream leg
 * this ticket adds) and every existing row must remain readable untouched.
 *
 * Runs against a real *_test Postgres after migrations are deployed (migration
 * 20260813075143_otto_foundation_879_pin_columns).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

const PIN_COLUMNS = ["surface", "subjectRef", "actorId", "visibility", "outletId"] as const;

async function columnIsNullable(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${table}
      AND column_name = ${column}
  `;
  expect(rows, `${table}.${column} does not exist`).toHaveLength(1);
  return rows[0]!.is_nullable === "YES";
}

describe("#879 step 1 — ChatThread/ChatMessage pin columns exist and are nullable", () => {
  for (const column of PIN_COLUMNS) {
    it(`ChatThread.${column} exists and is nullable`, async () => {
      expect(await columnIsNullable("ChatThread", column)).toBe(true);
    });
    it(`ChatMessage.${column} exists and is nullable`, async () => {
      expect(await columnIsNullable("ChatMessage", column)).toBe(true);
    });
  }
});

describe("#879 step 1 — writing through the pin columns changes nothing else", () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    orgId = `org_${randomUUID()}`;
    projectId = `proj_${randomUUID()}`;
    await seedOrg(orgId, 100_000);
    await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "pin columns" } });
  });

  it("a thread/message created without the pin columns leaves all five NULL", async () => {
    const threadId = `thread_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "Otto" } });
    const messageId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: { id: messageId, threadId, ownerId: orgId, role: "USER", kind: "TEXT", seq: 1, text: "hi" },
    });

    const thread = await prisma.chatThread.findFirstOrThrow({ where: { id: threadId, ownerId: orgId } });
    const message = await prisma.chatMessage.findFirstOrThrow({ where: { id: messageId, ownerId: orgId } });
    for (const column of PIN_COLUMNS) {
      expect(thread[column], `ChatThread.${column}`).toBeNull();
      expect(message[column], `ChatMessage.${column}`).toBeNull();
    }
  });

  it("a message explicitly given the position-only columns stores them, untouched by anything else", async () => {
    const threadId = `thread_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: orgId, projectId, title: "Otto" } });
    const messageId = `msg_${randomUUID()}`;
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        threadId,
        ownerId: orgId,
        role: "USER",
        kind: "TEXT",
        seq: 1,
        text: "hi",
        surface: "campaign",
        subjectRef: "campaign_123",
        outletId: "outlet_abc",
      },
    });

    const message = await prisma.chatMessage.findFirstOrThrow({ where: { id: messageId, ownerId: orgId } });
    expect(message.surface).toBe("campaign");
    expect(message.subjectRef).toBe("campaign_123");
    expect(message.outletId).toBe("outlet_abc");
    // Identity columns still NULL — nothing in this ticket ever writes them.
    expect(message.actorId).toBeNull();
    expect(message.visibility).toBeNull();
  });
});
