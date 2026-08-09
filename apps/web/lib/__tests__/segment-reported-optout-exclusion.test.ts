/**
 * #758 — the merchant's optional "also exclude the opt-outs I recorded myself".
 *
 * #496 option B (Founder) says a merchant's own record discloses and does not suppress, and #750
 * shipped that: the segments page names those contacts and keeps them in the list. This ticket is
 * the Founder's follow-up ruling — the merchant may now ASK for the stricter reading, per segment,
 * off unless he turns it on.
 *
 * Real-database behaviour test through the real product paths: the segments page (previewSegment
 * + the rendered preview) and the broadcast workbench (freezeAudience + its rendered note), on the
 * same segment, for two tenants.
 *
 * What it holds:
 *  - default unchanged — a segment nobody tightened selects exactly whom it selected before;
 *  - on, the list difference is exactly the contacts the merchant recorded himself;
 *  - the count, the preview rows and the frozen audience say the same thing (#750);
 *  - the option only ever subtracts: a customer the consent record holds out never returns, in
 *    any rule shape, including a segment deliberately built out of opt-outs;
 *  - the merchant's choice is counted apart from what the consent ledger decided, and one contact
 *    is never reported under both (#768: say what is provable, and say whose record it is);
 *  - each tenant's own records decide its own segments and nobody else's.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("../better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma, recordConsentEvent } = await import("@fikirtive/db");
const { requireOwner } = await import("../auth-guard");
const { buildSegment, listSegments, previewSegment } = await import("../segment-actions");
const { readContactConsentTruth } = await import("../consent-authority");
const { setContactConsent, importContacts } = await import("../crm-actions");
const { createCustomerBroadcastService } = await import("../customer-broadcast-service");
const segmentsModule = await import("@/components/crm/segments-page");
const SegmentsPage = segmentsModule.default;
const { ContactPreview } = segmentsModule;
const { ConsentExclusionNote } = await import("@/components/crm/broadcasts/broadcast-detail-page");

const SUITE = `p758-${randomUUID().slice(0, 8)}`;
const ORG_A = `${SUITE}-org-a`;
const ORG_B = `${SUITE}-org-b`;
const USER_A = `${SUITE}-user-a`;
const USER_B = `${SUITE}-user-b`;
const MEMBERSHIP_A = `${SUITE}-membership-a`;
const MEMBERSHIP_B = `${SUITE}-membership-b`;
const SCOPE_A = `${SUITE}-scope-a`;
const CONNECTION_A = `${SUITE}-connection-a`;
const TEMPLATE_A = `${SUITE}-template-a`;
const TEMPLATE_VERSION_A = `${SUITE}-template-version-a`;
/** r2 — a second channel on the same tenant. The merchant's record was written in one scope. */
const SCOPE_EMAIL = `${SUITE}-scope-email`;
const TEMPLATE_EMAIL = `${SUITE}-template-email`;
const TEMPLATE_VERSION_EMAIL = `${SUITE}-template-version-email`;
const SEGMENT_KEPT = `${SUITE}-segment-kept`;
const SEGMENT_STRICT = `${SUITE}-segment-strict`;
const NOW = new Date("2026-08-09T00:00:00.000Z");

/** Tenant A. Names, not ids, so a failure names a person. */
const AMIRA = `${SUITE}-amira`; // no consent record at all
const BAKRI = `${SUITE}-bakri`; // the merchant recorded an opt-out on his profile
const CHONG = `${SUITE}-chong`; // opted out himself through the unsubscribe link (verified)
const DINA = `${SUITE}-dina`; // pre-ledger opt_out column, AND the merchant recorded it again
const EVELYN = `${SUITE}-evelyn`; // opted in herself, THEN the merchant recorded an opt-out
/** Tenant B. */
const MEI = `${SUITE}-mei`; // the merchant recorded an opt-out
const NOOR = `${SUITE}-noor`; // no consent record at all

/** Imported from a CSV row declaring consent=opt_out; the import creates no identity. */
let faiz = "";

/**
 * r2 判官 P1-2 — claims this screen may not make, in the shape #768 established.
 *
 * Every clause on a consent surface may say only what the ledger can prove. r1's note promised
 * that a customer who opted out through their own channel is "out either way" — and a merchant
 * is allowed to build a segment on "known opt-out", where that customer is selected on purpose
 * (this file's own OPTED_OUT_ONLY example pins it). A sentence that is false on a legal segment
 * is not a small overstatement on a consent screen: it tells the merchant not to check.
 *
 * The needles ban the CLAIM, not one phrasing of it, so the promise cannot return by rewording.
 */
const REJECTED_CLAIMS = [
  "out either way",
  "are always excluded",
  "never receive",
  "will never be",
  "can never be selected",
  "no matter what",
  "regardless of",
] as const;

const TOTAL_CONTACTS_A = 6;
/** Only these two are opt-outs the CUSTOMER's own evidence (or the pre-ledger fence) decides. */
const KNOWN_OPT_OUTS_A = [CHONG, DINA];

const CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};
/** The same segment, tightened. This is the whole feature: one optional field on the rule group. */
const CONTACTABLE_STRICT = { ...CONTACTABLE, excludeReportedOptOut: true as const };
/** A segment that never mentions consent — the shape #806 had to close, tightened here too. */
const WHATSAPP_ONLY = {
  match: "all" as const,
  rules: [{ kind: "channel" as const, channel: "whatsapp" }],
};
const WHATSAPP_ONLY_STRICT = { ...WHATSAPP_ONLY, excludeReportedOptOut: true as const };
/** A merchant may deliberately go looking for the people who opted out. Still legal, still works. */
const OPTED_OUT_ONLY = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "not_contactable" as const }],
};
const OPTED_OUT_ONLY_STRICT = { ...OPTED_OUT_ONLY, excludeReportedOptOut: true as const };

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

async function seedContact(
  id: string,
  ownerId: string,
  name: string,
  marketingConsent?: string,
): Promise<void> {
  await prisma.contact.create({
    data: {
      id,
      ownerId,
      name,
      source: "manual",
      lifecycleStage: "Active",
      firstTouchAt: NOW,
      lastSeenAt: NOW,
      ...(marketingConsent ? { marketingConsent } : {}),
    },
  });
}

async function seedIdentity(
  contactId: string,
  ownerId: string,
  externalId: string,
  channelScopeId?: string,
): Promise<void> {
  await prisma.contactIdentity.create({
    data: {
      id: `${contactId}-identity`,
      ownerId,
      contactId,
      channel: "whatsapp",
      externalId,
      ...(channelScopeId ? { channelScopeId } : {}),
    },
  });
}

async function previewOrThrow(rules: unknown) {
  const result = await previewSegment(rules);
  if (!("ok" in result)) throw new Error(result.error);
  return result;
}

async function freezeOnce(key: string, segmentId: string) {
  const run = await broadcast.createBroadcastRun(principalA, {
    channelScopeId: SCOPE_A,
    channel: "whatsapp",
    templateVersionId: TEMPLATE_VERSION_A,
    creationIdempotencyKey: `${SUITE}-${key}`,
  });
  return broadcast.freezeAudience(principalA, {
    broadcastRunId: run.resource.id,
    expectedRevision: run.resource.revision,
    segmentId,
  });
}

/** r2 — the same segment, sent from a channel the merchant never recorded consent in. */
async function freezeEmailOnce(key: string, segmentId: string) {
  const run = await broadcast.createBroadcastRun(principalA, {
    channelScopeId: SCOPE_EMAIL,
    channel: "email",
    templateVersionId: TEMPLATE_VERSION_EMAIL,
    creationIdempotencyKey: `${SUITE}-${key}`,
  });
  return broadcast.freezeAudience(principalA, {
    broadcastRunId: run.resource.id,
    expectedRevision: run.resource.revision,
    segmentId,
  });
}

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "segment-reported-optout-exclusion-test-secret";

  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_A, email: `${USER_A}@fikirtive.test` },
      { id: USER_B, email: `${USER_B}@fikirtive.test` },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: MEMBERSHIP_A, userId: USER_A, orgId: ORG_A, role: "owner" },
      { id: MEMBERSHIP_B, userId: USER_B, orgId: ORG_B, role: "owner" },
    ],
  });
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: MEMBERSHIP_A, role: "owner" },
      { membershipId: MEMBERSHIP_B, role: "owner" },
    ],
  });
  await prisma.channelScope.create({
    data: { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: `${SUITE}-waba-a` },
  });
  await prisma.channelConnection.create({
    data: {
      id: CONNECTION_A,
      ownerId: ORG_A,
      kind: "whatsapp",
      channelScopeId: SCOPE_A,
      externalId: CONNECTION_A,
      accessTokenEnc: `ciphertext:${CONNECTION_A}`,
      status: "active",
    },
  });
  await prisma.customerMessageTemplate.create({
    data: {
      id: TEMPLATE_A,
      ownerId: ORG_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      name: "offer",
      locale: "en_MY",
    },
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
  // r2 — the same tenant also sends marketing from a second channel. Nothing about the merchant's
  // consent records is channel-specific: both merchant surfaces write one fixed scope.
  await prisma.channelScope.create({
    data: { id: SCOPE_EMAIL, ownerId: ORG_A, channel: "email", scopeKey: `${SUITE}-email-a` },
  });
  await prisma.customerMessageTemplate.create({
    data: {
      id: TEMPLATE_EMAIL,
      ownerId: ORG_A,
      channelScopeId: SCOPE_EMAIL,
      channel: "email",
      name: "offer-email",
      locale: "en_MY",
    },
  });
  await prisma.customerMessageTemplateVersion.create({
    data: {
      id: TEMPLATE_VERSION_EMAIL,
      ownerId: ORG_A,
      templateId: TEMPLATE_EMAIL,
      revision: 1,
      purposeClass: "proactive_non_transactional",
      category: "marketing",
      definitionJson: { schemaVersion: 1, body: "Offer", variables: [] },
      contentHash: `${SUITE}-template-email`,
      createdByMembershipId: MEMBERSHIP_A,
    },
  });

  await seedContact(AMIRA, ORG_A, "Amira Salleh");
  await seedContact(BAKRI, ORG_A, "Bakri Idris");
  await seedContact(CHONG, ORG_A, "Chong Wei");
  // The pre-ledger fence: an opt_out column with no consent event behind it (R-010 §4.6.5).
  await seedContact(DINA, ORG_A, "Dina Aziz", "opt_out");
  await seedContact(EVELYN, ORG_A, "Evelyn Ng");
  await seedContact(MEI, ORG_B, "Mei Chan");
  await seedContact(NOOR, ORG_B, "Noor Hakim");
  for (const [index, contactId] of [AMIRA, BAKRI, CHONG, DINA, EVELYN].entries()) {
    await seedIdentity(contactId, ORG_A, `+6011100000${index}`, SCOPE_A);
  }
  // r2 — three of them are also reachable by email, which is how a run on another channel gets
  // an audience to disagree about. Adding a second identity changes no `channels` fact these
  // tests already assert: a contact on WhatsApp is still on WhatsApp.
  for (const contactId of [AMIRA, BAKRI, EVELYN]) {
    await prisma.contactIdentity.create({
      data: {
        id: `${contactId}-identity-email`,
        ownerId: ORG_A,
        contactId,
        channelScopeId: SCOPE_EMAIL,
        channel: "email",
        externalId: `${contactId}@fikirtive.test`,
      },
    });
  }
  await seedIdentity(MEI, ORG_B, "+60199999991");
  await seedIdentity(NOOR, ORG_B, "+60199999992");

  // Chong opted out himself — verified customer evidence, and no merchant record anywhere.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: CHONG,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "unsubscribe_link",
    action: "revoke",
    evidenceRef: `${SUITE}-chong-unsubscribe`,
    idempotencyKey: `${SUITE}-chong-revoke`,
  });
  // Evelyn opted in herself first; the merchant's own opt-out lands after it below.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: EVELYN,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "explicit_inbox_optin",
    action: "grant",
    evidenceRef: `${SUITE}-evelyn-optin`,
    idempotencyKey: `${SUITE}-evelyn-grant`,
  });

  actAs(ORG_A);
  // Merchant path 1 — "Record reported opt-out" on the contact profile.
  for (const contactId of [BAKRI, DINA, EVELYN]) {
    expect(
      await setContactConsent({
        contactId,
        action: "revoke",
        requestId: `${SUITE}-${contactId}-request`,
      }),
    ).toEqual({ ok: true });
  }
  // Merchant path 2 — a CSV import row declaring consent=opt_out. No identity is created, so
  // this contact is on the segments page and out of every WhatsApp broadcast's reach.
  const imported = await importContacts({
    csv: "name,consent\nFaiz Rahim,opt_out\n",
    importId: `${SUITE}-import`,
  });
  if (!("ok" in imported)) throw new Error(imported.error);
  faiz = imported.rows[0]?.contactId ?? "";
  expect(faiz).not.toBe("");

  actAs(ORG_B);
  expect(
    await setContactConsent({
      contactId: MEI,
      action: "revoke",
      requestId: `${SUITE}-${MEI}-request`,
    }),
  ).toEqual({ ok: true });

  await prisma.segment.createMany({
    data: [
      {
        id: SEGMENT_KEPT,
        ownerId: ORG_A,
        name: "Everyone who has not opted out",
        phrase: "All of: Contact is not a known opt-out",
        rulesJson: CONTACTABLE,
        kind: "custom",
        createdAt: NOW,
      },
      {
        id: SEGMENT_STRICT,
        ownerId: ORG_A,
        name: "Everyone who has not opted out, minus my own records",
        phrase:
          "All of: Contact is not a known opt-out — also excluding opt-outs you recorded yourself",
        rulesJson: CONTACTABLE_STRICT,
        kind: "custom",
        createdAt: NOW,
      },
    ],
  });
}, 120_000);

describe("#758 off by default — the merchant is not tightened for", () => {
  it("selects exactly whom it selected before when nobody turned the option on", async () => {
    actAs(ORG_A);
    const preview = await previewOrThrow(CONTACTABLE);

    // Amira, Bakri, Evelyn and Faiz. Chong and Dina are the known opt-outs; the three
    // merchant-recorded opt-outs are still in the audience and named (#496 option B, #716).
    expect(preview.totalContactCount).toBe(TOTAL_CONTACTS_A);
    expect(preview.contacts.map((contact) => contact.id).sort()).toEqual(
      [AMIRA, BAKRI, EVELYN, faiz].sort(),
    );
    expect(preview.matchedCount).toBe(4);
    expect(preview.reportedOptOutCount).toBe(3);
    expect(preview.excludedByReportedOptOutCount).toBe(0);
    expect(preview.excludedByConsentCount).toBe(2);
  });

  it("stores the segment a merchant saved without the option in the bytes it always had", async () => {
    actAs(ORG_A);
    const draft = await listSegments();
    if (!("ok" in draft)) throw new Error(draft.error);
    const saved = await buildSegment({
      operation: "create",
      segmentId: draft.nextSegmentId,
      segmentProof: draft.nextSegmentProof,
      name: "Plain audience",
      rules: CONTACTABLE,
    });
    if (!("ok" in saved)) throw new Error(saved.error);

    const row = await prisma.segment.findFirstOrThrow({
      where: { id: draft.nextSegmentId, ownerId: ORG_A },
    });
    // No key at all when the option is off: an unchanged re-save must not read as an edit, and
    // a segment saved before this option existed must stay comparable to one saved after it.
    expect(row.rulesJson).toEqual(CONTACTABLE);
    expect(saved.segment.phrase).toBe("All of: Contact is not a known opt-out");
  });
});

describe("#758 on — the difference is exactly the opt-outs the merchant recorded", () => {
  it("removes those contacts and nobody else", async () => {
    actAs(ORG_A);
    const kept = await previewOrThrow(CONTACTABLE);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);

    const removed = kept.contacts
      .map((contact) => contact.id)
      .filter((id) => !strict.contacts.some((contact) => contact.id === id));
    // Bakri (profile), Evelyn (profile, after her own opt-in) and Faiz (CSV import).
    expect(removed.sort()).toEqual([BAKRI, EVELYN, faiz].sort());
    expect(strict.contacts.map((contact) => contact.id)).toEqual([AMIRA]);
    expect(strict.matchedCount).toBe(1);
    expect(strict.excludedByReportedOptOutCount).toBe(3);
    // Nobody is "still included" once they are excluded — the page never says both.
    expect(strict.reportedOptOutCount).toBe(0);
  });

  it("works on a segment whose rules never mention consent, and counts only whom it removed", async () => {
    actAs(ORG_A);
    const kept = await previewOrThrow(WHATSAPP_ONLY);
    const strict = await previewOrThrow(WHATSAPP_ONLY_STRICT);

    // Bakri and Evelyn are on WhatsApp; Faiz carries the same merchant record and no identity,
    // so these rules never selected him and the count must not claim to have removed him.
    expect(kept.contacts.map((contact) => contact.id).sort()).toEqual([AMIRA, BAKRI, EVELYN].sort());
    expect(strict.contacts.map((contact) => contact.id)).toEqual([AMIRA]);
    expect(strict.excludedByReportedOptOutCount).toBe(2);
    expect(strict.excludedByConsentCount).toBe(kept.excludedByConsentCount);
  });

  it("keeps the merchant's choice out of the number the consent ledger decides", async () => {
    actAs(ORG_A);
    const kept = await previewOrThrow(CONTACTABLE);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);

    // Dina carries BOTH a pre-ledger opt-out and the merchant's own record. She is reported
    // once, under the reason that actually holds her out, and turning the option off would not
    // bring her back — so she may never appear in the option's own number.
    expect(strict.excludedByConsentCount).toBe(kept.excludedByConsentCount);
    expect(strict.excludedByConsentCount).toBe(2);
    expect(strict.unresolvedLegacyOptOutCount).toBe(1);
    expect(strict.excludedByReportedOptOutCount).toBe(3);
    expect(strict.matchedCount + strict.excludedByConsentCount + strict.excludedByReportedOptOutCount).toBe(
      TOTAL_CONTACTS_A,
    );
  });
});

describe("#758 what the segment says is what the broadcast does", () => {
  it("freezes exactly the audience the tightened segment promised", async () => {
    actAs(ORG_A);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);
    const frozen = await freezeOnce("freeze-strict", SEGMENT_STRICT);
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    // Everyone the page shows as included and reachable on WhatsApp is in the frozen list, and
    // nobody else is. (Faiz is in neither: he has no identity to reach.)
    expect([...delivered]).toEqual([AMIRA]);
    for (const contact of strict.contacts) {
      expect(delivered.has(contact.id)).toBe(contact.channels.includes("whatsapp"));
    }
    const written = await prisma.broadcastAudienceMember.findMany({
      where: { ownerId: ORG_A, broadcastRunId: frozen.resource.id },
      select: { contactId: true },
    });
    for (const excluded of [BAKRI, EVELYN]) {
      expect(written.some((member) => member.contactId === excluded)).toBe(false);
    }
  });

  it("counts the same exclusion over its own reachable population, and says which", async () => {
    actAs(ORG_A);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);
    const frozen = await freezeOnce("freeze-strict-numbers", SEGMENT_STRICT);

    // Both surfaces count the same way; the broadcast's population is smaller because Faiz has
    // no WhatsApp identity — the same honest difference #726 pinned for the consent number.
    expect(strict.excludedByReportedOptOutCount).toBe(3);
    expect(frozen.consent.excludedByReportedOptOut).toBe(2);
    expect(frozen.consent.excludedByConsent).toBe(2);
    expect(frozen.consent.reportedOptOutKept).toBe(0);
  });

  it("leaves the untightened segment's audience untouched", async () => {
    const frozen = await freezeOnce("freeze-kept", SEGMENT_KEPT);
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    expect([...delivered].sort()).toEqual([AMIRA, BAKRI, EVELYN].sort());
    expect(frozen.consent.reportedOptOutKept).toBe(2);
    expect(frozen.consent.excludedByReportedOptOut).toBe(0);
  });
});

/**
 * r2 判官 P1-1. "An opt-out the merchant recorded" is ONE fact, and it has ONE address: both
 * merchant surfaces (the contact profile and CSV import) write it to whatsapp+marketing and
 * nothing else. The reading used to follow the BROADCAST's channel and purpose instead, so a run
 * on any other channel looked for the merchant's record in a tuple where it was never written,
 * found nothing, and put back exactly the people the segments page had just excluded — #750's
 * defect, reappearing through the scope rather than through the rules.
 *
 * The verified consent state stays per-run on purpose: a customer's own opt-out really is about
 * one channel and one purpose. Only the merchant's own record is scope-fixed, because that is
 * where it is written.
 */
describe("#758 r2 — the merchant's record is one fact with one address, on every channel", () => {
  it("excludes the same people from an email broadcast that the segments page excluded", async () => {
    actAs(ORG_A);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);
    const frozen = await freezeEmailOnce("freeze-strict-email", SEGMENT_STRICT);
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    // Bakri and Evelyn are reachable by email and carry the merchant's own opt-out. The page
    // says they are out; a run that cannot see the record would send to both.
    expect(delivered.has(BAKRI)).toBe(false);
    expect(delivered.has(EVELYN)).toBe(false);
    expect([...delivered]).toEqual([AMIRA]);
    expect(frozen.consent.excludedByReportedOptOut).toBe(2);

    // Said the other way round, over the page's own rows: every contact the page kept and this
    // run can reach is in the audience, and no contact the page dropped is.
    const written = await prisma.broadcastAudienceMember.findMany({
      where: { ownerId: ORG_A, broadcastRunId: frozen.resource.id },
      select: { contactId: true },
    });
    for (const contact of strict.contacts) {
      expect(delivered.has(contact.id)).toBe(contact.channels.includes("email"));
    }
    for (const excluded of [BAKRI, EVELYN]) {
      expect(written.some((member) => member.contactId === excluded)).toBe(false);
    }
  });

  it("discloses the same record on an untightened email broadcast instead of reporting none", async () => {
    const frozen = await freezeEmailOnce("freeze-kept-email", SEGMENT_KEPT);
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    // #496 option B is untouched here: with the option off they stay in the audience. What the
    // run may not do is stay silent about a record the segments page names on the same segment.
    expect([...delivered].sort()).toEqual([AMIRA, BAKRI, EVELYN].sort());
    expect(frozen.consent.reportedOptOutKept).toBe(2);
    expect(frozen.consent.excludedByReportedOptOut).toBe(0);
  });

  it("scope-fixes only the merchant's record, and leaves the verified state per run", async () => {
    // Read straight from the shared authority, because this is a statement about the authority:
    // the merchant's record is the same on every channel (it is written on one), while the
    // customer's own evidence stays exactly as channel-specific as R-010 makes it.
    const email = await readContactConsentTruth(prisma, ORG_A, {
      channel: "email",
      purpose: "marketing",
    });
    expect(email.get(BAKRI)?.reportedOptOut).toBe(true);
    expect(email.get(EVELYN)?.reportedOptOut).toBe(true);
    // Chong's own WhatsApp unsubscribe is not a statement about email, and this fix must not
    // turn it into one.
    expect(email.get(CHONG)?.state ?? "unknown").toBe("unknown");

    const whatsapp = await readContactConsentTruth(prisma, ORG_A);
    expect(whatsapp.get(CHONG)?.state).toBe("effective_revoke");
    expect(whatsapp.get(BAKRI)?.reportedOptOut).toBe(true);
  });
});

describe("#758 the option only ever subtracts", () => {
  it("never lets a customer the consent record holds out back onto a list", async () => {
    actAs(ORG_A);
    for (const rules of [CONTACTABLE_STRICT, WHATSAPP_ONLY_STRICT]) {
      const preview = await previewOrThrow(rules);
      for (const optedOut of KNOWN_OPT_OUTS_A) {
        expect(preview.contacts.some((contact) => contact.id === optedOut)).toBe(false);
      }
    }

    const frozen = await freezeOnce("freeze-strict-fence", SEGMENT_STRICT);
    const delivered = new Set(frozen.members.map((member) => member.contactId));
    for (const optedOut of KNOWN_OPT_OUTS_A) expect(delivered.has(optedOut)).toBe(false);
  });

  it("does not become a second opt-out rule on a segment built out of opt-outs", async () => {
    actAs(ORG_A);
    const kept = await previewOrThrow(OPTED_OUT_ONLY);
    const strict = await previewOrThrow(OPTED_OUT_ONLY_STRICT);

    // Looking for the people who opted out stays a real segment. With the option on, the only
    // one who leaves is Dina — the merchant asked for his own records to be left out, and hers
    // is one. Chong's opt-out is the customer's own, so he is still exactly where he was.
    expect(kept.contacts.map((contact) => contact.id).sort()).toEqual([CHONG, DINA].sort());
    expect(strict.contacts.map((contact) => contact.id)).toEqual([CHONG]);
    expect(strict.excludedByReportedOptOutCount).toBe(1);
    // And the consent number stays what the ledger decided: on these rules it excluded nobody.
    expect(strict.excludedByConsentCount).toBe(0);
  });
});

describe("#758 the merchant reads it in words, on both surfaces", () => {
  it("names the choice and its number on the segments page", async () => {
    actAs(ORG_A);
    const strict = await previewOrThrow(CONTACTABLE_STRICT);
    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview: strict }));

    expect(markup).toContain("3 reported opt-out excluded by your choice");
    expect(markup).toContain("You chose to exclude the opt-outs you recorded yourself");
    // The opposite sentence belongs to the untightened segment, and only one of them is true.
    expect(markup).not.toContain("reported opt-out still included");
    // The choice is never dressed up as evidence the customer gave (#768).
    expect(markup).not.toContain("customers who opted out excluded");
    for (const claim of REJECTED_CLAIMS) expect(markup).not.toContain(claim);
  });

  it("keeps every clause on this screen to something the ledger can prove", async () => {
    // r2 P1-2's own reproduction, stated as behaviour rather than as wording: the banned promise
    // was "a customer who opted out herself is out either way", and here is the legal segment
    // where she is not. Both are checked in one place so the sentence cannot come back while
    // the counter-example still stands.
    actAs(ORG_A);
    const optedOut = await previewOrThrow(OPTED_OUT_ONLY_STRICT);
    expect(optedOut.contacts.map((contact) => contact.id)).toEqual([CHONG]);

    const initialState = await listSegments();
    if (!("ok" in initialState)) throw new Error(initialState.error);
    const page = renderToStaticMarkup(
      createElement(SegmentsPage, { initialState } as ComponentProps<typeof SegmentsPage>),
    );
    const preview = renderToStaticMarkup(createElement(ContactPreview, { preview: optedOut }));
    for (const claim of REJECTED_CLAIMS) {
      expect(page, claim).not.toContain(claim);
      expect(preview, claim).not.toContain(claim);
    }
  });

  it("keeps the untightened page saying the disclosure instead", async () => {
    actAs(ORG_A);
    const kept = await previewOrThrow(CONTACTABLE);
    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview: kept }));

    expect(markup).toContain("3 reported opt-out still included");
    expect(markup).not.toContain("excluded by your choice");
  });

  it("says it again on the broadcast, as the merchant's choice and not as consent", async () => {
    const frozen = await freezeOnce("freeze-strict-copy", SEGMENT_STRICT);
    const note = renderToStaticMarkup(createElement(ConsentExclusionNote, { consent: frozen.consent }));

    expect(note).toContain("2 contacts were excluded for opting out.");
    expect(note).toContain(
      "This segment also leaves out opt-outs you recorded yourself, so 2 more contacts are not in this audience.",
    );
    // The two numbers stay two sentences: the merchant's choice is not folded into the ledger's.
    expect(note).not.toContain("4 contacts were excluded for opting out");
  });
});

describe("#758 the merchant can reach the option himself, and the list says which segments use it", () => {
  it("puts the switch on the segment builder, off until he turns it on", async () => {
    actAs(ORG_A);
    const initialState = await listSegments();
    if (!("ok" in initialState)) throw new Error(initialState.error);
    const markup = renderToStaticMarkup(
      createElement(SegmentsPage, { initialState } as ComponentProps<typeof SegmentsPage>),
    );

    expect(markup).toContain("Also exclude opt-outs I recorded myself");
    expect(markup).toContain(
      "An opt-out you or a CSV import recorded is not confirmed by the customer",
    );
    // r2 P1-2 — and it promises nothing the product does not do.
    for (const claim of REJECTED_CLAIMS) expect(markup).not.toContain(claim);
    const control = markup.match(/<button[^>]*id="segment-exclude-reported-opt-out"[^>]*>/)?.[0];
    // Off is the shipped default: the product does not decide for the merchant whom to drop.
    expect(control).toBeDefined();
    expect(control).toContain('aria-checked="false"');
    expect(control).toContain('role="switch"');
  });

  it("names the tightening in the saved segment's own sentence", async () => {
    actAs(ORG_A);
    const initialState = await listSegments();
    if (!("ok" in initialState)) throw new Error(initialState.error);
    const strict = initialState.segments.find((segment) => segment.id === SEGMENT_STRICT);
    const kept = initialState.segments.find((segment) => segment.id === SEGMENT_KEPT);

    // A segment that quietly drops contacts its own phrase never mentions would be the saved
    // list saying less than the segment does.
    expect(strict?.phrase).toBe(
      "All of: Contact is not a known opt-out — also excluding opt-outs you recorded yourself",
    );
    expect(kept?.phrase).toBe("All of: Contact is not a known opt-out");
    expect(strict?.excludedByReportedOptOutCount).toBe(3);
    expect(kept?.excludedByReportedOptOutCount).toBe(0);

    const markup = renderToStaticMarkup(
      createElement(SegmentsPage, { initialState } as ComponentProps<typeof SegmentsPage>),
    );
    expect(markup).toContain("also excluding opt-outs you recorded yourself");
  });
});

describe("#758 each tenant's own records decide its own segments", () => {
  it("excludes tenant B's recorded opt-out inside tenant B, and moves no number in tenant A", async () => {
    actAs(ORG_B);
    const keptB = await previewOrThrow(CONTACTABLE);
    const strictB = await previewOrThrow(CONTACTABLE_STRICT);

    expect(keptB.totalContactCount).toBe(2);
    expect(keptB.contacts.map((contact) => contact.id).sort()).toEqual([MEI, NOOR].sort());
    expect(keptB.reportedOptOutCount).toBe(1);
    expect(strictB.contacts.map((contact) => contact.id)).toEqual([NOOR]);
    expect(strictB.excludedByReportedOptOutCount).toBe(1);
    // Tenant A's four recorded opt-outs are not tenant B's business, and vice versa.
    for (const foreign of [AMIRA, BAKRI, CHONG, DINA, EVELYN, faiz]) {
      expect(keptB.contacts.some((contact) => contact.id === foreign)).toBe(false);
    }

    actAs(ORG_A);
    const strictA = await previewOrThrow(CONTACTABLE_STRICT);
    expect(strictA.totalContactCount).toBe(TOTAL_CONTACTS_A);
    expect(strictA.excludedByReportedOptOutCount).toBe(3);
    expect(strictA.contacts.some((contact) => contact.id === MEI)).toBe(false);
  });

  it("keeps the tightened freeze inside the tenant that owns the segment", async () => {
    const frozen = await freezeOnce("freeze-strict-tenant", SEGMENT_STRICT);
    expect(frozen.members.every((member) => member.ownerId === ORG_A)).toBe(true);
    for (const foreign of [MEI, NOOR]) {
      expect(frozen.members.some((member) => member.contactId === foreign)).toBe(false);
    }
  });
});
