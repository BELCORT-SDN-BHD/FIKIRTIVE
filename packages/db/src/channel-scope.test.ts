/**
 * R-010 D9 M1 — ChannelScope additive identity-base contract.
 *
 * This slice adds the lifecycle-free scope carrier and nullable, tenant/channel-qualified
 * references only. The active four-fact ContactIdentity unique stays deliberately absent until
 * verified backfill and atomic reader/writer cutover (R-010 §7 M1); legacy behavior is unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";

const ORG_A = "scope-org-a";
const ORG_B = "scope-org-b";
const NOW = new Date("2026-07-19T00:00:00.000Z");

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.contact.create({
    data: {
      id: "scope-contact-a",
      ownerId: ORG_A,
      name: "Aisyah",
      source: "whatsapp",
      firstTouchAt: NOW,
      lastSeenAt: NOW,
    },
  });
});

describe("ChannelScope tenant authority", () => {
  it("is tenant-guarded", async () => {
    await expect(prisma.channelScope.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(
      prisma.channelScope.findMany({ where: { ownerId: ORG_B } }),
    ).resolves.toHaveLength(0);
  });

  it("uniquely identifies owner + channel + canonical scopeKey", async () => {
    const data = { ownerId: ORG_A, channel: "whatsapp", scopeKey: "business-1" };
    await prisma.channelScope.create({ data: { id: "scope-1", ...data } });

    await expect(
      prisma.channelScope.create({ data: { id: "scope-duplicate", ...data } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.channelScope.create({
        data: { id: "scope-other-channel", ...data, channel: "instagram" },
      }),
    ).resolves.toMatchObject({ id: "scope-other-channel" });
    await expect(
      prisma.channelScope.create({
        data: { id: "scope-other-owner", ...data, ownerId: ORG_B },
      }),
    ).resolves.toMatchObject({ id: "scope-other-owner" });
  });

  it("allows legacy null references but rejects cross-owner or cross-channel references", async () => {
    await prisma.channelScope.create({
      data: { id: "scope-wa-a", ownerId: ORG_A, channel: "whatsapp", scopeKey: "business-1" },
    });

    await expect(
      prisma.contactIdentity.create({
        data: {
          id: "identity-legacy",
          ownerId: ORG_A,
          contactId: "scope-contact-a",
          channel: "whatsapp",
          externalId: "+60111111111",
        },
      }),
    ).resolves.toMatchObject({ channelScopeId: null });
    await expect(
      prisma.contactIdentity.create({
        data: {
          id: "identity-scoped",
          ownerId: ORG_A,
          contactId: "scope-contact-a",
          channelScopeId: "scope-wa-a",
          channel: "whatsapp",
          externalId: "+60222222222",
        },
      }),
    ).resolves.toMatchObject({ channelScopeId: "scope-wa-a" });
    await expect(
      prisma.channelConnection.create({
        data: {
          id: "connection-scoped",
          ownerId: ORG_A,
          kind: "whatsapp",
          channelScopeId: "scope-wa-a",
          accessTokenEnc: "ciphertext",
        },
      }),
    ).resolves.toMatchObject({ channelScopeId: "scope-wa-a" });
    await expect(
      prisma.contactIdentity.create({
        data: {
          id: "identity-wrong-channel",
          ownerId: ORG_A,
          contactId: "scope-contact-a",
          channelScopeId: "scope-wa-a",
          channel: "instagram",
          externalId: "ig-user-1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.channelConnection.create({
        data: {
          id: "connection-wrong-owner",
          ownerId: ORG_B,
          kind: "whatsapp",
          channelScopeId: "scope-wa-a",
          accessTokenEnc: "ciphertext",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("does not enable the active four-fact unique before backfill and cutover", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'ContactIdentity'
    `;

    expect(
      indexes.some(
        ({ indexdef }) => indexdef.includes("UNIQUE") && indexdef.includes('"channelScopeId"'),
      ),
    ).toBe(false);
  });
});
