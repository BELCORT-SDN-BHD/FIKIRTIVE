/**
 * routine-authorization-facts — the ONE definition of "what a Routine authorization says".
 *
 * The invariant (#720 判官 r2): **every fact that goes into the authorization hash must be on
 * the confirmation page in plain language, and nothing on the confirmation page may be outside
 * that set.** They are one set, so the display is DERIVED from the hash input rather than hand
 * listed beside it — the same "card face = fingerprint face" shape PR #749 used for campaign
 * generation. A new field added to `RoutineAuthorizationSnapshot` therefore cannot slip past
 * the merchant: it is not covered by any row here, so it comes back in `unexplained`, the
 * dialog refuses to confirm, and the pinboard test in
 * `lib/__tests__/routine-authorization-facts.test.ts` goes red.
 *
 * Two properties the pinboard enforces, together meaning display set == hash set:
 *   1. every key of a real snapshot is claimed by exactly the rows below (`unexplained` empty);
 *   2. changing ANY hashed field changes the rendered text — no field is claimed but ignored.
 *
 * Nothing here fabricates. An id that cannot be resolved to a name is reported as unresolved,
 * never silently dropped, and never replaced by a guess.
 */

// #728 — the channel spelling is one fact for the whole product; this file used to keep its own
// copy of the map. The copy happened to agree; a copy that happens to agree is exactly how the
// Inbox and Reports pages ended up disagreeing about the same channel.
import { channelLabel } from "./crm-labels";
// Same story one level down: this file kept its own copy of the humanising rule too. Every use
// here splices the result into a longer line, so it takes the shared rule's lowercase shape.
import { humanizeTokenPhrase as humanize } from "./machine-token";

export type ResolvedRef = { id: string; name: string | null };
export type ResolvedChannel = { channel: string; providerConnectionId: string | null; accountName: string | null };

export type ResolvedAuthorizationNames = {
  workspaceName: string | null;
  workflowName: string | null;
  contacts: ResolvedRef[];
  segments: ResolvedRef[];
  channels: ResolvedChannel[];
};

export type AuthorizationFactRow = { label: string; value: string };

export type AuthorizationFacts = {
  rows: AuthorizationFactRow[];
  /**
   * Hashed fields this build cannot state in plain language — either a field with no row, or a
   * field whose stored shape we cannot explain. Non-empty means the confirmation must fail
   * closed: a dialog that cannot say what it is authorizing must not be able to authorize it.
   */
  unexplained: string[];
};

type Snapshot = Record<string, unknown>;

const ACTION_LABELS: Record<string, string> = {
  conversation_reply: "Reply in a conversation",
  broadcast_run: "Start a broadcast handoff",
  wait: "Wait",
  complete: "Complete the journey",
};

/** Recognized summary-policy values, in the merchant's words. */
const SUMMARY_VALUE_COPY: Record<string, string> = {
  counts_only: "counts only — how many actions ran, and nothing about individual customers",
  workflow_activity: "a summary in workflow activity",
  none: "nothing",
};

const SUMMARY_FIELD_LABELS: Record<string, string> = {
  mode: "Detail",
  afterEachRun: "After each run",
  scope: "Covers",
  destination: "Shown in",
  schemaVersion: "Policy version",
  policy: "Policy",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action);
}

/** A short, stable tail of a fingerprint or id. Labelled in words wherever it is shown, so the
 *  merchant sees WHAT changed even though the value itself is not readable prose. Omitting it
 *  would make two different authorizations look identical, which is the failure this fixes. */
function shortRef(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

/** 判官 r3 P1-2 — the hash covers the whole instant, so the merchant sees the whole instant.
 *  Minute precision hid a difference the signature would still object to. */
function dateLabel(value: unknown): string {
  if (value === null || value === undefined) return "No expiry — this authorization does not lapse on its own";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return `Recorded as ${String(value)}`;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * 判官 r3 P1-2 — a name is not an identity. Nothing in the schema makes a customer name, a
 * segment name or a channel account's `displayName` unique, so two different authorizations
 * could read identically while their hashes differ. Every resolved reference therefore carries
 * its own short reference alongside the name: the name is what the merchant recognises, the
 * short reference is what makes two of them distinguishable. Unresolved references are listed
 * the same way rather than collapsed into a count.
 */
function namedRef(name: string, id: string): string {
  return `${name} (${shortRef(id)})`;
}

function refList(refs: ResolvedRef[], kind: string): string {
  if (refs.length === 0) return `No exact ${kind} references`;
  const resolved = refs.filter((ref) => ref.name !== null);
  const unresolved = refs.filter((ref) => ref.name === null);
  const parts: string[] = [];
  if (resolved.length > 0) {
    parts.push(resolved.map((ref) => namedRef(ref.name!, ref.id)).join(", "));
  }
  if (unresolved.length > 0) {
    const refsList = unresolved.map((ref) => shortRef(ref.id)).join(", ");
    parts.push(
      `${unresolved.length} ${kind} ${unresolved.length === 1 ? "reference" : "references"} we could not resolve to a name (${refsList})`,
    );
  }
  return parts.join(" · ");
}

function channelList(channels: ResolvedChannel[]): string {
  if (channels.length === 0) return "No channel";
  return channels
    .map((entry) => {
      if (entry.providerConnectionId === null) return `${channelLabel(entry.channel)} — any connected account`;
      const account = entry.accountName === null
        ? `an account we could not resolve to a name (${shortRef(entry.providerConnectionId)})`
        : namedRef(entry.accountName, entry.providerConnectionId);
      return `${channelLabel(entry.channel)} — ${account}`;
    })
    .join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countPhrase(value: unknown, noun: string): string {
  if (typeof value !== "number") return `? ${noun}s`;
  return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

/**
 * "Up to 1 action and 1 recipient per run" (#723).
 *
 * The Limits row of the hashed authorization facts and the draft envelope the merchant reviews
 * just above it are the same sentence, so it is written once. Both said "1 actions and 1
 * recipients" — and one action, one recipient is what the dialog itself defaults to, so the
 * plural-only form was the first sentence every merchant read. A count that is not a number is
 * still shown as "?", never invented.
 */
export function routineLimitsSummary(maxActions: unknown, maxRecipients: unknown): string {
  return `Up to ${countPhrase(maxActions, "action")} and ${countPhrase(maxRecipients, "recipient")} per run`;
}

/**
 * The stored summary policy, read as WIDE as it is written. The write path accepts any
 * non-empty JSON object and hashes it whole, so a reader that only understands five keys would
 * report a legitimately stored `{ policy: "x" }` as "no summary policy recorded" — a false
 * statement about a hashed fact. Recognized shapes get merchant copy; anything else is reported
 * honestly as recorded-but-unexplainable, which fails the confirmation closed.
 */
export function summaryPolicyFact(value: unknown): { text: string; explained: boolean } {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return { text: "No summary policy is recorded on this authorization.", explained: false };
  }
  const parts: string[] = [];
  let explained = true;
  for (const [key, raw] of Object.entries(value)) {
    const label = SUMMARY_FIELD_LABELS[key];
    if (label === undefined) {
      explained = false;
      parts.push(`${humanize(key)}: ${JSON.stringify(raw)}`);
      continue;
    }
    if (typeof raw === "string") {
      const copy = SUMMARY_VALUE_COPY[raw];
      if (copy === undefined) explained = false;
      parts.push(`${label}: ${copy ?? humanize(raw)}`);
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      parts.push(`${label}: ${String(raw)}`);
      continue;
    }
    explained = false;
    parts.push(`${label}: ${JSON.stringify(raw)}`);
  }
  const text = parts.join(" · ");
  return explained
    ? { text, explained: true }
    : {
        text: `${text} — this workspace recorded a summary setting we cannot explain in plain language.`,
        explained: false,
      };
}

type RowSpec = {
  label: string;
  /** The hashed snapshot fields this row accounts for. Every field must appear in some row. */
  fields: readonly string[];
  build: (snapshot: Snapshot, names: ResolvedAuthorizationNames) => string;
};

/** The confirmation page, in order. `fields` is the contract with the hash. */
const ROW_SPECS: readonly RowSpec[] = [
  {
    label: "Workspace",
    fields: ["ownerId"],
    build: (s, n) => `${n.workspaceName?.trim() || "This workspace"} (${shortRef(s.ownerId)})`,
  },
  {
    label: "Routine name",
    fields: ["routineKey"],
    build: (s) => String(s.routineKey ?? ""),
  },
  {
    label: "Workflow",
    fields: ["workflowDefinitionId"],
    build: (s, n) => `${n.workflowName?.trim() || "This workflow"} (${shortRef(s.workflowDefinitionId)})`,
  },
  {
    label: "Rule",
    fields: ["workflowRevision", "workflowRevisionId"],
    build: (s) => `Revision ${String(s.workflowRevision ?? "unknown")} (${shortRef(s.workflowRevisionId)})`,
  },
  {
    label: "Rule text",
    fields: ["workflowContentHash"],
    build: (s) => `Fingerprint ${shortRef(s.workflowContentHash)} — changes if the rule text changes`,
  },
  {
    label: "Rule depends on",
    fields: ["dependencyHash"],
    build: (s) => `Fingerprint ${shortRef(s.dependencyHash)} — changes if a template or segment it uses changes`,
  },
  {
    label: "Allowed work",
    fields: [],
    build: (s) => {
      const scope = isRecord(s.scopeJson) ? s.scopeJson : {};
      const actions = Array.isArray(scope.actionKinds) ? scope.actionKinds : [];
      return actions.map((action) => actionLabel(String(action))).join(", ") || "Nothing";
    },
  },
  {
    label: "Channel",
    fields: [],
    build: (_s, n) => channelList(n.channels),
  },
  {
    label: "Customers",
    fields: [],
    build: (_s, n) => refList(n.contacts, "customer"),
  },
  {
    label: "Segments",
    fields: [],
    build: (_s, n) => refList(n.segments, "segment"),
  },
  {
    label: "Limits",
    // scopeJson is one hashed field, and every part of it is displayed by the four rows above
    // plus this one. Listing it here keeps the coverage check total.
    fields: ["scopeJson"],
    build: (s) => {
      const scope = isRecord(s.scopeJson) ? s.scopeJson : {};
      return routineLimitsSummary(scope.maxActions, scope.maxRecipients);
    },
  },
  {
    label: "Budget",
    fields: ["maxCreditsPerRun", "maxCreditsPerMonth"],
    build: (s) => `${String(s.maxCreditsPerRun ?? "?")} credits per run · ${String(s.maxCreditsPerMonth ?? "?")} credits per month`,
  },
  {
    label: "Expiry",
    fields: ["expiresAt"],
    build: (s) => dateLabel(s.expiresAt),
  },
  {
    label: "Summary",
    fields: ["summaryPolicyJson"],
    build: (s) => summaryPolicyFact(s.summaryPolicyJson).text,
  },
  {
    label: "Authorization",
    fields: ["authorizationRevision"],
    build: (s) => `Number ${String(s.authorizationRevision ?? "?")} for this Routine name`,
  },
  {
    label: "Record format",
    fields: ["version"],
    build: (s) => String(s.version ?? "unknown"),
  },
];

/** Every hashed field the rows above account for. */
export const COVERED_AUTHORIZATION_FIELDS: ReadonlySet<string> = new Set(
  ROW_SPECS.flatMap((spec) => spec.fields),
);

/** The row labels, for tests and for anyone checking what the merchant is shown. */
export const AUTHORIZATION_ROW_LABELS: readonly string[] = ROW_SPECS.map((spec) => spec.label);

export function describeAuthorization(
  snapshot: Snapshot,
  names: ResolvedAuthorizationNames,
): AuthorizationFacts {
  const rows = ROW_SPECS.map((spec) => ({ label: spec.label, value: spec.build(snapshot, names) }));
  const unexplained = Object.keys(snapshot).filter((key) => !COVERED_AUTHORIZATION_FIELDS.has(key));
  if (!summaryPolicyFact(snapshot.summaryPolicyJson).explained && !unexplained.includes("summaryPolicyJson")) {
    unexplained.push("summaryPolicyJson");
  }
  return { rows, unexplained };
}
