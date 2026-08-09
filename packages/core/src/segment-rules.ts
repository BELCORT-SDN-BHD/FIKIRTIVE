/** Pure, serializable CRM segment rules. Groups are deliberately one level deep. */

export type SegmentLeafRule =
  | {
      kind: "lifetime_spend";
      comparison: "at_least" | "more_than";
      amountMyr: number;
    }
  | { kind: "last_order_recency"; withinDays: number }
  | { kind: "channel"; channel: string }
  | { kind: "tag"; tag: string }
  | { kind: "contactability"; value: "contactable" | "not_contactable" };

export type SegmentRuleGroup = {
  match: "all" | "any";
  rules: SegmentLeafRule[];
  /**
   * #758 — the merchant's optional, opt-in tightening: also leave out the contacts whose ONLY
   * opt-out is one the merchant recorded himself (#496 option B keeps those in by default,
   * because a merchant assertion is not customer-verified evidence).
   *
   * It travels with the rules on purpose. The rule group is the one thing every selecting path
   * already carries — the stored `Segment.rulesJson`, the segments page preview, the broadcast
   * freeze, Otto — so a second channel for this choice would be a second place for the answer to
   * differ, which is the defect #750 closed.
   *
   * The pure matcher below deliberately does NOT answer it: "did the merchant record an opt-out"
   * is a consent-ledger fact this module has no evidence for, and inventing a fact for it would
   * put a second copy of the consent rule down here. The selection gate that owns the consent
   * authority applies it (apps/web/lib/consent-authority.ts `selectedIntoAudience`), which is the
   * same one gate the segments page and the broadcast audience both go through.
   *
   * Canonical form carries the key only when it is on, so a segment saved before this option
   * existed and a segment saved with it off are the same stored bytes.
   */
  excludeReportedOptOut?: boolean;
};

export type SegmentCompileFailureReason =
  | "empty"
  | "ambiguous_join"
  | "unsupported_structure"
  | "unrecognized_clause"
  | "duplicate_clause";

export type SegmentCompileResult =
  | { ok: true; normalizedPhrase: string; rules: SegmentRuleGroup }
  | {
      ok: false;
      normalizedPhrase: string;
      reason: SegmentCompileFailureReason;
      uncompiledClauses: string[];
    };

export type SegmentRuleValidationResult =
  | { ok: true; value: SegmentRuleGroup }
  | { ok: false; error: string };

export type SegmentContactFacts = {
  lifetimeSpendMyr?: number;
  lastOrderAt?: string;
  channels?: readonly string[];
  tags?: readonly string[];
  marketingConsent?: "opt_in" | "opt_out" | "unknown";
  doNotDisturb?: boolean;
};

export type SegmentEvaluationContext = {
  /** Explicit instant: recency matching never reads the process clock. */
  evaluatedAt: string;
};

export type VipSegmentConfig = {
  vipMinSpendMyr: number;
  vipRecentOrderDays: number;
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...keys, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isDays(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNormalizedChannel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === normalizeText(value) &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
  );
}

function isNormalizedTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    value === normalizeText(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isLeafRule(value: unknown): value is SegmentLeafRule {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "lifetime_spend":
      return (
        hasOnlyKeys(value, ["kind", "comparison", "amountMyr"]) &&
        (value.comparison === "at_least" || value.comparison === "more_than") &&
        isAmount(value.amountMyr)
      );
    case "last_order_recency":
      return hasOnlyKeys(value, ["kind", "withinDays"]) && isDays(value.withinDays);
    case "channel":
      return hasOnlyKeys(value, ["kind", "channel"]) && isNormalizedChannel(value.channel);
    case "tag":
      return hasOnlyKeys(value, ["kind", "tag"]) && isNormalizedTag(value.tag);
    case "contactability":
      return (
        hasOnlyKeys(value, ["kind", "value"]) &&
        (value.value === "contactable" || value.value === "not_contactable")
      );
    default:
      return false;
  }
}

/** Runtime fence for JSON-loaded rules. Nested groups and empty groups fail closed. */
export function validateSegmentRuleGroup(input: unknown): SegmentRuleValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, ["match", "rules"], ["excludeReportedOptOut"])) {
    return { ok: false, error: "A segment needs one visible rule group." };
  }
  if (input.match !== "all" && input.match !== "any") {
    return { ok: false, error: "A segment group must match all or any rules." };
  }
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    return { ok: false, error: "A segment needs at least one rule." };
  }
  if (!input.rules.every(isLeafRule)) {
    return { ok: false, error: "A segment may contain one level of supported rules only." };
  }
  if (
    input.excludeReportedOptOut !== undefined &&
    typeof input.excludeReportedOptOut !== "boolean"
  ) {
    return { ok: false, error: "The reported opt-out exclusion is either on or off." };
  }
  // #758 — canonical form: the key exists only when the merchant turned the option ON. Off and
  // never-set are the same segment, so they must be the same stored bytes, or an unchanged
  // re-save would read as an edit (`samePayload`) and a replay would stop being a replay.
  const value: SegmentRuleGroup = { match: input.match, rules: input.rules as SegmentLeafRule[] };
  return input.excludeReportedOptOut === true
    ? { ok: true, value: { ...value, excludeReportedOptOut: true } }
    : { ok: true, value };
}

function failure(
  normalizedPhrase: string,
  reason: SegmentCompileFailureReason,
  uncompiledClauses: string[],
): SegmentCompileResult {
  return { ok: false, normalizedPhrase, reason, uncompiledClauses };
}

function parseAmount(raw: string): number | null {
  const amount = Number(raw.replace(/,/g, ""));
  return isAmount(amount) ? amount : null;
}

function parseTagClause(clause: string): SegmentLeafRule | null {
  const match = clause.match(/^tag(?:ged)?\s+(?:is\s+)?(.+)$/);
  if (!match) return null;
  const rawTag = match[1];
  if (!rawTag) return null;
  let tag = rawTag.trim();
  const quotePairs: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
  ];
  const opening = quotePairs.find(([start]) => tag.startsWith(start));
  if (opening) {
    if (!tag.endsWith(opening[1]) || tag.length <= opening[0].length + opening[1].length) return null;
    tag = tag.slice(opening[0].length, -opening[1].length);
  } else if (/["'“”]/.test(tag)) {
    return null;
  }
  tag = normalizeText(tag);
  return isNormalizedTag(tag) ? { kind: "tag", tag } : null;
}

function parseClause(clause: string): SegmentLeafRule | null {
  const spend = clause.match(
    /^(?:lifetime spend|spend|spent)\s+(at least|more than|over)\s+rm\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)$/,
  );
  if (spend) {
    const rawAmount = spend[2];
    if (!rawAmount) return null;
    const amountMyr = parseAmount(rawAmount);
    if (amountMyr === null) return null;
    return {
      kind: "lifetime_spend",
      comparison: spend[1] === "at least" ? "at_least" : "more_than",
      amountMyr,
    };
  }

  const recency = clause.match(
    /^(?:last order|ordered)\s+(?:was\s+)?(?:within|in)\s+(?:the\s+)?(?:last\s+)?([1-9][0-9]*)\s+days?$/,
  );
  if (recency) {
    const withinDays = Number(recency[1]);
    return isDays(withinDays) ? { kind: "last_order_recency", withinDays } : null;
  }

  const channel = clause.match(/^channel\s+is\s+([a-z0-9][a-z0-9_-]{0,63})$/);
  if (channel && isNormalizedChannel(channel[1])) return { kind: "channel", channel: channel[1] };

  const tag = parseTagClause(clause);
  if (tag) return tag;

  if (clause === "contactable" || clause === "okay to message") {
    return { kind: "contactability", value: "contactable" };
  }
  if (clause === "not contactable" || clause === "do not message") {
    return { kind: "contactability", value: "not_contactable" };
  }
  return null;
}

/**
 * Compile a deliberately small, explicit English grammar. Any unknown or ambiguous
 * clause rejects the whole phrase; nothing is guessed or silently discarded.
 */
export function compileSegmentPhrase(phrase: string): SegmentCompileResult {
  const normalizedPhrase = typeof phrase === "string" ? normalizeText(phrase) : "";
  if (!normalizedPhrase) return failure(normalizedPhrase, "empty", []);
  if (/[()[\]{}]/.test(normalizedPhrase)) {
    return failure(normalizedPhrase, "unsupported_structure", [normalizedPhrase]);
  }

  const hasAnd = /\sand\s/.test(normalizedPhrase);
  const hasOr = /\sor\s/.test(normalizedPhrase);
  if (hasAnd && hasOr) return failure(normalizedPhrase, "ambiguous_join", [normalizedPhrase]);

  const match: SegmentRuleGroup["match"] = hasOr ? "any" : "all";
  const clauses = hasOr
    ? normalizedPhrase.split(/\sor\s/)
    : hasAnd
      ? normalizedPhrase.split(/\sand\s/)
      : [normalizedPhrase];
  const rules: SegmentLeafRule[] = [];
  const uncompiledClauses: string[] = [];

  for (const clause of clauses) {
    const rule = parseClause(clause);
    if (!rule) uncompiledClauses.push(clause);
    else rules.push(rule);
  }
  if (uncompiledClauses.length > 0) {
    return failure(normalizedPhrase, "unrecognized_clause", uncompiledClauses);
  }

  const seen = new Set<string>();
  const duplicateClauses: string[] = [];
  rules.forEach((rule, index) => {
    const key = JSON.stringify(rule);
    const duplicateClause = clauses[index];
    if (seen.has(key) && duplicateClause) duplicateClauses.push(duplicateClause);
    seen.add(key);
  });
  if (duplicateClauses.length > 0) {
    return failure(normalizedPhrase, "duplicate_clause", duplicateClauses);
  }

  return { ok: true, normalizedPhrase, rules: { match, rules } };
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!parts) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6] ?? "0");
  const millisecond = Number((parts[7] ?? "").padEnd(3, "0") || "0");
  const offsetHour = Number(parts[10] ?? "0");
  const offsetMinute = Number(parts[11] ?? "0");
  if (offsetHour > 23 || offsetMinute > 59) return null;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;

  const offsetDirection = parts[9] === "-" ? -1 : 1;
  const offsetMs =
    parts[8] === "Z" ? 0 : offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const local = new Date(timestamp + offsetMs);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return timestamp;
}

function contactMatchesLeaf(
  contact: SegmentContactFacts,
  rule: SegmentLeafRule,
  context: SegmentEvaluationContext,
): boolean {
  switch (rule.kind) {
    case "lifetime_spend":
      if (!isAmount(contact.lifetimeSpendMyr)) return false;
      return rule.comparison === "at_least"
        ? contact.lifetimeSpendMyr >= rule.amountMyr
        : contact.lifetimeSpendMyr > rule.amountMyr;
    case "last_order_recency": {
      const lastOrderAt = parseInstant(contact.lastOrderAt);
      const evaluatedAt = parseInstant(context.evaluatedAt);
      if (lastOrderAt === null || evaluatedAt === null || lastOrderAt > evaluatedAt) return false;
      return (evaluatedAt - lastOrderAt) / 86_400_000 <= rule.withinDays;
    }
    case "channel":
      return (
        Array.isArray(contact.channels) &&
        contact.channels.every(isNormalizedChannel) &&
        contact.channels.includes(rule.channel)
      );
    case "tag":
      return Array.isArray(contact.tags) && contact.tags.every(isNormalizedTag) && contact.tags.includes(rule.tag);
    case "contactability": {
      if (
        !["opt_in", "opt_out", "unknown"].includes(contact.marketingConsent ?? "") ||
        typeof contact.doNotDisturb !== "boolean"
      ) {
        return false;
      }
      const contactable = contact.marketingConsent === "opt_in" && !contact.doNotDisturb;
      return rule.value === "contactable" ? contactable : !contactable;
    }
  }
}

/**
 * Pure matcher over explicit facts. Missing/invalid facts and invalid JSON rules do not match.
 *
 * `excludeReportedOptOut` is intentionally not applied here — see the field's note above. This
 * function answers "do these rules describe this contact"; whether the merchant also asked to
 * drop his own recorded opt-outs is a consent-authority decision, and the one gate that owns the
 * consent authority applies it around this call.
 */
export function contactMatchesRules(
  contact: SegmentContactFacts,
  rules: SegmentRuleGroup,
  context: SegmentEvaluationContext,
): boolean {
  const validated = validateSegmentRuleGroup(rules);
  if (!validated.ok || !isRecord(contact) || !isRecord(context)) return false;
  const results = validated.value.rules.map((rule) => contactMatchesLeaf(contact, rule, context));
  return validated.value.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** VIP is a caller-configured preset; this module intentionally owns no threshold defaults. */
export function buildVipSegmentRules(config: VipSegmentConfig): SegmentRuleGroup {
  if (!isAmount(config?.vipMinSpendMyr) || !isDays(config?.vipRecentOrderDays)) {
    throw new TypeError("VIP segment configuration needs a non-negative spend and positive whole days.");
  }
  return {
    match: "all",
    rules: [
      {
        kind: "lifetime_spend",
        comparison: "at_least",
        amountMyr: config.vipMinSpendMyr,
      },
      { kind: "last_order_recency", withinDays: config.vipRecentOrderDays },
    ],
  };
}
