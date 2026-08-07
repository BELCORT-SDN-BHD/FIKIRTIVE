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
const NOW = new Date("2026-08-08T00:00:00.000Z");

/** Names read like the walkthrough's, so a failure names a person, not an id. */
const AISYAH = `${SUITE}-aisyah`; // no consent record at all
const BEN = `${SUITE}-ben`; // no consent record at all
const CHANDRA = `${SUITE}-chandra`; // legacy marketingConsent column says opt_out, no projection
const DEVI = `${SUITE}-devi`; // customer opted out through the unsubscribe link (verified)
const GRACE = `${SUITE}-grace`; // verified revoke projection, legacy column never written
const ELLA = `${SUITE}-ella`; // merchant recorded the opt-out on the contact profile
const MEI = `${SUITE}-mei`; // other tenant, opted out

let farid = ""; // CSV import row that declared consent=opt_out

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
  // #726's exact repro: the legacy column carries opt_out with no projection behind it.
  await seedContact(CHANDRA, ORG_A, "Chandra Nair", "opt_out");
  await seedContact(DEVI, ORG_A, "Devi Kumar");
  await seedContact(GRACE, ORG_A, "Grace Lim");
  await seedContact(ELLA, ORG_A, "Ella Wong");
  await seedContact(MEI, ORG_B, "Mei Chan");
  for (const [index, contactId] of [AISYAH, BEN, CHANDRA, DEVI, GRACE, ELLA].entries()) {
    await seedIdentity(contactId, ORG_A, SCOPE_A, `+6011000000${index}`);
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
  const recorded = await setContactConsent({ contactId: ELLA, action: "revoke", requestId: `${SUITE}-ella-request` });
  expect(recorded).toEqual({ ok: true });
  // Merchant path 2: a CSV import row declaring consent=opt_out.
  const imported = await importContacts({
    csv: "name,consent\nFarid Osman,opt_out\n",
    importId: `${SUITE}-import`,
  });
  if (!("ok" in imported)) throw new Error(imported.error);
  expect(imported.rows[0]?.consentAssertion).toBe("revoke");
  farid = imported.rows[0]?.contactId ?? "";
  expect(farid).not.toBe("");

  await prisma.segment.create({
    data: {
      id: SEGMENT_WHATSAPP,
      ownerId: ORG_A,
      name: "WhatsApp, not a known opt-out",
      phrase: "All of: channel is whatsapp and contact is not a known opt-out",
      rulesJson: WHATSAPP_CONTACTABLE,
      kind: "custom",
      createdAt: NOW,
    },
  });
}, 60_000);

async function freezeOnce(key: string) {
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

describe("#726 the segment's promise and the frozen audience are the same list", () => {
  it("freezes exactly the contacts the segments page said it would reach", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-parity");

    const promised = preview.contacts.filter((contact) => contact.contactable).map((contact) => contact.id).sort();
    const delivered = [...new Set(frozen.members.map((member) => member.contactId))].sort();
    expect(delivered).toEqual(promised);
    expect(preview.contactableCount).toBe(delivered.length);
  });

  it("keeps every customer who opted out off the frozen list, whichever way the opt-out was recorded", async () => {
    const frozen = await freezeOnce("freeze-optouts");
    const delivered = new Set(frozen.members.map((member) => member.contactId));

    expect(delivered.has(DEVI)).toBe(false);
    expect(delivered.has(GRACE)).toBe(false);
    expect(delivered.has(MEI)).toBe(false);
  });

  it("reports the exclusion with the same number on both pages", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const frozen = await freezeOnce("freeze-numbers");

    expect(preview.excludedByConsentCount).toBe(2); // Devi and Grace
    expect(frozen.consent.excludedByConsent).toBe(preview.excludedByConsentCount);
  });

  it("stops treating the legacy consent column as an authority of its own", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(WHATSAPP_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    // Chandra's legacy column still says opt_out; nothing verified backs it, so neither page
    // may claim she was excluded — and neither may quietly put her back.
    const chandra = preview.contacts.find((contact) => contact.id === CHANDRA);
    expect(chandra?.contactable).toBe(true);
    const stored = await prisma.contact.findFirstOrThrow({ where: { id: CHANDRA, ownerId: ORG_A } });
    expect(stored.marketingConsent).toBe("opt_out");
  });
});

describe("#716 an opt-out the merchant recorded himself is visible where he picks the audience", () => {
  it("counts the profile-recorded and the CSV-imported opt-out, and keeps saying they are still included", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    expect(preview.reportedOptOutCount).toBe(2); // Ella (profile) and Farid (CSV import)
    const flagged = preview.contacts.filter((contact) => contact.reportedOptOut).map((contact) => contact.id).sort();
    expect(flagged).toEqual([ELLA, farid].sort());
    // Founder's option B on #496 stands: a merchant assertion is not verified evidence, so it
    // does not exclude anyone. It may no longer be invisible.
    expect(preview.contacts.find((contact) => contact.id === ELLA)?.contactable).toBe(true);
    expect(preview.contacts.find((contact) => contact.id === farid)?.contactable).toBe(true);
  });

  it("says so on the page the merchant is looking at", async () => {
    actAs(ORG_A);
    const preview = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);

    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(markup).toContain("2 reported opt-out still included");
    expect(markup).toContain("An opt-out you recorded yourself keeps the contact in the list");
    expect(markup).toContain("Included · reported opt-out");
  });

  it("tells the broadcast freeze the same thing, in words the merchant reads", async () => {
    const frozen = await freezeOnce("freeze-reported");
    // Only Ella has a channel identity — the CSV row imported no identity, so it cannot be in a
    // whatsapp audience at all.
    expect(frozen.consent.reportedOptOutKept).toBe(1);

    const markup = renderToStaticMarkup(createElement(ConsentExclusionNote, { consent: frozen.consent }));
    expect(markup).toContain("2 contacts were excluded for opting out");
    expect(markup).toContain("1 contact is in this audience with an opt-out you recorded yourself");
  });

  it("never dresses a merchant assertion up as a known opt-out", async () => {
    actAs(ORG_A);
    const knownOptOuts = await previewSegment({
      match: "all",
      rules: [{ kind: "contactability", value: "not_contactable" }],
    });
    if (!("ok" in knownOptOuts)) throw new Error(knownOptOuts.error);

    const matched = knownOptOuts.contacts.map((contact) => contact.id).sort();
    expect(matched).toEqual([DEVI, GRACE].sort());
  });
});

describe("consent truth stays inside the tenant fence", () => {
  it("never lets one tenant's opt-out move another tenant's numbers", async () => {
    actAs(ORG_A);
    const a = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in a)) throw new Error(a.error);
    expect(a.contacts.map((contact) => contact.id)).not.toContain(MEI);
    expect(a.totalContactCount).toBe(7); // six seeded + the CSV import, all in this tenant

    actAs(ORG_B);
    const b = await previewSegment(EVERYONE_CONTACTABLE);
    if (!("ok" in b)) throw new Error(b.error);
    expect(b.totalContactCount).toBe(1);
    expect(b.matchedCount).toBe(0); // Mei is this tenant's only contact, and she opted out
    expect(b.excludedByConsentCount).toBe(1);
    expect(b.reportedOptOutCount).toBe(0);
  });
});
