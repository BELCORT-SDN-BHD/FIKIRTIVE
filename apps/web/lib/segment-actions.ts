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
  marketingConsent: true,
  doNotDisturb: true,
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
  marketingConsent: string;
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

function asConsent(value: string): SegmentContactFacts["marketingConsent"] {
  return value === "opt_in" || value === "opt_out" || value === "unknown" ? value : undefined;
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

function evaluateContact(row: ContactRow): EvaluatedContact {
  const channels = [
    ...new Set(
      row.identities
        .map((identity) => asChannel(identity.channel))
        .filter((channel): channel is string => channel !== null),
    ),
  ].sort();
  const marketingConsent = asConsent(row.marketingConsent) ?? "unknown";
  // Segment selection is not a send gate. R-010 keeps unknown consent in the merchant's
  // selected audience, and DND is enforced later by B7. Only a known opt-out is excluded
  // from this estimate.
  const contactable = marketingConsent !== "opt_out";

  return {
    id: row.id,
    name: row.name,
    channels,
    contactable,
    facts: {
      lifetimeSpendMyr: asLifetimeSpend(row.totalOrdersMyr),
      channels,
      marketingConsent,
      doNotDisturb: row.doNotDisturb,
    },
  };
}

async function readContacts(ownerId: string): Promise<EvaluatedContact[]> {
  const rows = await prisma.contact.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      ...CONTACT_SELECT,
      identities: {
        where: { ownerId, deletedAt: null },
        select: { channel: true },
      },
    },
  });
  return (rows as ContactRow[]).map(evaluateContact);
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
  return contacts.slice(0, 10).map(({ id, name, channels, contactable }) => ({
    id,
    name,
    channels,
    contactable,
  }));
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
      createdAt: row.createdAt.toISOString(),
    };
  }
  const matched = matches(contacts, validated.value, evaluatedAt);
  const contactableCount = matched.filter((contact) => contact.contactable).length;
  return {
    ...publicSegment(row, validated.value),
    status: "ready" as const,
    matchedCount: matched.length,
    contactableCount,
    knownOptOutCount: matched.length - contactableCount,
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
  const segment = evaluatedSegment(row, await readContacts(gate.ownerId), evaluatedAt);
  return { ok: true as const, evaluatedAt, segment, unavailableFacts: UNAVAILABLE_FACTS };
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
  const matched = matches(await readContacts(gate.ownerId), validated.value, evaluatedAt);
  const contactableCount = matched.filter((contact) => contact.contactable).length;
  return {
    ok: true as const,
    evaluatedAt,
    phrase: canonicalPhrase(validated.value),
    matchedCount: matched.length,
    contactableCount,
    knownOptOutCount: matched.length - contactableCount,
    contacts: publicContacts(matched),
    unavailableFacts: UNAVAILABLE_FACTS,
  };
}

/**
 * #718 — is another live segment of this merchant's already called this?
 *
 * Three cards all reading "WhatsApp big spenders" are three cards nobody can tell apart, and
 * the list only ever grew. Enforced in the application rather than as a database unique index
 * because an index needs a migration; the comparison is owner-scoped and case-insensitive, and
 * it always excludes the segment being saved so re-saving a segment under its own name (or
 * replaying a create) is never a clash. A deleted segment frees its name again.
 *
 * Returns `null` if the check itself could not run — the caller refuses rather than guessing.
 */
async function nameTaken(ownerId: string, segmentId: string, name: string): Promise<boolean | null> {
  try {
    const clashes = await prisma.segment.count({
      where: {
        ownerId,
        kind: "custom",
        deletedAt: null,
        id: { not: segmentId },
        name: { equals: name, mode: "insensitive" },
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
