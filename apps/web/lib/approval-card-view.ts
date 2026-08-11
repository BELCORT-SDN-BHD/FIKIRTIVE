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
import { approvalCardTitleLine, approvalOutcomeLine } from "@fikirtive/core/schedule-draft";
import { labelForTool } from "./otto-stream-bridge";
import { socialPlatformLabel } from "./social-labels";

export type ApprovalCardStatus = "pending" | "approved" | "rejected" | "expired";

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
};

/** Structural parse of an unknown durable payload — null when it isn't an approval card. */
export function asApprovalCardPayload(v: unknown): ApprovalCardPayload | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.toolName !== "string" || typeof p.ref !== "string") return null;
  const status =
    p.status === "approved" || p.status === "rejected" || p.status === "expired" ? p.status : "pending";
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
  };
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
    return { title: approvalCardTitleLine(), detailLines, captionExcerpt, summaryMissing: false };
  }
  if (payload.toolName === "approveScheduledPost") {
    return {
      title: approvalCardTitleLine(),
      detailLines: ["This post's details couldn't be loaded — it may have been deleted. Review your schedule before approving."],
      captionExcerpt: null,
      summaryMissing: true,
    };
  }
  // Future gated skills: name the action (TOOL_STEP_LABELS human name); never render just the ref.
  return {
    title: "Otto is asking for your approval",
    detailLines: [`Action: ${labelForTool(payload.toolName) ?? payload.toolName}`],
    captionExcerpt: null,
    summaryMissing: payload.summary === null,
  };
}
