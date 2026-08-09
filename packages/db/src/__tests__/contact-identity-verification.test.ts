/**
 * #803 — the database's own account of the two credibility grades.
 *
 * The product rule ("a number the merchant typed is not a number a channel confirmed") is only
 * as strong as the row it is written on. These run against a real *_test Postgres after the
 * migrations deploy, so they check the CONSTRAINT, not a convention: a writer that forgets the
 * evidence, or invents a third grade, is refused by the database rather than by a code review.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../index.js";
import { markContactIdentityChannelVerified, ContactIdentityError } from "../contact-identity.js";

const ORG_A = "identity-grade-org-a";
const ORG_B = "identity-grade-org-b";
const NOW = new Date("2026-08-09T00:00:00.000Z");

async function seedContact(id: string, ownerId: string): Promise<void> {
  await prisma.contact.create({
    data: { id, ownerId, name: id, source: "manual", firstTouchAt: NOW, lastSeenAt: NOW },
  });
}

function identityData(id: string, ownerId: string, contactId: string, externalId: string) {
  return {
    id,
    ownerId,
    contactId,
    channel: "whatsapp",
    externalId,
    verificationStatus: "merchant_unverified",
    verifiedAt: null,
    verifiedSourceKind: null,
  };
}

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await seedContact("grade-contact-a", ORG_A);
  await seedContact("grade-contact-b", ORG_B);
});

describe("ContactIdentity credibility grade", () => {
  it("refuses a grade outside the closed set", async () => {
    await expect(
      prisma.contactIdentity.create({
        data: {
          ...identityData("grade-1", ORG_A, "grade-contact-a", "+60123456701"),
          verificationStatus: "kind_of_verified",
        },
      }),
    ).rejects.toThrow(/ContactIdentity_verification_status_check/);
  });

  it("refuses a verified identity that cannot say when or by what", async () => {
    await expect(
      prisma.contactIdentity.create({
        data: {
          ...identityData("grade-2", ORG_A, "grade-contact-a", "+60123456702"),
          verificationStatus: "channel_verified",
        },
      }),
    ).rejects.toThrow(/ContactIdentity_verification_evidence_check/);
  });

  it("refuses a merchant-entered identity that carries verification evidence", async () => {
    await expect(
      prisma.contactIdentity.create({
        data: {
          ...identityData("grade-3", ORG_A, "grade-contact-a", "+60123456703"),
          verifiedAt: NOW,
          verifiedSourceKind: "inbound_message",
        },
      }),
    ).rejects.toThrow(/ContactIdentity_verification_evidence_check/);
  });

  it("stores a merchant-entered identity with no evidence at all", async () => {
    const row = await prisma.contactIdentity.create({
      data: identityData("grade-4", ORG_A, "grade-contact-a", "+60123456704"),
    });
    expect(row).toMatchObject({
      verificationStatus: "merchant_unverified",
      verifiedAt: null,
      verifiedSourceKind: null,
    });
  });
});

describe("markContactIdentityChannelVerified", () => {
  it("upgrades a merchant-entered number and records when and by what", async () => {
    await prisma.contactIdentity.create({
      data: identityData("grade-5", ORG_A, "grade-contact-a", "+60123456705"),
    });

    const result = await markContactIdentityChannelVerified(prisma, {
      ownerId: ORG_A,
      channel: "whatsapp",
      externalId: "+60123456705",
      sourceKind: "inbound_message",
      verifiedAt: NOW,
    });

    expect(result).toEqual({ matched: true, upgraded: true, contactIdentityId: "grade-5" });
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: "grade-5", ownerId: ORG_A } }),
    ).resolves.toMatchObject({
      verificationStatus: "channel_verified",
      verifiedAt: NOW,
      verifiedSourceKind: "inbound_message",
    });
  });

  it("keeps the FIRST confirmation when the same number is confirmed again", async () => {
    await prisma.contactIdentity.create({
      data: identityData("grade-6", ORG_A, "grade-contact-a", "+60123456706"),
    });
    await markContactIdentityChannelVerified(prisma, {
      ownerId: ORG_A,
      channel: "whatsapp",
      externalId: "+60123456706",
      sourceKind: "inbound_message",
      verifiedAt: NOW,
    });

    const again = await markContactIdentityChannelVerified(prisma, {
      ownerId: ORG_A,
      channel: "whatsapp",
      externalId: "+60123456706",
      sourceKind: "delivery_receipt",
      verifiedAt: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(again).toEqual({ matched: true, upgraded: false, contactIdentityId: "grade-6" });
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: "grade-6", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ verifiedAt: NOW, verifiedSourceKind: "inbound_message" });
  });

  it("cannot reach another tenant's identity, and invents none of its own", async () => {
    await prisma.contactIdentity.create({
      data: identityData("grade-7", ORG_A, "grade-contact-a", "+60123456707"),
    });

    await expect(
      markContactIdentityChannelVerified(prisma, {
        ownerId: ORG_B,
        channel: "whatsapp",
        externalId: "+60123456707",
        sourceKind: "inbound_message",
      }),
    ).resolves.toEqual({ matched: false, upgraded: false, contactIdentityId: null });
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: "grade-7", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ verificationStatus: "merchant_unverified" });

    // A number nobody stored stays unstored: confirmation is not a create path.
    await expect(
      markContactIdentityChannelVerified(prisma, {
        ownerId: ORG_A,
        channel: "whatsapp",
        externalId: "+60123456799",
        sourceKind: "inbound_message",
      }),
    ).resolves.toEqual({ matched: false, upgraded: false, contactIdentityId: null });
    await expect(
      prisma.contactIdentity.count({ where: { ownerId: ORG_A, externalId: "+60123456799" } }),
    ).resolves.toBe(0);
  });

  it("refuses an evidence token outside the closed shape", async () => {
    await expect(
      markContactIdentityChannelVerified(prisma, {
        ownerId: ORG_A,
        channel: "whatsapp",
        externalId: "+60123456708",
        sourceKind: "Inbound Message",
      }),
    ).rejects.toThrow(ContactIdentityError);
  });
});
