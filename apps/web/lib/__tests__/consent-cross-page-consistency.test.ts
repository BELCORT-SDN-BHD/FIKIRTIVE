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
const ORG_C = `${SUITE}-org-c`;
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
/**
 * Same marketing fence, and the customer HERSELF spoke — about another purpose. The profile reads
 * its consent state from the whatsapp × marketing projection alone (`crm-view-data.contactSelect`)
 * but lists events from EVERY channel and purpose (`getContact`), so this is the one shape where a
 * verified customer grant and the fence are on screen together.
 *
 * She lives in her own tenant on purpose: the selection counts pinned further down must stay
 * byte-for-byte what they were, because this ticket may not move who a broadcast reaches.
 */
const PRIYA = `${SUITE}-priya`;
/**
 * The same fence, told from the world where the legacy opt-out WAS the customer's own act: she
 * unsubscribed herself in the merchant's previous system, and the migration carried the column
 * across without an actor because R-010 forbids inventing one (`legacy_contact_snapshot` is fixed
 * at `legacy_unknown / unresolved` — "actor/channel/purpose/evidence 不猜").
 *
 * Nothing in the data tells her apart from Chandra, and that is the whole point: the note is
 * rendered from the same fence, so it may not say anything about what the customer did or did not
 * do in life. It has been wrong three times by trying.
 */
const SITI = `${SUITE}-siti`;

/**
 * The exact words the profile must carry, pinned as a literal rather than imported from the source
 * — an imported constant would silently follow the next rewrite instead of catching it.
 */
const FENCE_NOTE =
  "This history has no WhatsApp marketing decision from the customer, and an opt-out was recorded before it began. When Fikirtive evaluates segment rules for WhatsApp marketing, it counts this contact as opted out until the customer opts in through their own channel.";

/**
 * Every earlier wording, kept as a permanent regression fence. Each was rejected for claiming
 * something the ledger cannot prove:
 *  - r1 denied records that were on the same screen;
 *  - r2 claimed the customer was silent, while another purpose carried her own verified grant;
 *  - r3 claimed she "has never" decided, which the ledger cannot know, and "again" presupposed a
 *    first opt-in it also cannot see;
 *  - r4 promised a gate that, when #752 shipped, the product did not have at all — the fence
 *    reached the matcher only as a fact, so the channel-only segment below selected her anyway.
 *    #806/#807 built that gate, and the case below is now inverted to prove it. r4's wording stays
 *    banned on a narrower ground: a merchant who deliberately segments on "known opt-out" still
 *    gets her (and the send gate is what holds there), so "out of audiences" still overclaims.
 *
 * The needle for r4 is the bare `out of audiences`, which bans the claim ANYWHERE on the profile.
 * It was briefly narrowed to `out of audiences until` because the same false promise also lived in
 * the empty state of `contact-profile-page.tsx`; that copy was fixed in #752's own commit, so the
 * needle is back to full width and no phrasing of the promise can return by either route.
 */
const REJECTED_CLAIMS = [
  "No consent facts were recorded",
  "Nothing in this consent history came from the customer",
  "has never opted in or out",
  "opts in again",
  "out of audiences",
];

/** The segment a merchant uses to look at the people who are held out. */
const NOT_CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "not_contactable" as const }],
};
const CONTACTABLE = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};
/**
 * A perfectly legal segment that never asks about contactability. When #768 shipped, the fence was
 * only ever consulted by translating it into the `marketingConsent` FACT, so a rule set that did
 * not test that fact never consulted it and the fenced customer WAS selected — the shape that
 * disproved r4's "kept out of audiences". #806 turned the fence into a gate
 * (`consent-authority.selectedIntoAudience`), so she is no longer selected here; the case below is
 * kept, inverted, as the permanent proof of which way this shape now resolves.
 */
const CHANNEL_ONLY = {
  match: "all" as const,
  rules: [{ kind: "channel" as const, channel: "whatsapp" }],
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

  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }, { id: ORG_C }] });
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
  await seedContact(PRIYA, ORG_C, "Priya Raman", "opt_out");
  // Data-identical to Chandra by design — see SITI. Same tenant as Priya so tenant A's selection
  // counts, pinned further down, stay exactly as they were.
  await seedContact(SITI, ORG_C, "Siti Abdullah", "opt_out");

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

  // Priya opted IN herself — to review requests, not to marketing. R-010 keeps each purpose in its
  // own tuple, and the consent runtime mirrors only whatsapp × marketing into the legacy column
  // (`consent-runtime.ts:441`), so this verified customer grant leaves the marketing fence exactly
  // where it was — while putting a customer-authored event card on the profile.
  await recordConsentEvent({
    ownerId: ORG_C,
    contactId: PRIYA,
    channel: "whatsapp",
    purpose: "review_request",
    sourceKind: "explicit_inbox_optin",
    action: "grant",
    evidenceRef: `${SUITE}-priya-inbox-optin`,
    idempotencyKey: `${SUITE}-priya-review-grant`,
  });

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
    expect(profile).toContain(FENCE_NOTE);
    expect(profile).not.toContain("The current state remains unknown.");
    expect(profile).not.toContain(">Unknown<");
    // Chandra has no events, so the empty state renders here too — it is part of the same screen
    // and is held to the same standard as the note above it.
    for (const claim of REJECTED_CLAIMS) expect(profile).not.toContain(claim);
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

    // The note may not deny the record the same screen is showing. Hana's merchant-recorded
    // opt-out is rendered right underneath it, so a note that claims nothing was recorded makes
    // the page argue with itself — the profile has to be honest too, not only the segments page.
    expect(profile).toContain("Revoke recorded");

    // What the ledger can prove about Hana: no whatsapp × marketing decision recorded from the
    // CUSTOMER (a merchant record is not one — the event card says `Merchant`), and the old column
    // carries an opt-out from before this history.
    expect(profile).toContain(FENCE_NOTE);
    for (const claim of REJECTED_CLAIMS) expect(profile).not.toContain(claim);
    expect(await segmentRowMarkup(HANA)).toContain("opted out before consent history");
  });

  it("stays true when the customer opted in to another purpose, which the marketing fence never sees", async () => {
    actAs(ORG_C);
    const detail = await getContact(PRIYA);
    if (!("ok" in detail)) throw new Error(detail.error);

    // The shape the note has to survive: the badge state is read from whatsapp × marketing alone,
    // but the events card below it is scoped to NOTHING — `getContact` lists every channel and
    // purpose. So a verified grant from the customer herself renders under a marketing fence.
    expect(detail.contact.consentState.state).toBe("unknown");
    expect(detail.contact.consentState.unresolvedLegacyOptOut).toBe(true);
    expect(detail.contact.consentEvents).toHaveLength(1);
    expect(detail.contact.consentEvents[0]).toMatchObject({
      purpose: "review_request",
      action: "grant",
      actorKind: "customer",
      evidenceStatus: "verified",
    });

    const profile = await contactProfileMarkup(PRIYA);
    // Both on one screen: the customer's own verified grant, and the fence note.
    expect(profile).toContain("Grant recorded");
    // #728 — the row still has to name the purpose (that is what stops the fence note from
    // contradicting the card above it), but it names it in the merchant's words now, from the
    // one CRM label authority. The stored token is asserted on the read above; it must not
    // reach the page.
    expect(profile).toContain("Review request");
    expect(profile).not.toContain("review_request");
    expect(profile).toContain(">Customer<");
    expect(profile).toContain(">Verified<");
    expect(profile).toContain("Opted out before consent history");

    // The note has to name the one tuple it actually read. An unscoped claim about the customer's
    // silence is flatly disproved by the card right above it.
    expect(profile).toContain(FENCE_NOTE);
    for (const claim of REJECTED_CLAIMS) expect(profile).not.toContain(claim);
  });

  it("says nothing that would be false if the legacy opt-out was the customer's own act", async () => {
    // Siti unsubscribed herself in the merchant's previous system. The migration kept the claim
    // and refused to invent an actor for it (R-010: `legacy_contact_snapshot` is fixed at
    // `legacy_unknown / unresolved`, "actor 不猜"), so the fence that results is byte-identical to
    // Chandra's, whose opt-out nobody can attribute either.
    actAs(ORG_C);
    const siti = await getContact(SITI);
    if (!("ok" in siti)) throw new Error(siti.error);
    actAs(ORG_A);
    const chandra = await getContact(CHANDRA);
    if (!("ok" in chandra)) throw new Error(chandra.error);

    // The product genuinely cannot tell the two worlds apart — so a sentence that is true for one
    // and false for the other is a sentence the product is not entitled to write.
    expect(siti.contact.consentState).toEqual(chandra.contact.consentState);
    expect(siti.contact.consentEvents).toHaveLength(0);

    actAs(ORG_C);
    const profile = await contactProfileMarkup(SITI);

    // Every rejected wording, checked FIRST: in Siti's world each one is a false statement the
    // page would be putting in front of the merchant.
    for (const claim of REJECTED_CLAIMS) expect(profile).not.toContain(claim);

    // What survives says only what the ledger holds: this history records no marketing decision
    // from her, and an opt-out predates the history. Neither denies that she made it herself.
    expect(profile).toContain(FENCE_NOTE);
    expect(profile).toContain("Opted out before consent history");
  });

  it("keeps the promise it made: a channel-only segment no longer selects her (#806)", async () => {
    actAs(ORG_A);

    // The world r4's wording denied, now closed. When #768 wrote this note the fence reached the
    // matcher ONLY as the `marketingConsent` fact, so a rule set that never mentions
    // contactability selected her anyway and a broadcast froze her in with
    // `includedByMerchant: true`. #806 made the fence a gate, so this shape resolves the other
    // way — and the case stays here, inverted, so nothing can quietly re-open it.
    const channelOnly = await previewSegment(CHANNEL_ONLY);
    if (!("ok" in channelOnly)) throw new Error(channelOnly.error);
    expect(channelOnly.contacts.find((contact) => contact.id === CHANDRA)).toBeUndefined();
    // Not silently dropped: she is reported as held out by the consent authority, and as one of
    // the ones the pre-ledger fence is holding.
    expect(channelOnly.excludedByConsentCount).toBeGreaterThanOrEqual(1);
    expect(channelOnly.unresolvedLegacyOptOutCount).toBeGreaterThanOrEqual(1);

    // The one selection she still belongs to is the one a merchant deliberately built out of
    // opt-outs — unchanged, and still the reason the note says "counts as opted out" rather than
    // promising she is kept out of every audience.
    const excluded = await previewSegment(NOT_CONTACTABLE);
    if (!("ok" in excluded)) throw new Error(excluded.error);
    const stillListed = excluded.contacts.find((contact) => contact.id === CHANDRA);
    expect(stillListed).toBeDefined();
    expect(stillListed?.unresolvedLegacyOptOut).toBe(true);
    expect(stillListed?.contactable).toBe(false);

    const profile = await contactProfileMarkup(CHANDRA);
    expect(profile).toContain(FENCE_NOTE);
    for (const claim of REJECTED_CLAIMS) expect(profile).not.toContain(claim);
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
