/**
 * approval-card-view — the APPROVAL_CARD payload contract + PURE view model (B4 debt-70,
 * universal approval card chain, spec §五 5.1·附 touchpoint ①).
 *
 * R1 (frozen rider): the card must render WHAT is being consented to — channel / scheduled
 * time / caption summary — never a bare id. approvalCardView is the single source of that
 * rendering for the OttoApprovalCard component, and is pure so a node test asserts R1 directly.
 *
 * Client-safe: no server imports, no DB. The server (otto-actions) persists this payload shape;
 * the client renders it through approvalCardView. Skill human names come from TOOL_STEP_LABELS
 * (labelForTool, B9 契约4) so the card and the step trace speak the same language.
 */
import { approvalCardTitleLine, approvalDoneLine, approvalOutcomeLine } from "@fikirtive/core/schedule-draft";
import { labelForTool } from "./otto-stream-bridge";
import { socialPlatformLabel } from "./social-labels";

/**
 * Card lifecycle. `pending` is the only consumable state; everything else is TERMINAL and a card
 * never returns to `pending` (AR1 处方2 — consent is one-way).
 *
 * `failed` (#524 r5, judge r4 P1-A'②) is a terminal state reached only from `approved`: the consent
 * was spent and the run then died. It exists because "approved" alone is a lie in that case — the
 * merchant is looking at a card that says yes while nothing was delivered. Forward-only, so the
 * one-way rule holds.
 *
 * #524 r6 (judge r5 P1-A'②): `failed` says nothing about MONEY on its own, and r5's card copy
 * asserted "nothing was charged" on every one of them. That is not knowable from the LLM refund
 * alone — a resume executes the approved tool FIRST, so the tool can have created and paid for a
 * generation before the next model call threw. What was charged is carried separately, in
 * `chargeVerdict`, and only ever set to `zero` when the ledger PROVED it.
 */
export type ApprovalCardStatus = "pending" | "approved" | "rejected" | "expired" | "failed";

/** Every state a card can be READ BACK in once it is no longer awaiting the merchant. Derived, so
 *  a new terminal state can never be added to the lifecycle above without every surface that
 *  reports one having to acknowledge it (#524 r5). */
export type ApprovalCardResolution = Exclude<ApprovalCardStatus, "pending">;

/** What the user is consenting to (enriched server-side at park time, owner-scoped read). */
export type ApprovalCardSummary = {
  channel: string;
  caption: string;
  scheduledAt: string; // ISO instant
  scheduledTz: string; // IANA tz
  mediaCount: number;
};

export type ApprovalCardPayload = {
  toolName: string;
  ref: string;
  status: ApprovalCardStatus;
  summary: ApprovalCardSummary | null;
  /** SHA-256 of the material consent fields at mint time (AR1 处方2). Server-recomputed at
   *  approve; drift = hard refuse. Absent/null = fail-closed (unapprovable). */
  contentHash?: string | null;
  /** ISO instant after which the ASK is no longer confirmable (APPROVAL_CARD_TTL_MS). */
  expiresAt?: string | null;
  /**
   * Which try at approving this card we are on — 1-based, server-generated, absent = 1 (#524 r5,
   * judge r4 P1-A'①).
   *
   * The resume turn's reservation is keyed by it (`…:a<attempt>`), and the ledger's
   * `reserve:<refId>` idempotency key is globally unique. Before this field, every try at one card
   * reused ONE refId: an attempt that reserved, refunded, and left the card pending made the next
   * try collide (P2002) forever — the card said "Try again" and the ledger made that impossible.
   * A try that burned its refId bumps this, so the merchant's next click reserves under a fresh
   * one. Two clicks INSIDE one attempt still share a refId and stay idempotent: the second one's
   * reserve loses on that unique key and is answered benignly, having moved nothing.
   *
   * #524 r6 (judge r5 P1-A'①): this is a FAST PATH, not the authority. The attempt a retry actually
   * reserves under is derived from the LEDGER (`finalizedReservations`), which cannot be left stale
   * by a crash or a failed write the way this field can, and which is also right for the cards
   * minted before this field existed.
   */
  attempt?: number;
  /**
   * Only meaningful on a `failed` card: what the ledger could PROVE about this action's charges
   * (#524 r6, judge r5 P1-A'②).
   *
   * `"zero"` — proven free: this turn's hold was refunded in full AND no other credit was held for
   * this org from the moment that hold was taken, so no leg of the action charged anything.
   * `"unknown"` — not proven. Something else was held in that window (the approved tool may have
   * run and paid before the failure), or the ledger could not be read. Absent reads as `"unknown"`:
   * the fail-closed direction is the sentence that promises the merchant less.
   *
   * It exists because the two cases need DIFFERENT words, and only one of them may say "nothing was
   * charged". Guessing that sentence is worse than not saying it.
   */
  chargeVerdict?: "zero" | "unknown";
  /**
   * When the consent was SPENT — the instant the CAS moved this card `pending → approved`, as an
   * ISO instant (Founder 2026-08-18 follow-up).
   *
   * It exists because the recovery for a leaked approve lost its anchor. Until chat was priced at
   * 0 the resume turn took a credit HOLD before the model ran, so a process death in that window
   * left a stale RESERVE row the reaper could find, date and refund. A free turn writes no ledger
   * row at all, so the card is now the ONLY record that consent was spent — and `ChatMessage` has
   * no `updatedAt` column, so without this stamp nothing in the database says WHEN. `createdAt` is
   * mint time, and a card may be approved any time inside its 24-hour TTL, so sweeping on it would
   * either wait a day or retire a run that started ten seconds ago.
   *
   * Written once, by the claim (otto-actions claimApprovalCard). Absent on cards approved before
   * this shipped, and on those the card-state sweep stands down rather than guessing — the
   * fail-safe direction is a card that stays stale, never one retired over work that succeeded.
   */
  approvedAt?: string | null;
};

/** Structural parse of an unknown durable payload — null when it isn't an approval card. */
export function asApprovalCardPayload(v: unknown): ApprovalCardPayload | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.toolName !== "string" || typeof p.ref !== "string") return null;
  const status =
    p.status === "approved" || p.status === "rejected" || p.status === "expired" || p.status === "failed"
      ? p.status
      : "pending";
  let summary: ApprovalCardSummary | null = null;
  const s = p.summary as Record<string, unknown> | null | undefined;
  if (s && typeof s === "object" && typeof s.channel === "string" && typeof s.caption === "string") {
    summary = {
      channel: s.channel,
      caption: s.caption,
      scheduledAt: typeof s.scheduledAt === "string" ? s.scheduledAt : "",
      scheduledTz: typeof s.scheduledTz === "string" ? s.scheduledTz : "",
      mediaCount: typeof s.mediaCount === "number" ? s.mediaCount : 0,
    };
  }
  return {
    toolName: p.toolName,
    ref: p.ref,
    status,
    summary,
    contentHash: typeof p.contentHash === "string" ? p.contentHash : null,
    expiresAt: typeof p.expiresAt === "string" ? p.expiresAt : null,
    // A missing / malformed attempt reads as 1 — every card minted before #524 r5 is on its first
    // try, and a corrupt value must not be able to invent a refId nobody can reason about.
    attempt: Number.isInteger(p.attempt) && (p.attempt as number) >= 1 ? (p.attempt as number) : 1,
    // Anything but a literal proof reads as "unknown" — the arm whose sentence claims less.
    chargeVerdict: p.chargeVerdict === "zero" ? "zero" : "unknown",
    // Round-trips so a later payload rewrite cannot silently drop the one record of WHEN consent
    // was spent. A malformed value reads as absent, which stands the card-state sweep down.
    approvedAt: typeof p.approvedAt === "string" ? p.approvedAt : null,
  };
}

/**
 * The one sentence a resolved card puts in front of the merchant, so the card, the approve
 * response and the thread note cannot drift into three different claims (#524 r6).
 *
 * `failed` is the only status whose words depend on money, and it has exactly two: the proven one
 * and the honest one. "Nothing was charged" is said only when `chargeVerdict === "zero"`; otherwise
 * the merchant is told what is actually true — part of it may have been paid for — and where to
 * look (Billing is where the product lists charges; see CHAT_SPEND_NOTE).
 */
export function approvalCardResolutionText(payload: ApprovalCardPayload): string | null {
  switch (payload.status) {
    case "approved":
      // #851 landed while #524 was in flight and moved this sentence to the publish authority:
      // hardcoding it here made the card say "it will publish as scheduled" one line under a
      // detail line reading "nothing is sent". Delegating to the view keeps ONE approved sentence
      // for the card, the approve response and the thread note — and it stays right when the
      // publish switch flips, which a literal here never could.
      return approvalCardView(payload).approvedLine;
    case "rejected":
      return "Declined — nothing was published.";
    case "expired":
      return "This request expired — ask Otto to request approval again.";
    case "failed":
      return payload.chargeVerdict === "zero"
        ? "Approved, but it couldn't run — nothing was charged. Ask Otto to set it up again."
        : "Approved, but it couldn't finish — part of it may already have been charged. Check Billing, then ask Otto to set it up again.";
    default:
      return null;
  }
}

const CAPTION_EXCERPT_MAX = 180;

function formatScheduledAt(iso: string, tz: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(d);
    return tz ? `${formatted} (${tz})` : formatted;
  } catch {
    return d.toISOString();
  }
}

export type ApprovalCardView = {
  /** Sentence-case title naming the action being consented to. */
  title: string;
  /** R1 detail lines: channel / scheduled time / media count. Empty only when summary is missing. */
  detailLines: string[];
  /** Caption excerpt (the content being published), quoted separately from detailLines. */
  captionExcerpt: string | null;
  /** True when the details couldn't be loaded (post deleted etc.) — the card says so honestly. */
  summaryMissing: boolean;
  /** #851 — what the card says once the merchant has approved. It lives here, next to the title
   *  and the outcome line, because it is the same claim about the same act: the component used to
   *  hardcode "it will publish as scheduled" and contradict the line right above it. */
  approvedLine: string;
};

/** PURE view model for the card body. R1: consent object, never a bare id. */
export function approvalCardView(payload: ApprovalCardPayload): ApprovalCardView {
  if (payload.toolName === "approveScheduledPost" && payload.summary) {
    const s = payload.summary;
    const channel = socialPlatformLabel(s.channel);
    const when = formatScheduledAt(s.scheduledAt, s.scheduledTz);
    // #851 — the outcome line and the title come from the publish authority, not from this file.
    // This card is the last thing a merchant reads before consenting, so it is the last place that
    // may claim an outcome the product cannot deliver: while publishing is off it says the slot is
    // booked and nothing is sent, and the day it is switched back on it says "Publishes to …"
    // again with nothing here to edit.
    const detailLines = [
      approvalOutcomeLine(channel),
      ...(when ? [`Scheduled for ${when}`] : []),
      `${s.mediaCount} media item${s.mediaCount === 1 ? "" : "s"} attached`,
    ];
    const captionExcerpt =
      s.caption.length > CAPTION_EXCERPT_MAX ? `${s.caption.slice(0, CAPTION_EXCERPT_MAX)}…` : s.caption;
    return {
      title: approvalCardTitleLine(),
      detailLines,
      captionExcerpt,
      summaryMissing: false,
      approvedLine: approvalDoneLine(),
    };
  }
  if (payload.toolName === "approveScheduledPost") {
    return {
      title: approvalCardTitleLine(),
      detailLines: ["This post's details couldn't be loaded — it may have been deleted. Review your schedule before approving."],
      captionExcerpt: null,
      summaryMissing: true,
      approvedLine: approvalDoneLine(),
    };
  }
  // Future gated skills: name the action (TOOL_STEP_LABELS human name); never render just the ref.
  // Its approved line is deliberately NOT the publish one — a card for some other gated action was
  // being answered with "it will publish as scheduled", which is the wrong fact about a different act.
  return {
    title: "Otto is asking for your approval",
    detailLines: [`Action: ${labelForTool(payload.toolName) ?? payload.toolName}`],
    captionExcerpt: null,
    summaryMissing: payload.summary === null,
    approvedLine: "Approved — Otto is carrying on.",
  };
}
