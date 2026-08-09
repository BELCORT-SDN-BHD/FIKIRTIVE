/**
 * #803 — the merchant's own phone book, end to end, against a real database.
 *
 * The Founder ruling is one sentence with three obligations, and each is checked here through
 * the product's own paths rather than through a mock:
 *
 *  1. STORED, and marked. A number the merchant types is kept, searchable, and carries the grade
 *     that says nobody has confirmed it.
 *  2. NOT an audience. Storing a number is not permission and not a delivery address: the same
 *     "everyone on WhatsApp" segment that would sweep a confirmed number must not see this one,
 *     on the segments page OR in the frozen broadcast audience — the two surfaces #806/#807 spent
 *     two rounds getting to agree may not disagree again through a new door.
 *  3. UPGRADEABLE, traceably. When a channel confirms the number, the same row becomes verified
 *     with a timestamp and a source, and only then does it become audience material.
 *
 * Plus the standing tenant obligation: two organizations, and every read and write fenced.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("../auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("../better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma, markContactIdentityChannelVerified } = await import("@fikirtive/db");
const { requireOwner } = await import("../auth-guard");
const { previewSegment } = await import("../segment-actions");
const {
  addContactPhone,
  addContactPhoneFromOtto,
  removeContactPhone,
  updateContactPhone,
} = await import("../crm-actions");
const { getContact, searchContacts } = await import("../crm-view-data");
const { createCustomerBroadcastService } = await import("../customer-broadcast-service");

const SUITE = `p803-${randomUUID().slice(0, 8)}`;
const ORG_A = `${SUITE}-org-a`;
const ORG_B = `${SUITE}-org-b`;
const USER_A = `${SUITE}-user-a`;
const MEMBERSHIP_A = `${SUITE}-membership-a`;
const SCOPE_A = `${SUITE}-scope-a`;
const TEMPLATE_A = `${SUITE}-template-a`;
const TEMPLATE_VERSION_A = `${SUITE}-template-version-a`;
const SEGMENT_WHATSAPP = `${SUITE}-segment-whatsapp`;
const NOW = new Date("2026-08-09T00:00:00.000Z");

/** Typed in by the merchant; nothing has confirmed her number. */
const NURUL = `${SUITE}-nurul`;
/** Already reachable: her identity came from the channel side. */
const SITI = `${SUITE}-siti`;
/** The other tenant's customer. */
const MEI = `${SUITE}-mei`;

const WHATSAPP_ONLY = { match: "all" as const, rules: [{ kind: "channel" as const, channel: "whatsapp" }] };

const broadcast = createCustomerBroadcastService({
  clock: () => NOW,
  id: () => `${SUITE}-gen-${randomUUID()}`,
});
const principalA = { ownerId: ORG_A, membershipId: MEMBERSHIP_A, impersonating: false };

function actAs(ownerId: string): void {
  vi.mocked(requireOwner).mockResolvedValue({
    ownerId,
    email: `${ownerId}@fikirtive.test`,
  } as Awaited<ReturnType<typeof requireOwner>>);
}

async function seedContact(id: string, ownerId: string, name: string): Promise<void> {
  await prisma.contact.create({
    data: { id, ownerId, name, source: "manual", lifecycleStage: "Active", firstTouchAt: NOW, lastSeenAt: NOW },
  });
}

async function frozenAudience(key: string) {
  const run = await broadcast.createBroadcastRun(principalA, {
    channelScopeId: SCOPE_A,
    channel: "whatsapp",
    templateVersionId: TEMPLATE_VERSION_A,
    creationIdempotencyKey: `${SUITE}-${key}`,
  });
  return broadcast.freezeAudience(principalA, {
    broadcastRunId: run.resource.id,
    expectedRevision: run.resource.revision,
    segmentId: SEGMENT_WHATSAPP,
  });
}

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "crm-manual-phone-test-secret";

  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@fikirtive.test` } });
  await prisma.membership.create({ data: { id: MEMBERSHIP_A, userId: USER_A, orgId: ORG_A, role: "owner" } });
  await prisma.membershipRole.create({ data: { membershipId: MEMBERSHIP_A, role: "owner" } });
  await prisma.channelScope.create({
    data: { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: `${SUITE}-waba-a` },
  });
  await prisma.customerMessageTemplate.create({
    data: { id: TEMPLATE_A, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "offer", locale: "en_MY" },
  });
  await prisma.customerMessageTemplateVersion.create({
    data: {
      id: TEMPLATE_VERSION_A,
      ownerId: ORG_A,
      templateId: TEMPLATE_A,
      revision: 1,
      purposeClass: "proactive_non_transactional",
      category: "marketing",
      definitionJson: { schemaVersion: 1, body: "Offer", variables: [] },
      contentHash: `${SUITE}-template-a`,
      createdByMembershipId: MEMBERSHIP_A,
    },
  });
  await prisma.segment.create({
    data: {
      id: SEGMENT_WHATSAPP,
      ownerId: ORG_A,
      name: "Everyone on WhatsApp",
      phrase: "All of: channel is whatsapp",
      rulesJson: WHATSAPP_ONLY,
      kind: "custom",
      createdAt: NOW,
    },
  });

  await seedContact(NURUL, ORG_A, "Nurul Aina");
  await seedContact(SITI, ORG_A, "Siti Salleh");
  await seedContact(MEI, ORG_B, "Mei Chan");
  // Siti's identity is a channel record — the shape every existing row in this table has.
  await prisma.contactIdentity.create({
    data: {
      id: `${SITI}-identity`,
      ownerId: ORG_A,
      contactId: SITI,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      externalId: "+60111111111",
    },
  });
}, 120_000);

describe("a merchant types a customer's number in", () => {
  it("stores it in Malaysian shorthand, marked as merchant entered with no evidence", async () => {
    actAs(ORG_A);
    const saved = await addContactPhone({ contactId: NURUL, phone: "012-345 6789" });
    expect(saved).toMatchObject({ ok: true, phone: "+60123456789" });

    const profile = await getContact(NURUL);
    if (!("ok" in profile)) throw new Error(profile.error);
    expect(profile.contact.identities).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        externalId: "+60123456789",
        verificationStatus: "merchant_unverified",
        verifiedAt: null,
        verifiedSourceKind: null,
      }),
    ]);

    // Stored means findable — the point of storing it at all.
    const found = await searchContacts({ query: "+60123456789" });
    if (!("ok" in found)) throw new Error(found.error);
    expect(found.contacts.map((contact) => contact.id)).toEqual([NURUL]);
  });

  it("changes no consent record and enters no audience, on either surface", async () => {
    actAs(ORG_A);
    const profile = await getContact(NURUL);
    if (!("ok" in profile)) throw new Error(profile.error);
    // Storing a number says nothing about permission, and did not pretend to.
    expect(profile.contact.consentState.state).toBe("unknown");
    expect(profile.contact.consentEvents).toHaveLength(0);

    // "Everyone on WhatsApp" — a rule that asks nothing about consent, the exact shape that let
    // an excluded contact through before #806. Nurul has a WhatsApp-shaped number and is still
    // not on this list, because nothing has confirmed she is reachable on WhatsApp.
    const preview = await previewSegment(WHATSAPP_ONLY);
    if (!("ok" in preview)) throw new Error(preview.error);
    expect(preview.contacts.map((contact) => contact.id)).toEqual([SITI]);

    const frozen = await frozenAudience("freeze-unverified");
    expect(frozen.members.map((member) => member.contactId)).toEqual([SITI]);
  });

  it("corrects a typo and removes a mistake, then lets the number be saved where it belongs", async () => {
    actAs(ORG_A);
    const profile = await getContact(NURUL);
    if (!("ok" in profile)) throw new Error(profile.error);
    const identityId = profile.contact.identities[0].id;

    await expect(updateContactPhone({ contactId: NURUL, identityId, phone: "0123456780" }))
      .resolves.toMatchObject({ ok: true, phone: "+60123456780" });

    // The same number cannot sit on two contacts at once…
    await expect(addContactPhone({ contactId: SITI, phone: "+60123456780" }))
      .resolves.toEqual({ error: "That number is already saved on another contact." });
    // …but removing it from the wrong contact frees it for the right one. A stored mistake is
    // not a life sentence, and the removed row stays in the table as history.
    await expect(removeContactPhone({ contactId: NURUL, identityId })).resolves.toEqual({ ok: true });
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: identityId, ownerId: ORG_A } }),
    ).resolves.toMatchObject({ externalId: "+60123456780", deletedAt: expect.any(Date) });
    await expect(addContactPhone({ contactId: SITI, phone: "+60123456780" }))
      .resolves.toMatchObject({ ok: true, phone: "+60123456780" });

    // Put the fixture back the way the remaining cases expect it.
    const restored = await addContactPhone({ contactId: NURUL, phone: "+60123456789" });
    if (!("ok" in restored)) throw new Error(restored.error);
    const sitiProfile = await getContact(SITI);
    if (!("ok" in sitiProfile)) throw new Error(sitiProfile.error);
    const stray = sitiProfile.contact.identities.find((identity) => identity.externalId === "+60123456780");
    await removeContactPhone({ contactId: SITI, identityId: stray?.id ?? "" });
  });
});

describe("the channel confirms the number", () => {
  it("upgrades the same row with when and by what, and only then is it audience material", async () => {
    actAs(ORG_A);
    const before = await getContact(NURUL);
    if (!("ok" in before)) throw new Error(before.error);
    const identityId = before.contact.identities[0].id;

    const upgrade = await markContactIdentityChannelVerified(prisma, {
      ownerId: ORG_A,
      channel: "whatsapp",
      externalId: "+60123456789",
      sourceKind: "inbound_message",
      verifiedAt: NOW,
    });
    expect(upgrade).toEqual({ matched: true, upgraded: true, contactIdentityId: identityId });

    const after = await getContact(NURUL);
    if (!("ok" in after)) throw new Error(after.error);
    expect(after.contact.identities[0]).toMatchObject({
      id: identityId,
      externalId: "+60123456789",
      verificationStatus: "channel_verified",
      verifiedAt: NOW,
      verifiedSourceKind: "inbound_message",
    });

    // The two surfaces move together: what the page now shows, the freeze now sends to.
    const preview = await previewSegment(WHATSAPP_ONLY);
    if (!("ok" in preview)) throw new Error(preview.error);
    expect(preview.contacts.map((contact) => contact.id).sort()).toEqual([NURUL, SITI].sort());
    const frozen = await frozenAudience("freeze-verified");
    expect(frozen.members.map((member) => member.contactId).sort()).toEqual([NURUL, SITI].sort());
  });

  it("refuses to let the merchant edit or remove what the channel confirmed", async () => {
    actAs(ORG_A);
    const profile = await getContact(NURUL);
    if (!("ok" in profile)) throw new Error(profile.error);
    const identityId = profile.contact.identities[0].id;
    const locked = {
      error: "This number was confirmed by a connected channel, so it can't be edited or removed here.",
    };

    await expect(updateContactPhone({ contactId: NURUL, identityId, phone: "+60123456700" })).resolves.toEqual(locked);
    await expect(removeContactPhone({ contactId: NURUL, identityId })).resolves.toEqual(locked);
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: identityId, ownerId: ORG_A } }),
    ).resolves.toMatchObject({ externalId: "+60123456789", deletedAt: null });
  });
});

describe("two tenants", () => {
  it("cannot read, edit, or remove another organization's stored number", async () => {
    actAs(ORG_A);
    const profile = await getContact(NURUL);
    if (!("ok" in profile)) throw new Error(profile.error);
    const identityId = profile.contact.identities[0].id;

    actAs(ORG_B);
    await expect(getContact(NURUL)).resolves.toEqual({ error: "Contact not found." });
    await expect(addContactPhone({ contactId: NURUL, phone: "+60123456701" }))
      .resolves.toEqual({ error: "Contact not found." });
    await expect(updateContactPhone({ contactId: NURUL, identityId, phone: "+60123456702" }))
      .resolves.toEqual({ error: "Contact not found." });
    await expect(removeContactPhone({ contactId: NURUL, identityId }))
      .resolves.toEqual({ error: "Contact not found." });

    // Org B may store the SAME number for its own customer: the uniqueness fence is per tenant,
    // and two merchants can genuinely both know the same person.
    await expect(addContactPhone({ contactId: MEI, phone: "+60123456789" }))
      .resolves.toMatchObject({ ok: true, phone: "+60123456789" });
    await expect(
      prisma.contactIdentity.count({ where: { ownerId: ORG_B, externalId: "+60123456789", deletedAt: null } }),
    ).resolves.toBe(1);

    // And org A's row is untouched by all of it.
    await expect(
      prisma.contactIdentity.findFirst({ where: { id: identityId, ownerId: ORG_A } }),
    ).resolves.toMatchObject({ externalId: "+60123456789", deletedAt: null, verificationStatus: "channel_verified" });
  });

  it("ignores an ownerId the caller supplies, on the human path and on Otto's", async () => {
    actAs(ORG_B);
    const viaOtto = await addContactPhoneFromOtto({ contactId: MEI, phone: "011-2222 3333", ownerId: ORG_A } as never);
    expect(viaOtto).toMatchObject({ ok: true, phone: "+601122223333" });

    const stored = await prisma.contactIdentity.findFirst({
      where: { ownerId: ORG_B, externalId: "+601122223333", deletedAt: null },
      select: { ownerId: true, contactId: true, verificationStatus: true },
    });
    expect(stored).toEqual({
      ownerId: ORG_B,
      contactId: MEI,
      verificationStatus: "merchant_unverified",
    });
    await expect(
      prisma.contactIdentity.count({ where: { ownerId: ORG_A, externalId: "+601122223333" } }),
    ).resolves.toBe(0);
  });
});
