/**
 * schedule-draft — the ONE shared, pure validator/normalizer for a scheduled-post DRAFT.
 *
 * The human server action (createScheduledPost) and the Otto skill (schedulePosts, via the
 * ctx.schedule port) BOTH run this, so channel capabilities / caption / datetime / timezone rules
 * can never diverge between the two write paths (the divergence #123 review flagged). Pure — no IO,
 * no prisma — so it lives in core and is unit-testable. The owner-scoped media-ownership check and
 * the DB write live in the server service (apps/web/lib/schedule-service.ts), the layer below this.
 */

/** Channels this slice supports (IG/FB until App Review adds more). */
export const SCHEDULE_CHANNELS = ["instagram", "facebook"] as const;
export type ScheduleChannel = (typeof SCHEDULE_CHANNELS)[number];

export function isScheduleChannel(x: unknown): x is ScheduleChannel {
  return typeof x === "string" && (SCHEDULE_CHANNELS as readonly string[]).includes(x);
}

/** Per-channel publishing capabilities the draft validation enforces on BOTH write paths.
 *  Keep maxMediaCount / supportsFirstComment in sync with the channel adapters
 *  (apps/web/lib/channels/*.ts) and the client mirror (apps/web/lib/channels/channel-meta.ts). */
export const SCHEDULE_CHANNEL_CAPS: Record<
  ScheduleChannel,
  { label: string; maxMediaCount: number; supportsFirstComment: boolean }
> = {
  instagram: { label: "Instagram", maxMediaCount: 10, supportsFirstComment: true },
  facebook: { label: "Facebook", maxMediaCount: 1, supportsFirstComment: false },
};

export type ScheduleDraftInput = {
  channel: string;
  caption: string;
  scheduledAt: string;
  scheduledTz: string;
  media?: string[];
  firstComment?: string | null;
  metaTargetId?: string | null;
};

export type NormalizedScheduleDraft = {
  channel: ScheduleChannel;
  caption: string;
  scheduledAt: Date;
  scheduledTz: string;
  media: string[];
  firstComment: string | null;
  metaTargetId: string | null;
};

const CAPTION_MAX = 2200;

/** Strict ISO-8601 instant WITH an explicit timezone designator (Z or ±HH:MM) → Date, else null.
 *  Rejects naive/local datetimes (e.g. "2026-07-10T09:00:00") that new Date() would parse in the
 *  server's local zone — the loose `z.string().min(1)` the Otto skill used let those through. */
export function parseScheduleInstant(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Validate an IANA time zone name via Intl (constructor throws on an unknown zone). */
export function isValidScheduleTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Pure validation + normalization for a scheduled-post draft. Returns the normalized values (used
 *  verbatim by the create) or a single sentence-case error string. */
export function validateScheduleDraft(
  input: ScheduleDraftInput,
): { ok: true; value: NormalizedScheduleDraft } | { error: string } {
  if (!isScheduleChannel(input?.channel)) return { error: "Pick a supported channel." };
  const channel = input.channel;
  const caps = SCHEDULE_CHANNEL_CAPS[channel];

  const caption = typeof input?.caption === "string" ? input.caption.trim() : "";
  if (!caption) return { error: "A post needs a caption." };
  if (caption.length > CAPTION_MAX) return { error: `A caption can be at most ${CAPTION_MAX} characters.` };

  const scheduledAt = typeof input?.scheduledAt === "string" ? parseScheduleInstant(input.scheduledAt.trim()) : null;
  if (!scheduledAt) return { error: "Pick a valid date and time (include a UTC offset)." };

  const scheduledTz = typeof input?.scheduledTz === "string" ? input.scheduledTz.trim() : "";
  if (!isValidScheduleTimeZone(scheduledTz)) return { error: "Pick a valid time zone." };

  const media = Array.isArray(input?.media) ? input.media.filter((m) => typeof m === "string" && m) : [];
  if (media.length > caps.maxMediaCount) {
    return {
      error:
        caps.maxMediaCount === 1
          ? `${caps.label} supports a single image or video, not a carousel.`
          : `A carousel can have at most ${caps.maxMediaCount} items.`,
    };
  }

  const firstComment = typeof input?.firstComment === "string" && input.firstComment.trim() ? input.firstComment : null;
  if (firstComment && !caps.supportsFirstComment) {
    return { error: `${caps.label} doesn't support a first comment.` };
  }
  if (firstComment && firstComment.length > CAPTION_MAX) {
    return { error: `A first comment can be at most ${CAPTION_MAX} characters.` };
  }

  const metaTargetId = typeof input?.metaTargetId === "string" && input.metaTargetId ? input.metaTargetId : null;

  return { ok: true, value: { channel, caption, scheduledAt, scheduledTz, media, firstComment, metaTargetId } };
}
