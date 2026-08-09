"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  newId,
  validateSegmentRuleGroup,
  type SegmentContactFacts,
  type SegmentLeafRule,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import { prisma, type Prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import {
  consentFact,
  contactChannelFacts,
  contactConsentTruth,
  countExcludedByConsent,
  isKnownOptOut,
  readContactConsentTruth,
  selectedIntoAudience,
  type ContactConsentTruth,
} from "./consent-authority";
import { ownedContactsWhere } from "./crm-contact-scope";
import { isImpersonating } from "./better-auth/compat";

const SEGMENT_SELECT = {
  id: true,
  name: true,
  phrase: true,
  rulesJson: true,
  kind: true,
  createdAt: true,
} as const;

const SEGMENT_LIST_SELECT = {
  id: true,
  name: true,
  phrase: true,
  rulesJson: true,
  createdAt: true,
} as const;

const CONTACT_SELECT = {
  id: true,
  name: true,
  totalOrdersMyr: true,
  doNotDisturb: true,
  // Never an authority of its own (#726). Read for one thing only: the pre-ledger fence, which
  // can hold a customer out of an audience but can never put one in — see consent-authority.ts.
  marketingConsent: true,
} as const;

const GENERIC_SAVE_ERROR = "Couldn't save this segment. Start a new draft and try again.";
const GENERIC_UPDATE_ERROR = "Couldn't update this segment. Refresh and try again.";
const SEGMENT_NOT_FOUND = "Segment not found.";
const DUPLICATE_NAME_ERROR = "You already have a segment with this name. Choose a different name.";
/** #717 — the same bound the contact name already carries (crm-actions `text(value, 200)`).
 *  It was the one field in this convention without a limit, and one 300-character paste made
 *  the mobile Segments page scroll sideways forever. Bounded on the SERVER: a browser-only
 *  maxLength is a hint, not a rule. */
const MAX_SEGMENT_NAME = 200;
const TOO_LONG_NAME_ERROR = `Use ${MAX_SEGMENT_NAME} characters or fewer for the segment name.`;
const UNAVAILABLE_FACTS = { lastOrderAt: true, tags: true } as const;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DRAFT_PROOF_CONTEXT = "fikirtive:crm-segment-draft:v1";

type ContactRow = {
  id: string;
  name: string;
  totalOrdersMyr: unknown;
  doNotDisturb: boolean;
  marketingConsent: string;
  identities: Array<{ channel: string }>;
};

type SegmentRow = {
  id: string;
  name: string;
  phrase: string;
  rulesJson: unknown;
  kind?: string;
  createdAt: Date;
};

type EvaluatedContact = {
  id: string;
  name: string;
  channels: string[];
  contactable: boolean;
  consent: ContactConsentTruth;
  facts: SegmentContactFacts;
};

function formatAmount(amountMyr: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMyr);
}

function leafPhrase(rule: SegmentLeafRule): string {
  switch (rule.kind) {
    case "lifetime_spend":
      return `lifetime spend is ${rule.comparison === "at_least" ? "at least" : "more than"} RM${formatAmount(rule.amountMyr)}`;
    case "last_order_recency":
      return `last order was within ${rule.withinDays} ${rule.withinDays === 1 ? "day" : "days"}`;
    case "channel":
      return `channel is ${rule.channel}`;
    case "tag":
      return `tag is ${JSON.stringify(rule.tag)}`;
    case "contactability":
      return rule.value === "contactable"
        ? "contact is not a known opt-out"
        : "contact is a known opt-out";
  }
}

/**
 * #758 — the merchant's optional exclusion belongs in the sentence that describes the segment.
 * The phrase is the only thing the saved list shows besides the name, so a segment that quietly
 * drops contacts the phrase never mentions would be the page saying less than it does. The
 * wording says whose record it is (#768): it is the merchant's own, not the customer's.
 */
const REPORTED_OPT_OUT_EXCLUSION_PHRASE = "also excluding opt-outs you recorded yourself";

function canonicalPhrase(rules: SegmentRuleGroup): string {
  const joined = rules.rules.map(leafPhrase).join(rules.match === "all" ? " and " : " or ");
  const sentence = joined.charAt(0).toUpperCase() + joined.slice(1);
  const base = `${rules.match === "all" ? "All" : "Any"} of: ${sentence}`;
  return rules.excludeReportedOptOut === true
    ? `${base} — ${REPORTED_OPT_OUT_EXCLUSION_PHRASE}`
    : base;
}

function hasExactSpendPrecision(rules: SegmentRuleGroup): boolean {
  return rules.rules.every(
    (rule) => rule.kind !== "lifetime_spend" || Number(rule.amountMyr.toFixed(2)) === rule.amountMyr,
  );
}

function signDraft(ownerId: string, segmentId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify([DRAFT_PROOF_CONTEXT, ownerId, segmentId]))
    .digest("base64url");
}

function issueNextDraft(ownerId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to issue a segment draft.");
  const nextSegmentId = newId();
  return { nextSegmentId, nextSegmentProof: signDraft(ownerId, nextSegmentId, secret) };
}

function validDraftProof(ownerId: string, segmentId: string, proof: unknown): boolean {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || typeof proof !== "string") return false;
  const expected = Buffer.from(signDraft(ownerId, segmentId, secret));
  const supplied = Buffer.from(proof);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function asLifetimeSpend(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const amount = Number(String(value));
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function evaluateContact(row: ContactRow, truth: ContactConsentTruth): EvaluatedContact {
  // #806 r2 — shared with the broadcast audience, which used to build this fact from its own
  // run channel instead of the contact's. Two constructions meant two answers for one person.
  const channels = contactChannelFacts(row.identities);
  // Segment selection is not a send gate. R-010 keeps unknown consent in the merchant's
  // selected audience, and DND is enforced later by B7. Only a known opt-out is excluded
  // from this estimate — read through the one authority the broadcast freeze and the
  // send-eligibility engine also read (#726), never the legacy Contact column.
  const contactable = !isKnownOptOut(truth);

  return {
    id: row.id,
    name: row.name,
    channels,
    contactable,
    consent: truth,
    facts: {
      lifetimeSpendMyr: asLifetimeSpend(row.totalOrdersMyr),
      channels,
      marketingConsent: consentFact(truth),
      doNotDisturb: row.doNotDisturb,
    },
  };
}

/**
 * Every live contact this owner has, read through the same predicate the contacts list
 * pages and counts (#715). `contacts.length` is therefore the same total that page shows.
 * Consent comes from the shared authority (#726) so this page and the broadcast freeze can
 * never disagree about who has opted out.
 */
async function readContacts(ownerId: string): Promise<EvaluatedContact[]> {
  const [rows, truth] = await Promise.all([
    prisma.contact.findMany({
      where: ownedContactsWhere(ownerId),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        ...CONTACT_SELECT,
        identities: {
          where: { ownerId, deletedAt: null },
          select: { channel: true },
        },
      },
    }),
    readContactConsentTruth(prisma, ownerId),
  ]);
  return (rows as ContactRow[]).map((row) =>
    evaluateContact(row, contactConsentTruth(truth.get(row.id), row.marketingConsent)),
  );
}

function matches(
  contacts: EvaluatedContact[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
): EvaluatedContact[] {
  // The shared core matcher predates R-010 and models send-time contactability. At the Segment
  // boundary the consent authority owns that leaf (unknown stays included, DND never filters) —
  // and since #806 it owns the decision itself, so a segment that never mentions consent can no
  // longer admit a known opt-out by default. Same gate the broadcast audience uses, so a row
  // this page shows is still exactly a row the freeze turns into an audience member.
  return contacts.filter((contact) =>
    selectedIntoAudience(contact.consent, contact.facts, rules, evaluatedAt),
  );
}

/** How many matched contacts a preview shows. A preview is a sample, never the audience. */
const PREVIEW_CONTACT_LIMIT = 10;

function publicContacts(contacts: EvaluatedContact[]) {
  return contacts.map(({ id, name, channels, contactable, consent }) => ({
    id,
    name,
    channels,
    contactable,
    reportedOptOut: consent.reportedOptOut,
    // Which of the excluded are held out by the pre-ledger fence. The consent history on the
    // contact profile cannot explain this one — there are no events behind it — so the row the
    // merchant is already looking at has to say it itself (R-010 §4.6.5: visible, not hidden).
    unresolvedLegacyOptOut: consent.unresolvedLegacyOptOut,
  }));
}

/**
 * The preview's contact sample — the rows PLUS the fact that they were cut (#819, same root as
 * #742). The cut has always been there; what was missing is a place in the payload that SAYS so.
 * `matchedCount` alone leaves "are these ten everyone?" to be worked out by whoever is reading,
 * and Otto's port had nothing else to go on — so the ten rows could be reported as the whole
 * match. `returned` and `hasMore` travel with the rows, the way the counts travel with a contact
 * page in otto-contact-view: the shape holds the fact, not a sentence asking the model to
 * remember it. `returned` is stated rather than left to be counted — two counts are two answers.
 */
function previewContactSample(matched: EvaluatedContact[]) {
  const contacts = publicContacts(matched.slice(0, PREVIEW_CONTACT_LIMIT));
  return { contacts, returned: contacts.length, hasMore: matched.length > contacts.length };
}

/**
 * Merchant-recorded opt-outs this match KEPT. They stay in the audience (they are not verified
 * evidence), so the merchant has to be told they are there — #716's whole defect was that this
 * number existed nowhere on the page. A contact who is out on some other opt-out is not counted
 * here: the page must never call the same person "still included" and "excluded" in one line.
 */
function reportedOptOutCountOf(matched: EvaluatedContact[]): number {
  return matched.filter((contact) => contact.contactable && contact.consent.reportedOptOut).length;
}

/**
 * The counts every surface publishes for one match. `excludedByConsentCount` is the number the
 * merchant reads as "known opt-out excluded": people this segment would otherwise have reached
 * and the opt-out rule removed — the same arithmetic, over the same authority, that the
 * broadcast audience reports downstream (#726).
 *
 * The population is every contact the merchant has. A broadcast counts the same way over the
 * contacts IT can reach on its own channel, which is a smaller population; the two numbers are
 * therefore not interchangeable, and both surfaces print which population they counted.
 */
function countsOf(
  contacts: EvaluatedContact[],
  matched: EvaluatedContact[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
) {
  const matchedIds = new Set(matched.map((contact) => contact.id));
  const contactableCount = matched.filter((contact) => contact.contactable).length;
  const excluded = countExcludedByConsent(
    contacts.map((contact) => ({
      truth: contact.consent,
      selected: matchedIds.has(contact.id),
      facts: contact.facts,
    })),
    rules,
    evaluatedAt,
  );
  return {
    matchedCount: matched.length,
    contactableCount,
    knownOptOutCount: matched.length - contactableCount,
    excludedByConsentCount: excluded.excluded,
    unresolvedLegacyOptOutCount: excluded.unresolvedLegacy,
    reportedOptOutCount: reportedOptOutCountOf(matched),
    // #758 — how many the merchant's own optional exclusion removed. With the option off it is
    // zero and `reportedOptOutCount` carries the disclosure instead; the two are never both
    // about the same contact, so the page can print whichever one is the truth today.
    excludedByReportedOptOutCount: excluded.excludedByReportedOptOut,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function samePayload(row: SegmentRow, name: string, phrase: string, rules: SegmentRuleGroup): boolean {
  return (
    row.kind === "custom" &&
    row.name === name &&
    row.phrase === phrase &&
    stableJson(row.rulesJson) === stableJson(rules)
  );
}

function publicSegment(row: SegmentRow, rules: SegmentRuleGroup) {
  return {
    id: row.id,
    name: row.name,
    phrase: canonicalPhrase(rules),
    rules,
    createdAt: row.createdAt.toISOString(),
  };
}

function evaluatedSegment(row: SegmentRow, contacts: EvaluatedContact[], evaluatedAt: string) {
  const validated = validateSegmentRuleGroup(row.rulesJson);
  if (!validated.ok || !hasExactSpendPrecision(validated.value)) {
    return {
      id: row.id,
      name: row.name,
      phrase: "Rules unavailable",
      rules: null,
      status: "unavailable" as const,
      matchedCount: 0,
      contactableCount: 0,
      knownOptOutCount: 0,
      excludedByConsentCount: 0,
      unresolvedLegacyOptOutCount: 0,
      reportedOptOutCount: 0,
      excludedByReportedOptOutCount: 0,
      createdAt: row.createdAt.toISOString(),
    };
  }
  const matched = matches(contacts, validated.value, evaluatedAt);
  return {
    ...publicSegment(row, validated.value),
    status: "ready" as const,
    ...countsOf(contacts, matched, validated.value, evaluatedAt),
  };
}

export async function listSegments() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const evaluatedAt = new Date().toISOString();
  const [rows, contacts] = await Promise.all([
    prisma.segment.findMany({
      where: { ownerId: gate.ownerId, kind: "custom", deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: SEGMENT_LIST_SELECT,
    }),
    readContacts(gate.ownerId),
  ]);

  return {
    ok: true as const,
    evaluatedAt,
    ...issueNextDraft(gate.ownerId),
    segments: (rows as SegmentRow[]).map((row) => evaluatedSegment(row, contacts, evaluatedAt)),
    totalContactCount: contacts.length,
    unavailableFacts: UNAVAILABLE_FACTS,
  };
}

export async function getSegment(rawSegmentId: unknown) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (typeof rawSegmentId !== "string" || !ULID_PATTERN.test(rawSegmentId)) {
    return { error: SEGMENT_NOT_FOUND };
  }

  const row = (await prisma.segment.findFirst({
    where: { id: rawSegmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: null },
    select: SEGMENT_LIST_SELECT,
  })) as SegmentRow | null;
  if (!row) return { error: SEGMENT_NOT_FOUND };

  const evaluatedAt = new Date().toISOString();
  const contacts = await readContacts(gate.ownerId);
  const segment = evaluatedSegment(row, contacts, evaluatedAt);
  return {
    ok: true as const,
    evaluatedAt,
    segment,
    totalContactCount: contacts.length,
    unavailableFacts: UNAVAILABLE_FACTS,
  };
}

export async function previewSegment(rawRules: unknown) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const validated = validateSegmentRuleGroup(rawRules);
  if (!validated.ok) return { error: "Choose valid segment rules." };
  if (!hasExactSpendPrecision(validated.value)) {
    return { error: "Use no more than two decimal places for lifetime spend." };
  }

  const evaluatedAt = new Date().toISOString();
  const contacts = await readContacts(gate.ownerId);
  const matched = matches(contacts, validated.value, evaluatedAt);
  return {
    ok: true as const,
    evaluatedAt,
    phrase: canonicalPhrase(validated.value),
    ...countsOf(contacts, matched, validated.value, evaluatedAt),
    ...previewContactSample(matched),
    totalContactCount: contacts.length,
    unavailableFacts: UNAVAILABLE_FACTS,
  };
}

/**
 * Prisma compiles `{ equals, mode: "insensitive" }` to `name ILIKE $n` — MEASURED against this
 * repo's Prisma 7.8 client on 2026-08-08, not assumed. ILIKE is a PATTERN match, so `%` and `_`
 * inside a merchant's own name silently become wildcards: with "VIP buyers" on file, asking
 * whether "VIP %" is taken matched it and the merchant was refused a name nobody held (judge r1,
 * P2). Escaping them — plus the escape character itself, which is why `\` goes first — makes the
 * pattern literal, so the read means exactly what the unique index means: `lower(name) = lower($1)`.
 *
 * The coupling to that compilation is pinned by behaviour, not by trust: segment-lifecycle.test.ts
 * "#746 a name containing % or _ is compared literally" asserts BOTH directions against the real
 * database — a name with a wildcard character may be created, and a true duplicate of it is still
 * refused in the ordinary words. If Prisma ever stops emitting ILIKE, the second half goes red.
 */
function literalName(name: string): string {
  return name.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * #718 — is another live segment of this merchant's already called this?
 *
 * Three cards all reading "WhatsApp big spenders" are three cards nobody can tell apart, and
 * the list only ever grew. The comparison is owner-scoped and case-insensitive, and it always
 * excludes the segment being saved so re-saving a segment under its own name (or replaying a
 * create) is never a clash. A deleted segment frees its name again.
 *
 * #746 — this read is no longer the enforcement. The rule now lives in a unique index,
 * ("ownerId", lower("name")) among live rows, which is what actually keeps two concurrent saves
 * from both landing. This function has two jobs left, both about words: ask first so the ordinary
 * case gets a sentence instead of a failure, and — after a write the database refused — answer
 * WHY, so the merchant hears the same sentence either way.
 *
 * It therefore has to ask the same question the index answers, or it will say one thing while the
 * database does another. That is why there is no `kind` filter here (judge r1, P1): the index is
 * unique across every kind, because the broadcast composer lists every kind and shows nothing but
 * the name. A merchant who picks a name some other kind already holds is owed the plain sentence
 * up front, not a refusal from the write.
 *
 * Returns `null` if the check itself could not run — the caller refuses rather than guessing.
 */
async function nameTaken(ownerId: string, segmentId: string, name: string): Promise<boolean | null> {
  try {
    const clashes = await prisma.segment.count({
      where: {
        ownerId,
        deletedAt: null,
        id: { not: segmentId },
        name: { equals: literalName(name), mode: "insensitive" },
      },
    });
    return clashes > 0;
  } catch {
    return null;
  }
}

/**
 * Remove a segment from the merchant's workspace — a SOFT delete (#718).
 *
 * Every read in this file, plus the broadcast and workflow services, already filters on
 * `deletedAt: null`; nothing wrote it. Setting it is therefore the whole fix, and it keeps the
 * row for the record: a broadcast that already froze its audience keeps its own snapshot, and
 * an automation still scoped to this segment fails closed at its next run rather than sending
 * to a stale audience.
 */
export async function deleteSegment(raw: unknown) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) {
    return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  }

  const segmentId = (raw as { segmentId?: unknown })?.segmentId;
  if (typeof segmentId !== "string" || !ULID_PATTERN.test(segmentId)) {
    return { error: SEGMENT_NOT_FOUND };
  }

  try {
    const removed = await prisma.segment.updateMany({
      where: { id: segmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (removed.count > 0) {
      revalidatePath("/crm/segments");
      return { ok: true as const, idempotent: false as const };
    }
    // Nothing live matched: either this is a replay of a delete that already landed, or the id
    // is not this merchant's — which reports the same "not found" as any other tenant's id.
    const alreadyGone = await prisma.segment.findFirst({
      where: { id: segmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: { not: null } },
      select: { id: true },
    });
    if (!alreadyGone) return { error: SEGMENT_NOT_FOUND };
    revalidatePath("/crm/segments");
    return { ok: true as const, idempotent: true as const };
  } catch {
    return { error: GENERIC_UPDATE_ERROR };
  }
}

export async function buildSegment(raw: unknown) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) {
    return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  }

  const input = raw as {
    operation?: unknown;
    segmentId?: unknown;
    segmentProof?: unknown;
    name?: unknown;
    rules?: unknown;
  };
  const operation = input?.operation === undefined ? "create" : input.operation;
  if (operation !== "create" && operation !== "update") {
    return { error: "Choose create or update for this segment." };
  }
  if (typeof input.segmentId !== "string" || !ULID_PATTERN.test(input.segmentId)) {
    return { error: operation === "create" ? "Start a new segment draft and try again." : SEGMENT_NOT_FOUND };
  }
  if (operation === "create" && !validDraftProof(gate.ownerId, input.segmentId, input.segmentProof)) {
    return { error: "Start a new segment draft and try again." };
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { error: "Give this segment a name." };
  if (name.length > MAX_SEGMENT_NAME) return { error: TOO_LONG_NAME_ERROR };
  const validated = validateSegmentRuleGroup(input.rules);
  if (!validated.ok) return { error: "Choose valid segment rules." };
  if (!hasExactSpendPrecision(validated.value)) {
    return { error: "Use no more than two decimal places for lifetime spend." };
  }

  const phrase = canonicalPhrase(validated.value);
  const where = { id: input.segmentId, ownerId: gate.ownerId, deletedAt: null };
  const existing = (await prisma.segment.findFirst({
    where: operation === "update" ? { ...where, kind: "custom" } : where,
    select: SEGMENT_SELECT,
  })) as SegmentRow | null;

  if (operation === "update") {
    if (!existing) return { error: SEGMENT_NOT_FOUND };
    if (samePayload(existing, name, phrase, validated.value)) {
      revalidatePath("/crm/segments");
      return {
        ok: true as const,
        idempotent: true as const,
        operation: "update" as const,
        segment: publicSegment(existing, validated.value),
      };
    }

    const clash = await nameTaken(gate.ownerId, input.segmentId, name);
    if (clash === null) return { error: GENERIC_UPDATE_ERROR };
    if (clash) return { error: DUPLICATE_NAME_ERROR };

    try {
      const updated = await prisma.segment.updateMany({
        where: { id: input.segmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: null },
        data: {
          name,
          phrase,
          rulesJson: validated.value as unknown as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) return { error: GENERIC_UPDATE_ERROR };
      revalidatePath("/crm/segments");
      return {
        ok: true as const,
        idempotent: false as const,
        operation: "update" as const,
        segment: publicSegment(
          { ...existing, name, phrase, rulesJson: validated.value },
          validated.value,
        ),
      };
    } catch {
      const retried = (await prisma.segment.findFirst({
        where: { id: input.segmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: null },
        select: SEGMENT_SELECT,
      })) as SegmentRow | null;
      if (retried && samePayload(retried, name, phrase, validated.value)) {
        revalidatePath("/crm/segments");
        return {
          ok: true as const,
          idempotent: true as const,
          operation: "update" as const,
          segment: publicSegment(retried, validated.value),
        };
      }
      // #746 — the rename did not land and the segment still carries its old name. If another
      // live segment of this merchant's now holds the name, that is the reason, and it is owed
      // in the same words the pre-check uses. The reason is re-read from the database, never
      // guessed from the shape of the driver's error.
      if (retried && (await nameTaken(gate.ownerId, input.segmentId, name))) {
        return { error: DUPLICATE_NAME_ERROR };
      }
      return { error: GENERIC_UPDATE_ERROR };
    }
  }

  if (existing) {
    if (!samePayload(existing, name, phrase, validated.value)) return { error: GENERIC_SAVE_ERROR };
    revalidatePath("/crm/segments");
    return {
      ok: true as const,
      idempotent: true as const,
      operation: "create" as const,
      segment: publicSegment(existing, validated.value),
      ...issueNextDraft(gate.ownerId),
    };
  }

  const clash = await nameTaken(gate.ownerId, input.segmentId, name);
  if (clash === null) return { error: GENERIC_SAVE_ERROR };
  if (clash) return { error: DUPLICATE_NAME_ERROR };

  try {
    const created = (await prisma.segment.create({
      data: {
        id: input.segmentId,
        ownerId: gate.ownerId,
        name,
        phrase,
        rulesJson: validated.value as unknown as Prisma.InputJsonValue,
        kind: "custom",
      },
      select: SEGMENT_SELECT,
    })) as SegmentRow;
    revalidatePath("/crm/segments");
    return {
      ok: true as const,
      idempotent: false as const,
      operation: "create" as const,
      segment: publicSegment(created, validated.value),
      ...issueNextDraft(gate.ownerId),
    };
  } catch {
    const raced = (await prisma.segment.findFirst({ where, select: SEGMENT_SELECT })) as SegmentRow | null;
    if (raced && samePayload(raced, name, phrase, validated.value)) {
      revalidatePath("/crm/segments");
      return {
        ok: true as const,
        idempotent: true as const,
        operation: "create" as const,
        segment: publicSegment(raced, validated.value),
        ...issueNextDraft(gate.ownerId),
      };
    }
    // #746 — nothing was written under this id, so the insert itself was refused. If the name
    // is now held by another live segment of this merchant's, the unique index is why, and the
    // merchant hears the ordinary sentence rather than "start a new draft". A collision on the
    // id instead (`raced` present, different payload) is a different accident and keeps the
    // generic wording, so a cross-tenant id can still never be identified from the answer.
    if (!raced && (await nameTaken(gate.ownerId, input.segmentId, name))) {
      return { error: DUPLICATE_NAME_ERROR };
    }
    return { error: GENERIC_SAVE_ERROR };
  }
}
