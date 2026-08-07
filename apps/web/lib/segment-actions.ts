"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  contactMatchesRules,
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
  countExcludedByConsent,
  isKnownOptOut,
  NO_CONSENT_RECORD,
  readContactConsentTruth,
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
} as const;

const GENERIC_SAVE_ERROR = "Couldn't save this segment. Start a new draft and try again.";
const GENERIC_UPDATE_ERROR = "Couldn't update this segment. Refresh and try again.";
const UNAVAILABLE_FACTS = { lastOrderAt: true, tags: true } as const;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DRAFT_PROOF_CONTEXT = "fikirtive:crm-segment-draft:v1";

type ContactRow = {
  id: string;
  name: string;
  totalOrdersMyr: unknown;
  doNotDisturb: boolean;
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
  /** The merchant's own record says "opted out" — unverified, so still in the audience. */
  reportedOptOut: boolean;
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

function canonicalPhrase(rules: SegmentRuleGroup): string {
  const joined = rules.rules.map(leafPhrase).join(rules.match === "all" ? " and " : " or ");
  const sentence = joined.charAt(0).toUpperCase() + joined.slice(1);
  return `${rules.match === "all" ? "All" : "Any"} of: ${sentence}`;
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

function asChannel(value: string): string | null {
  const channel = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(channel) ? channel : null;
}

function evaluateContact(row: ContactRow, truth: ContactConsentTruth): EvaluatedContact {
  const channels = [
    ...new Set(
      row.identities
        .map((identity) => asChannel(identity.channel))
        .filter((channel): channel is string => channel !== null),
    ),
  ].sort();
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
    reportedOptOut: truth.reportedOptOut,
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
    evaluateContact(row, truth.get(row.id) ?? NO_CONSENT_RECORD),
  );
}

function matches(
  contacts: EvaluatedContact[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
): EvaluatedContact[] {
  return contacts.filter((contact) =>
    contactMatchesRules(
      {
        ...contact.facts,
        // The shared core matcher predates R-010 and models send-time contactability.
        // At the Segment boundary, normalize that leaf to audience-selection semantics:
        // unknown stays included, known opt-out is excluded, and DND never filters.
        marketingConsent: contact.contactable ? "opt_in" : "opt_out",
        doNotDisturb: false,
      },
      rules,
      { evaluatedAt },
    ),
  );
}

function publicContacts(contacts: EvaluatedContact[]) {
  return contacts.slice(0, 10).map(({ id, name, channels, contactable, reportedOptOut }) => ({
    id,
    name,
    channels,
    contactable,
    reportedOptOut,
  }));
}

/**
 * Merchant-recorded opt-outs inside this match. They stay in the audience (they are not
 * verified evidence), so the merchant has to be told they are there — #716's whole defect was
 * that this number existed nowhere on the page.
 */
function reportedOptOutCountOf(matched: EvaluatedContact[]): number {
  return matched.filter((contact) => contact.reportedOptOut).length;
}

/**
 * The counts every surface publishes for one match. `excludedByConsentCount` is the number the
 * merchant reads as "known opt-out excluded": people this segment would otherwise have reached
 * and the opt-out rule removed — the same arithmetic, over the same authority, that the
 * broadcast audience reports downstream (#726).
 */
function countsOf(
  contacts: EvaluatedContact[],
  matched: EvaluatedContact[],
  rules: SegmentRuleGroup,
  evaluatedAt: string,
) {
  const matchedIds = new Set(matched.map((contact) => contact.id));
  const contactableCount = matched.filter((contact) => contact.contactable).length;
  return {
    matchedCount: matched.length,
    contactableCount,
    knownOptOutCount: matched.length - contactableCount,
    excludedByConsentCount: countExcludedByConsent(
      contacts.map((contact) => ({
        knownOptOut: !contact.contactable,
        matched: matchedIds.has(contact.id),
        facts: contact.facts,
      })),
      rules,
      evaluatedAt,
    ),
    reportedOptOutCount: reportedOptOutCountOf(matched),
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
      reportedOptOutCount: 0,
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
    return { error: "Segment not found." };
  }

  const row = (await prisma.segment.findFirst({
    where: { id: rawSegmentId, ownerId: gate.ownerId, kind: "custom", deletedAt: null },
    select: SEGMENT_LIST_SELECT,
  })) as SegmentRow | null;
  if (!row) return { error: "Segment not found." };

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
    contacts: publicContacts(matched),
    totalContactCount: contacts.length,
    unavailableFacts: UNAVAILABLE_FACTS,
  };
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
    return { error: operation === "create" ? "Start a new segment draft and try again." : "Segment not found." };
  }
  if (operation === "create" && !validDraftProof(gate.ownerId, input.segmentId, input.segmentProof)) {
    return { error: "Start a new segment draft and try again." };
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { error: "Give this segment a name." };
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
    if (!existing) return { error: "Segment not found." };
    if (samePayload(existing, name, phrase, validated.value)) {
      revalidatePath("/crm/segments");
      return {
        ok: true as const,
        idempotent: true as const,
        operation: "update" as const,
        segment: publicSegment(existing, validated.value),
      };
    }

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
      if (!retried || !samePayload(retried, name, phrase, validated.value)) {
        return { error: GENERIC_UPDATE_ERROR };
      }
      revalidatePath("/crm/segments");
      return {
        ok: true as const,
        idempotent: true as const,
        operation: "update" as const,
        segment: publicSegment(retried, validated.value),
      };
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
    if (!raced || !samePayload(raced, name, phrase, validated.value)) {
      return { error: GENERIC_SAVE_ERROR };
    }
    revalidatePath("/crm/segments");
    return {
      ok: true as const,
      idempotent: true as const,
      operation: "create" as const,
      segment: publicSegment(raced, validated.value),
      ...issueNextDraft(gate.ownerId),
    };
  }
}
