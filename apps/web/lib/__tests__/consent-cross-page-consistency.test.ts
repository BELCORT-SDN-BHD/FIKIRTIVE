/**
 * #752 — one customer, one sentence, on all three pages a merchant can look at her from.
 *
 * #750 made segment selection fail-closed on the pre-ledger fence: a contact whose ledger says
 * nothing (`state = unknown`) and whose legacy `Contact.marketingConsent` column says `opt_out`
 * is held out of every audience, and the segments page says so on the row. The contacts list and
 * the contact profile kept reading the projection alone, so the very same customer read
 * `Unknown` there — true of the ledger, false of the product, and two stories for one merchant.
 *
 * Real-database behaviour test. It seeds the shapes through the real product paths and reads
 * them back through the real ones: `previewSegment` + the rendered segment preview, `listContacts`
 * + the rendered contacts list, `getContact` + the rendered contact profile.
 *
 * Red on main (before this fix): the contacts list and the profile render `Unknown` for the
 * fenced customer, and `CrmConsentState` carries no fence fact at all.
 *
 * The send side is not touched by this ticket and this file guards that: a merchant-recorded
 * opt-out still reads `Unknown` and still stays contactable (#496 option B), a legacy `opt_in`
 * still cannot create consent, and the segment counts are asserted unchanged.
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
const { setContactConsent } = await import("../crm-actions");
const { getContact, listContacts } = await import("../crm-view-data");
const { ContactPreview } = await import("@/components/crm/segments-page");
const ContactsPage = (await import("@/components/crm/contacts-page")).default;
const ContactProfilePage = (await import("@/components/crm/contact-profile-page")).default;

const SUITE = `p752-${randomUUID().slice(0, 8)}`;
const ORG_A = `${SUITE}-org-a`;
const ORG_B = `${SUITE}-org-b`;
const USER_A = `${SUITE}-user-a`;
const USER_B = `${SUITE}-user-b`;
const MEMBERSHIP_A = `${SUITE}-membership-a`;
const MEMBERSHIP_B = `${SUITE}-membership-b`;
const SCOPE_A = `${SUITE}-scope-a`;
const NOW = new Date("2026-08-08T00:00:00.000Z");

/** The ticket's customer: legacy column says opt_out, the ledger never reached her. */
const CHANDRA = `${SUITE}-chandra`;
/** Same fence, plus the merchant recording the opt-out again — so the history is NOT empty. */
const HANA = `${SUITE}-hana`;
/** No consent record of any kind: genuinely unknown, and must keep saying so. */
const BEN = `${SUITE}-ben`;
/** Only the merchant's own record. Unverified: still unknown, still contactable (#496 B). */
const ELLA = `${SUITE}-ella`;
/** The customer opted out herself: verified. */
const GRACE = `${SUITE}-grace`;
/** Legacy column says opt_in with nothing behind it. The column may never CREATE consent. */
const IRIS = `${SUITE}-iris`;
/** The other tenant's fenced customer. */
const MEI = `${SUITE}-mei`;

/** The segment a merchant uses to look at the people who are held out. */
const NOT_CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "not_contactable" as const }],
};
const CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};

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

/** The contacts list as the merchant sees it, narrowed to one contact so the markup names one
 *  person. The row itself comes from the real `listContacts` read — nothing is hand-built. */
async function contactsListMarkup(contactId: string): Promise<string> {
  const listed = await listContacts({ limit: 100 });
  if (!("ok" in listed)) throw new Error(listed.error);
  const row = listed.contacts.find((contact) => contact.id === contactId);
  if (!row) throw new Error(`${contactId} is missing from the contacts list`);
  return renderToStaticMarkup(
    createElement(ContactsPage, {
      initialState: { ...listed, contacts: [row], totalCount: 1, nextCursor: null, hasMore: false },
    }),
  );
}

async function contactProfileMarkup(contactId: string): Promise<string> {
  const detail = await getContact(contactId);
  if (!("ok" in detail)) throw new Error(detail.error);
  return renderToStaticMarkup(createElement(ContactProfilePage, { initialState: detail }));
}

/** The segments page row for one contact, rendered from a real preview. */
async function segmentRowMarkup(contactId: string): Promise<string> {
  const preview = await previewSegment(NOT_CONTACTABLE);
  if (!("ok" in preview)) throw new Error(preview.error);
  const row = preview.contacts.find((contact) => contact.id === contactId);
  if (!row) throw new Error(`${contactId} is missing from the excluded segment`);
  return renderToStaticMarkup(
    createElement(ContactPreview, { preview: { ...preview, contacts: [row] } }),
  );
}

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "consent-cross-page-test-secret";

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

  await seedContact(CHANDRA, ORG_A, "Chandra Nair", "opt_out");
  await seedContact(HANA, ORG_A, "Hana Yusof", "opt_out");
  await seedContact(BEN, ORG_A, "Ben Tan");
  await seedContact(ELLA, ORG_A, "Ella Wong");
  await seedContact(GRACE, ORG_A, "Grace Lim");
  await seedContact(IRIS, ORG_A, "Iris Devi", "opt_in");
  await seedContact(MEI, ORG_B, "Mei Chan", "opt_out");

  for (const [index, contactId] of [CHANDRA, HANA, BEN, ELLA, GRACE, IRIS].entries()) {
    await prisma.contactIdentity.create({
      data: {
        id: `${contactId}-identity`,
        ownerId: ORG_A,
        contactId,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        externalId: `+6011000000${index}`,
      },
    });
  }

  // Grace opted out through her own unsubscribe link — verified customer evidence.
  await recordConsentEvent({
    ownerId: ORG_A,
    contactId: GRACE,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind: "unsubscribe_link",
    action: "revoke",
    evidenceRef: `${SUITE}-grace-unsubscribe`,
    idempotencyKey: `${SUITE}-grace-revoke`,
  });

  actAs(ORG_A);
  // The real merchant path: "Record reported opt-out" on the contact profile.
  for (const contactId of [ELLA, HANA]) {
    const recorded = await setContactConsent({
      contactId,
      action: "revoke",
      requestId: `${SUITE}-${contactId}-request`,
    });
    expect(recorded).toEqual({ ok: true });
  }
}, 120_000);

describe("#752 the fenced customer reads the same on all three pages", () => {
  it("says 'opted out before consent history' on the segments page, the contacts list and the profile", async () => {
    actAs(ORG_A);

    // 1. The segments page — the wording #750 settled on, unchanged by this ticket.
    expect(await segmentRowMarkup(CHANDRA)).toContain("opted out before consent history");

    // 2. The contacts list — this is what said "Unknown" before.
    const list = await contactsListMarkup(CHANDRA);
    expect(list).toContain("Chandra Nair");
    expect(list).toContain("Opted out before consent history");
    expect(list).not.toContain(">Unknown<");

    // 3. The contact profile — badge, and the reason spelled out, because the reason is not
    //    readable from the events card underneath: what fences this customer is the OLD column,
    //    which never becomes an event.
    const profile = await contactProfileMarkup(CHANDRA);
    expect(profile).toContain("Opted out before consent history");
    expect(profile).toContain(
      "Nothing in this consent history came from the customer, and an opt-out was recorded for this contact before the history was kept.",
    );
    expect(profile).toContain("keeps this contact out of audiences until the customer opts in again");
    expect(profile).not.toContain("The current state remains unknown.");
    expect(profile).not.toContain(">Unknown<");
  });

  it("keeps saying it when the merchant recorded the same opt-out again, which never lifts the fence", async () => {
    actAs(ORG_A);
    const detail = await getContact(HANA);
    if (!("ok" in detail)) throw new Error(detail.error);

    // Hana's history is NOT empty, so the reason cannot live only in the empty state.
    expect(detail.contact.consentEvents.length).toBeGreaterThan(0);
    expect(detail.contact.consentState.state).toBe("unknown");
    expect(detail.contact.consentState.unresolvedLegacyOptOut).toBe(true);

    const profile = await contactProfileMarkup(HANA);
    expect(profile).toContain("Opted out before consent history");
    expect(profile).toContain("until the customer opts in again through their own channel");

    // The note may not deny the record the same screen is showing. Hana's merchant-recorded
    // opt-out is rendered right underneath it, so a note that claims nothing was recorded makes
    // the page argue with itself — the profile has to be honest too, not only the segments page.
    expect(profile).toContain("Revoke recorded");
    expect(profile).not.toContain("No consent facts were recorded");

    // What is actually true of every fenced contact, Hana included: the ledger holds no stance
    // from the CUSTOMER (a merchant record is not one — the event card says `Merchant`), and the
    // old column carries an opt-out.
    expect(profile).toContain(
      "Nothing in this consent history came from the customer, and an opt-out was recorded for this contact before the history was kept.",
    );
    expect(await segmentRowMarkup(HANA)).toContain("opted out before consent history");
  });

  it("reads the fence through the one shared predicate, not a second copy of it", async () => {
    actAs(ORG_A);
    const listed = await listContacts({ limit: 100 });
    if (!("ok" in listed)) throw new Error(listed.error);
    const byId = new Map(listed.contacts.map((contact) => [contact.id, contact.consentState]));

    const preview = await previewSegment(NOT_CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    const fencedOnSegmentsPage = new Set(
      preview.contacts.filter((contact) => contact.unresolvedLegacyOptOut).map((c) => c.id),
    );
    const fencedOnContactsList = new Set(
      listed.contacts.filter((contact) => contact.consentState.unresolvedLegacyOptOut).map((c) => c.id),
    );

    expect([...fencedOnSegmentsPage].sort()).toEqual([CHANDRA, HANA].sort());
    expect([...fencedOnContactsList].sort()).toEqual([...fencedOnSegmentsPage].sort());
    // The one page that could see the ledger truth still reports it honestly underneath.
    expect(byId.get(CHANDRA)?.state).toBe("unknown");
  });
});

describe("#752 only the fenced customer changed her mouth", () => {
  it("still says Unknown for a contact with no consent record at all", async () => {
    actAs(ORG_A);
    const listed = await listContacts({ limit: 100 });
    if (!("ok" in listed)) throw new Error(listed.error);
    expect(listed.contacts.find((contact) => contact.id === BEN)?.consentState).toMatchObject({
      state: "unknown",
      unresolvedLegacyOptOut: false,
    });

    const list = await contactsListMarkup(BEN);
    expect(list).toContain(">Unknown<");
    expect(list).not.toContain("opted out before consent history");

    const profile = await contactProfileMarkup(BEN);
    expect(profile).toContain(">Unknown<");
    expect(profile).toContain("The current state remains unknown.");
    expect(profile).not.toContain("opted out before consent history");
  });

  it("still says Unknown for an opt-out only the merchant recorded, and still lets him reach her", async () => {
    actAs(ORG_A);
    const list = await contactsListMarkup(ELLA);
    expect(list).toContain(">Unknown<");
    expect(list).not.toContain("Opted out before consent history");

    // #496 option B is untouched: a merchant assertion is not verified evidence, so it does not
    // exclude anyone. The segments page keeps saying she is included, and so does this page.
    const preview = await previewSegment(CONTACTABLE);
    if (!("ok" in preview)) throw new Error(preview.error);
    expect(preview.contacts.find((contact) => contact.id === ELLA)?.contactable).toBe(true);
    expect(preview.contacts.find((contact) => contact.id === ELLA)?.reportedOptOut).toBe(true);
  });

  it("never lets the legacy column create consent it does not have", async () => {
    actAs(ORG_A);
    const listed = await listContacts({ limit: 100 });
    if (!("ok" in listed)) throw new Error(listed.error);

    // Iris carries `opt_in` in the legacy column and nothing else. The fence holds people OUT;
    // it may never put a verified opt-in badge on a customer who never gave one.
    const stored = await prisma.contact.findFirstOrThrow({ where: { id: IRIS, ownerId: ORG_A } });
    expect(stored.marketingConsent).toBe("opt_in");
    expect(listed.contacts.find((contact) => contact.id === IRIS)?.consentState).toMatchObject({
      state: "unknown",
      unresolvedLegacyOptOut: false,
    });
    expect(await contactsListMarkup(IRIS)).toContain(">Unknown<");
  });

  it("still says Opted out for a customer who opted out herself", async () => {
    actAs(ORG_A);
    const listed = await listContacts({ limit: 100 });
    if (!("ok" in listed)) throw new Error(listed.error);
    expect(listed.contacts.find((contact) => contact.id === GRACE)?.consentState).toMatchObject({
      state: "effective_revoke",
      unresolvedLegacyOptOut: false,
    });
    expect(await contactsListMarkup(GRACE)).toContain(">Opted out<");
  });

  it("does not move who the segments page selects", async () => {
    actAs(ORG_A);
    const contactable = await previewSegment(CONTACTABLE);
    if (!("ok" in contactable)) throw new Error(contactable.error);
    const excluded = await previewSegment(NOT_CONTACTABLE);
    if (!("ok" in excluded)) throw new Error(excluded.error);

    // Ben, Ella and Iris are reachable; Chandra, Hana and Grace are not — exactly as before
    // this ticket. Nothing here changed which contacts a broadcast could be sent to.
    expect(contactable.contacts.map((contact) => contact.id).sort()).toEqual([BEN, ELLA, IRIS].sort());
    expect(excluded.contacts.map((contact) => contact.id).sort()).toEqual([CHANDRA, HANA, GRACE].sort());
    expect(contactable.excludedByConsentCount).toBe(3);
    expect(contactable.unresolvedLegacyOptOutCount).toBe(2);
  });
});

describe("#752 two tenants", () => {
  it("keeps one tenant's fence inside that tenant", async () => {
    actAs(ORG_B);
    const listed = await listContacts({ limit: 100 });
    if (!("ok" in listed)) throw new Error(listed.error);

    // The other tenant's own fenced customer reads fenced for HIM, and his page carries no
    // trace of tenant A's contacts.
    expect(listed.contacts.map((contact) => contact.id)).toEqual([MEI]);
    expect(listed.contacts[0]?.consentState.unresolvedLegacyOptOut).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(CHANDRA);

    await expect(getContact(CHANDRA)).resolves.toEqual({ error: "Contact not found." });

    actAs(ORG_A);
    const mine = await listContacts({ limit: 100 });
    if (!("ok" in mine)) throw new Error(mine.error);
    expect(mine.contacts.map((contact) => contact.id)).not.toContain(MEI);
    expect(mine.contacts.find((contact) => contact.id === CHANDRA)?.consentState).toMatchObject({
      state: "unknown",
      unresolvedLegacyOptOut: true,
    });
  });
});
