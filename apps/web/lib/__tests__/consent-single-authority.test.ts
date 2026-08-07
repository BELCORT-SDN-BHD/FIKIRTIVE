/**
 * #716 / #726 — one merchant, one question ("has this customer opted out?"), one answer.
 *
 * Real-database behaviour test. It seeds the exact shapes the two walkthroughs found, then reads
 * them through the real product paths: the segments page (previewSegment + the rendered preview)
 * and the broadcast workbench (freezeAudience on the same segment).
 *
 * Red on main:
 *  - the frozen audience did not match the audience the segments page had just promised (#726);
 *  - an opt-out the merchant recorded himself was reported nowhere on the segments page (#716).
 *
 * Red on the first fix round (r1 judge findings, corrected here):
 *  - a contact whose only opt-out record is the pre-ledger `Contact.marketingConsent` column was
 *    put BACK into the audience the moment selection stopped reading that column. The fence is
 *    now fail-closed (R-010 §4.6.5): no consent decision + a legacy opt-out means opted out.
 *  - a merchant opt-out recorded AFTER a verified opt-in was reported as zero, because the
 *    disclosure looked at the folded state instead of the merchant's own latest record.
 *  - the segments page and the broadcast freeze count over different populations (everyone you
 *    have vs. everyone this broadcast can reach), and neither page said so.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("../better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma, recordConsentEvent } = await import("@fikirtive/db");
const { requireOwner } = await import("../auth-guard");
const { previewSegment } = await import("../segment-actions");
const { setContactConsent, importContacts } = await import("../crm-actions");
const { createCustomerBroadcastService } = await import("../customer-broadcast-service");
const { ContactPreview } = await import("@/components/crm/segments-page");
const { ConsentExclusionNote } = await import("@/components/crm/broadcasts/broadcast-detail-page");

const SUITE = `p2cons-${randomUUID().slice(0, 8)}`;
const ORG_A = `${SUITE}-org-a`;
const ORG_B = `${SUITE}-org-b`;
const USER_A = `${SUITE}-user-a`;
const USER_B = `${SUITE}-user-b`;
const MEMBERSHIP_A = `${SUITE}-membership-a`;
const MEMBERSHIP_B = `${SUITE}-membership-b`;
const SCOPE_A = `${SUITE}-scope-a`;
const TEMPLATE_A = `${SUITE}-template-a`;
const TEMPLATE_VERSION_A = `${SUITE}-template-version-a`;
const CONNECTION_A = `${SUITE}-connection-a`;
const SEGMENT_WHATSAPP = `${SUITE}-segment-whatsapp`;
const SEGMENT_EVERYONE = `${SUITE}-segment-everyone`;
const NOW = new Date("2026-08-08T00:00:00.000Z");

/** Names read like the walkthrough's, so a failure names a person, not an id. */
const AISYAH = `${SUITE}-aisyah`; // no consent record at all
const BEN = `${SUITE}-ben`; // no consent record at all
const CHANDRA = `${SUITE}-chandra`; // legacy marketingConsent column says opt_out, no consent event
const HANA = `${SUITE}-hana`; // same legacy opt_out, and the merchant recorded it again himself
const DEVI = `${SUITE}-devi`; // customer opted out through the unsubscribe link (verified)
const GRACE = `${SUITE}-grace`; // verified revoke projection, legacy column never written
const ELLA = `${SUITE}-ella`; // merchant recorded the opt-out on the contact profile
const IVY = `${SUITE}-ivy`; // opted in herself, THEN the merchant recorded an opt-out
const JOHN = `${SUITE}-john`; // verified opt-out, and no WhatsApp identity to reach him on
const MEI = `${SUITE}-mei`; // other tenant, opted out

/** Eight plain contacts, so every match is bigger than the preview's 10-row cut. */
const BULK = Array.from({ length: 8 }, (_, index) => `${SUITE}-bulk-${index}`);

let farid = ""; // CSV import row that declared consent=opt_out; no identity was imported

/** Everyone this tenant has: the nine named contacts, the CSV import, and the eight bulk rows. */
const TOTAL_CONTACTS = 18;
/** Reachable on WhatsApp: everyone except John and Farid, who have no WhatsApp identity. */
const KNOWN_OPT_OUTS = [CHANDRA, HANA, DEVI, GRACE, JOHN];

const WHATSAPP_CONTACTABLE = {
  match: "all" as const,
  rules: [
    { kind: "channel" as const, channel: "whatsapp" },
    { kind: "contactability" as const, value: "contactable" as const },
  ],
};
const EVERYONE_CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};

const broadcast = createCustomerBroadcastService({ clock: () => NOW, id: () => `${SUITE}-gen-${randomUUID()}` });
const principalA = { ownerId: ORG_A, membershipId: MEMBERSHIP_A, impersonating: false };

function actAs(ownerId: string): void {
  vi.mocked(requireOwner).mockResolvedValue({
    ownerId,
    email: `${ownerId}@fikirtive.test`,
  } as Awaited<ReturnType<typeof requireOwner>>);
}

async function seedContact(id: string, ownerId: string, name: string, marketingConsent?: string): Promise<void> {
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

async function seedIdentity(contactId: string, ownerId: string, scopeId: string, externalId: string): Promise<void> {
  await prisma.contactIdentity.create({
    data: {
      id: `${contactId}-identity`,
      ownerId,
      contactId,
      channelScopeId: scopeId,
      channel: "whatsapp",
      externalId,
    },
  });
}

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "consent-single-authority-test-secret";

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

  await seedContact(AISYAH, ORG_A, "Aisyah Rahman");
  await seedContact(BEN, ORG_A, "Ben Tan");
  // #726's exact repro: the legacy column carries opt_out with no consent event behind it.
  await seedContact(CHANDRA, ORG_A, "Chandra Nair", "opt_out");
  // Same shape, plus the merchant recording the opt-out again on the profile. Re-recording an
  // opt-out must never be the thing that lets the customer back into a list.
  await seedContact(HANA, ORG_A, "Hana Yusof", "opt_out");
  await seedContact(DEVI, ORG_A, "Devi Kumar");
  await seedContact(GRACE, ORG_A, "Grace Lim");
  await seedContact(ELLA, ORG_A, "Ella Wong");
  await seedContact(IVY, ORG_A, "Ivy Chong");
  await seedContact(JOHN, ORG_A, "John Abraham");
  await seedContact(MEI, ORG_B, "Mei Chan");
  for (const [index, contactId] of [AISYAH, BEN, CHANDRA, HANA, DEVI, GRACE, ELLA, IVY].entries()) {
    await seedIdentity(contactId, ORG_A, SCOPE_A, `+6011000000${index}`);
  }
  for (const [index, contactId] of BULK.entries()) {
    await seedContact(contactId, ORG_A, `Zulkifli Bulk ${index}`);
    await seedIdentity(contactId, ORG_A, SCOPE_A, `+6012000000${index}`);
  }

  // Devi opted out herself through the unsubscribe link — verified customer evidence.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: DEVI,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "unsubscribe_link",
    action: "revoke",
    evidenceRef: `${SUITE}-devi-unsubscribe`,
    idempotencyKey: `${SUITE}-devi-revoke`,
  });
  // John did the same, but there is no WhatsApp identity to reach him on — the segments page
  // still counts him, a WhatsApp broadcast never can.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: JOHN,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "unsubscribe_link",
    action: "revoke",
    evidenceRef: `${SUITE}-john-unsubscribe`,
    idempotencyKey: `${SUITE}-john-revoke`,
  });
  // Ivy opted in herself first — verified. The merchant's own opt-out comes after it below.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: IVY,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "explicit_inbox_optin",
    action: "grant",
    evidenceRef: `${SUITE}-ivy-optin`,
    idempotencyKey: `${SUITE}-ivy-grant`,
  });
  // Grace carries the same verified revoke as a projection with the legacy column untouched —
  // the mirror image of Chandra, and the shape a non-marketing purpose already produces today.
  await prisma.consentStateProjection.create({
    data: {
      ownerId: ORG_A,
      contactId: GRACE,
      channel: "whatsapp",
      purpose: "marketing",
      state: "effective_revoke",
      lastEventId: `${SUITE}-grace-event`,
      lastReceivedAt: NOW,
      stateActorKind: "customer",
      stateSourceKind: "stop_keyword",
      evidenceStatus: "verified",
    },
  });
  // The other tenant's customer opted out too — it must never move this tenant's numbers.
  await recordConsentEvent({
    ownerId: ORG_B,
    contactId: MEI,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "unsubscribe_link",
    action: "revoke",
    evidenceRef: `${SUITE}-mei-unsubscribe`,
    idempotencyKey: `${SUITE}-mei-revoke`,
  });

  actAs(ORG_A);
  // Merchant path 1: "Record reported opt-out" on the contact profile.
  for (const contactId of [ELLA, HANA, IVY]) {
    const recorded = await setContactConsent({ contactId, action: "revoke", requestId: `${SUITE}-${contactId}-request` });
    expect(recorded).toEqual({ ok: true });
  }
  // Merchant path 2: a CSV import row declaring consent=opt_out.
  const imported = await importContacts({
    csv: "name,consent\nFarid Osman,opt_out\n",
    importId: `${SUITE}-import`,
  });
  if (!("ok" in imported)) throw new Error(imported.error);
  expect(imported.rows[0]?.consentAssertion).toBe("revoke");
  farid = imported.rows[0]?.contactId ?? "";
  expect(farid).not.toBe("");

  await prisma.segment.createMany({
    data: [
      {
        id: SEGMENT_WHATSAPP,
        ownerId: ORG_A,
        name: "WhatsApp, not a known opt-out",
        phrase: "All of: channel is whatsapp and contact is not a known opt-out",
        rulesJson: WHATSAPP_CONTACTABLE,
        kind: "custom",
        createdAt: NOW,
      },
      {
        id: SEGMENT_EVERYONE,
        ownerId: ORG_A,
        name: "Everyone who has not opted out",
        phrase: "All of: contact is not a known opt-out",
        rulesJson: EVERYONE_CONTACTABLE,
        kind: "custom",
        createdAt: NOW,
      },
    ],
  });
}, 120_000);

async function freezeOnce(key: string, segmentId: string = SEGMENT_WHATSAPP) {
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

describe("#726 the segment's promise and the frozen audience are the same list", () => {
  it("never freezes anyone the segments page said it had excluded, truncation or not", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-parity");

    // The match is bigger than the 10-row preview cut, so this is the general case: the two
    // sides can only be compared by the rule, never by the ten rows that happen to be shown.
    expect(preview.matchedCount).toBe(12);
    expect(preview.contacts).toHaveLength(10);

    const delivered = new Set(frozen.members.map((member) => member.contactId));
    expect(delivered.size).toBe(preview.contactableCount);
    for (const optedOut of [...KNOWN_OPT_OUTS, MEI]) expect(delivered.has(optedOut)).toBe(false);
    // Everyone shown as included on the page really is in the frozen list.
    for (const contact of preview.contacts) expect(delivered.has(contact.id)).toBe(contact.contactable);
  });

  it("keeps every customer who opted out off the frozen list, whichever way the opt-out was recorded", async () => {
    const frozen = await freezeOnce("freeze-optouts");
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    for (const optedOut of [...KNOWN_OPT_OUTS, MEI]) expect(delivered.has(optedOut)).toBe(false);
  });

  it("reports the exclusion with the same number on both pages when the segment names the channel", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-numbers");

    // Chandra, Hana, Devi and Grace. John is a known opt-out too, but a segment that asks for a
    // WhatsApp channel never selected him in the first place.
    expect(preview.excludedByConsentCount).toBe(4);
    expect(frozen.consent.excludedByConsent).toBe(preview.excludedByConsentCount);
  });

  it("holds a pre-ledger opt-out out of the list instead of quietly re-admitting the customer", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    // Chandra's only opt-out record is the column that predates consent history. Nothing the
    // customer or the merchant did since then released it, so she stays out — the ledger
    // migration must not be what puts an opted-out customer back on a list.
    const stored = await prisma.contact.findFirstOrThrow({ where: { id: CHANDRA, ownerId: ORG_A } });
    expect(stored.marketingConsent).toBe("opt_out");
    expect(preview.contacts.find((contact) => contact.id === CHANDRA)).toBeUndefined();

    const excluded = await previewSegment({
      match: "all",
      rules: [
        { kind: "channel", channel: "whatsapp" },
        { kind: "contactability", value: "not_contactable" },
      ],
    });
    if (!("ok" in excluded)) throw new Error(excluded.error);
    expect(excluded.contacts.map((contact) => contact.id).sort()).toEqual([CHANDRA, HANA, DEVI, GRACE].sort());

    // And re-recording the same opt-out on the profile cannot be the act that releases it.
    const frozen = await freezeOnce("freeze-legacy", SEGMENT_WHATSAPP);
    const delivered = new Set(frozen.members.map((member) => member.contactId));
    expect(delivered.has(CHANDRA)).toBe(false);
    expect(delivered.has(HANA)).toBe(false);
    expect(preview.unresolvedLegacyOptOutCount).toBe(2);
    expect(frozen.consent.unresolvedLegacyOptOut).toBe(2);
  });
});

describe("#716 an opt-out the merchant recorded himself is visible where he picks the audience", () => {
  it("counts every merchant-recorded opt-out, including one recorded after a verified opt-in", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    // Ella (profile), Farid (CSV import), and Ivy — whose merchant opt-out came AFTER she had
    // opted in herself, which is exactly the record the first fix round reported as zero.
    expect(preview.reportedOptOutCount).toBe(3);
    const flagged = preview.contacts.filter((contact) => contact.reportedOptOut).map((contact) => contact.id);
    expect(flagged).toContain(IVY);
    // Founder's option B on #496 stands: a merchant assertion is not verified evidence, so it
    // does not exclude anyone. It may no longer be invisible.
    expect(preview.contacts.find((contact) => contact.id === IVY)?.contactable).toBe(true);
    // Hana's merchant record is real too, but she is already out on the pre-ledger fence — the
    // page must not advertise her as "still included".
    expect(flagged).not.toContain(HANA);
  });

  it("leaves the send decision alone while saying the record out loud", async () => {
    const frozen = await freezeOnce("freeze-axis", SEGMENT_EVERYONE);
    const ivy = frozen.members.find((member) => member.contactId === IVY);
    expect(ivy).toBeDefined();

    // #496 option B: a merchant's own record does not suppress. The verified opt-in still
    // decides the send, and the disclosure — not the axis — is what tells the merchant.
    const verdict = ivy?.eligibilityVerdictJson as { consentStop?: { status?: string } };
    expect(verdict.consentStop?.status).toBe("pass");
    expect(frozen.consent.reportedOptOutKept).toBe(2); // Ella and Ivy; Farid has no identity
  });

  it("says so on the page the merchant is looking at", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(markup).toContain("3 reported opt-out still included");
    expect(markup).toContain("An opt-out you recorded yourself keeps the contact in the list");
    expect(markup).toContain("Included · reported opt-out");
    expect(markup).toContain("2 of them opted out before consent history was kept");
  });

  it("tells the broadcast freeze the same thing, in words the merchant reads", async () => {
    const frozen = await freezeOnce("freeze-reported", SEGMENT_EVERYONE);

    const markup = renderToStaticMarkup(createElement(ConsentExclusionNote, { consent: frozen.consent }));
    expect(markup).toContain("4 contacts were excluded for opting out");
    expect(markup).toContain("2 of them opted out before consent history was kept");
    expect(markup).toContain("2 contacts are in this audience with an opt-out you recorded yourself");
  });

  it("never dresses a merchant assertion up as a known opt-out", async () => {
    actAs(ORG_A);
    const knownOptOuts = await previewSegment({
      match: "all",
      rules: [{ kind: "contactability", value: "not_contactable" }],
    });
    if (!("ok" in knownOptOuts)) throw new Error(knownOptOuts.error);

    // Ella, Farid and Ivy carry a merchant-recorded opt-out and are NOT here: an assertion is
    // not verified evidence. Hana is here on her pre-ledger record, not on her assertion.
    expect(knownOptOuts.contacts.map((contact) => contact.id).sort()).toEqual([...KNOWN_OPT_OUTS].sort());
  });
});

describe("#726 the two pages count different populations, and each one says which", () => {
  it("counts everyone the merchant has on the segments page, and only the reachable on the freeze", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-population", SEGMENT_EVERYONE);

    // The segments page counts every contact: Farid stays in the audience it promises and John
    // is one of the opt-outs it reports excluding, even though neither has a WhatsApp identity.
    expect(preview.contactableCount).toBe(13);
    expect(preview.excludedByConsentCount).toBe(5);
    // The broadcast can only count the people it can reach, so both numbers are one lower.
    const delivered = new Set(frozen.members.map((member) => member.contactId));
    expect(delivered.size).toBe(12);
    expect(delivered.has(farid)).toBe(false);
    expect(frozen.consent.excludedByConsent).toBe(4);
  });

  it("prints the population next to each number instead of implying they are the same", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-population-copy", SEGMENT_EVERYONE);

    const page = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(page).toContain("These counts cover every contact you have");
    expect(page).toContain("A broadcast counts only the contacts it can reach");

    const note = renderToStaticMarkup(createElement(ConsentExclusionNote, { consent: frozen.consent }));
    expect(note).toContain("This count covers the contacts this broadcast can reach on its channel");
    // The freeze must not claim to have excluded the very same people the segment did.
    expect(note).not.toContain("the same contacts the segment left out");
  });
});

describe("consent truth stays inside the tenant fence", () => {
  it("never lets one tenant's opt-out move another tenant's numbers", async () => {
    actAs(ORG_A);
    const a = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in a)) throw new Error(a.error);
    expect(a.contacts.map((contact) => contact.id)).not.toContain(MEI);
    expect(a.totalContactCount).toBe(TOTAL_CONTACTS);

    actAs(ORG_B);
    const b = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in b)) throw new Error(b.error);
    expect(b.totalContactCount).toBe(1);
    expect(b.matchedCount).toBe(0); // Mei is this tenant's only contact, and she opted out
    expect(b.excludedByConsentCount).toBe(1);
    expect(b.reportedOptOutCount).toBe(0);
    expect(b.unresolvedLegacyOptOutCount).toBe(0);
  });
});
