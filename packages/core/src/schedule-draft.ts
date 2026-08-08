/**
 * schedule-draft — the ONE shared, pure validator/normalizer for a scheduled-post DRAFT.
 *
 * The human server action (createScheduledPost) and the Otto skill (schedulePosts, via the
 * ctx.schedule port) BOTH run this, so channel capabilities / caption / datetime / timezone rules
 * can never diverge between the two write paths (the divergence #123 review flagged). Pure — no IO,
 * no prisma — so it lives in core and is unit-testable. The owner-scoped media-ownership check and
 * the DB write live in the server service (apps/web/lib/schedule-service.ts), the layer below this.
 */

/** Channels this slice supports. IG/FB are the Meta-org organic-publish channels; X (E4-14) is the
 *  generic ChannelConnection path. Adding a channel = extend this ONE closed set (契约6 登记式扩展点). */
export const SCHEDULE_CHANNELS = ["instagram", "facebook", "x"] as const;
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
  x: { label: "X", maxMediaCount: 0, supportsFirstComment: false },
};

/**
 * Said when a connection read FAILED — we could not find out which accounts are connected, so we
 * refuse (approving without checking would consent to a publish we can't validate) but we do NOT
 * blame the merchant's connection (#741 r3 P1). "Nothing connected" and "couldn't look" used to
 * come out of the same branch, so one flaky platform call told a perfectly connected merchant
 * they had no accounts. One sentence, every mouth: the server action refuses with it and Otto
 * answers with it, so no surface can invent a friendlier-sounding lie.
 */
export const ACCOUNTS_UNREADABLE_ERROR =
  "Couldn't check your connected accounts just now — try again in a moment.";

/**
 * A connection that EXISTS but cannot publish right now (#741 r5 P1).
 *
 * This is the third thing a connection read can find, and leaving it out is what made the product
 * contradict itself: both of these only happen when a MetaConnection row is already there, so the
 * Connections page says "Connected" / "Reconnect needed" while Schedule was telling the same
 * merchant to "Connect your account". They HAVE connected. Only a genuinely absent connection
 * ("notConnected") may ever be reported as an empty list.
 */
export type ConnectionBlocker = "needs_reconnect" | "needs_page_permission";

/**
 * The ONE wording for each of those states, in the two voices the product speaks:
 *   · `approve` — the "what is still missing" sentence, used by scheduleApproveBlockers below
 *     (so the server refusal and the composer's advance warning are the same string);
 *   · `status`  — the short label a connection row / picker shows. `needs_reconnect`'s label is
 *     deliberately the exact phrase the Connections page already shows, so "one fact, one set of
 *     words" is something a test can check rather than something a comment claims.
 */
export const CONNECTION_BLOCKER_COPY: Record<ConnectionBlocker, { approve: string; status: string }> = {
  needs_reconnect: {
    approve: "Reconnect your account before approving — its access expired.",
    status: "Reconnect needed",
  },
  needs_page_permission: {
    approve: "Reconnect and allow page access before approving.",
    status: "Page access needed",
  },
};

/** What a read of the merchant's Meta Pages found. The vocabulary every surface answers in. */
export type PagesReadState = "ok" | "not_connected" | "unreadable" | ConnectionBlocker;

/**
 * What one channel's connection read found, as carried to every consumer — the human screen AND
 * Otto. "ok" means the accompanying target list is that channel's whole truth; anything else means
 * it contributed nothing, and its absence from the list must NOT be read as "nothing connected".
 */
export type ChannelReadState = "ok" | "unreadable" | ConnectionBlocker;

/**
 * Classify the FAILURE side of any connection read — pages, ad accounts, insights, objects. Call it
 * once the caller has established the read did not succeed.
 *
 * This is the single authority that keeps "never connected" and "connected but unusable" apart. It
 * exists because six separate surfaces had independently written `"notConnected" in res ||
 * "needsReconnect" in res` and answered both with "Meta isn't connected yet" — one boolean OR per
 * file, each of them telling a merchant with a live-but-expired connection that they had never
 * connected at all.
 */
export function classifyConnectionFailure(
  read: Record<string, unknown>,
): "not_connected" | "unreadable" | ConnectionBlocker {
  if ("transientError" in read) return "unreadable";
  if ("needsReconnect" in read) return "needs_reconnect";
  if ("needsPageScope" in read) return "needs_page_permission";
  // `not_connected` is EARNED, never assumed: it is the one answer that licenses the product to
  // tell a merchant they have connected nothing, so only a read that actually says so gets it.
  // Anything this function does not recognise — a failure shape added upstream tomorrow — is
  // something we did not understand, which is exactly "we could not find out". Defaulting the
  // other way would silently turn every future failure mode back into the original lie.
  if ("notConnected" in read) return "not_connected";
  return "unreadable";
}

/** The same vocabulary for a Meta *pages* read, whose success key is `pages`. */
export function classifyPagesRead(read: Record<string, unknown>): PagesReadState {
  return "pages" in read ? "ok" : classifyConnectionFailure(read);
}

export type ScheduleApproveInput = {
  channel: string;
  /** The post's stored account id — null/empty when nobody has picked one yet. */
  targetId: string | null | undefined;
  mediaCount: number;
  /**
   * The account ids connected RIGHT NOW on this post's channel — the same list the server re-reads
   * from the channel adapter at approve time. Omit (or pass null) ONLY when the caller genuinely
   * hasn't read it yet: "not loaded" is not "not connected", and reporting it as such would scare a
   * merchant whose connection is fine. A stored id is worthless on its own — a merchant who
   * disconnected still has the old id sitting in the draft (#741 r1 P1).
   */
  connectedTargetIds?: readonly string[] | null;
  /**
   * Set when the connection EXISTS but can't publish right now. It outranks the "connect your
   * account" sentence, which would otherwise tell a merchant who has connected that they haven't
   * (#741 r5 P1). Absent/null ⇒ no such obstacle; the target rules below apply as before.
   */
  connectionBlocker?: ConnectionBlocker | null;
};

/** Everything still missing before a DRAFT may be approved (spec §五), in the order the composer
 *  presents the fields. Empty ⇒ approvable. Each entry is a finished merchant-facing sentence.
 *
 *  ONE rule, ONE set of sentences, every surface: the server action (approveScheduledPost), the
 *  composer's "Approve & schedule" button, and the plan card's "Approve all" summary read this.
 *  They used to diverge in the worst possible way (#695) — the button gated on BOTH conditions but
 *  explained only the first, so picking an account made the hint vanish and left the button
 *  silently greyed out with nothing on screen about the image that was actually missing.
 *  Pure, so it lives here with validateScheduleDraft. */
export function scheduleApproveBlockers(input: ScheduleApproveInput): string[] {
  const blockers: string[] = [];
  // `undefined` (caller hasn't looked) and `[]` (looked, found nothing connected) are different
  // facts and must produce different copy — hence the explicit null check rather than `?.length`.
  const live = input.connectedTargetIds ?? null;
  const targetId = input.targetId || null;
  if (input.connectionBlocker) {
    // They HAVE connected — the obstacle is the connection's current state, not its absence.
    blockers.push(CONNECTION_BLOCKER_COPY[input.connectionBlocker].approve);
  } else if (live && live.length === 0) {
    // Nothing to post to at all — reconnecting is the only way forward.
    blockers.push("Connect your account before approving.");
  } else if (!targetId) {
    blockers.push("Pick which account to post to before approving.");
  } else if (live && !live.includes(targetId)) {
    // An id the draft remembers but the connection no longer offers: the merchant disconnected, or
    // that page/account is gone. Same sentence the server answers with, so the UI can say it first.
    blockers.push("That account isn't one of your connected channels.");
  }
  // X supports text-only posts; Meta (IG/FB) organic publish is media-first in this slice, so the
  // ≥1-media requirement follows the channel's own cap (X's is 0) instead of naming X. An unknown
  // channel gets no media sentence — its own rejection is isScheduleChannel's job, not this one's.
  const caps = isScheduleChannel(input.channel) ? SCHEDULE_CHANNEL_CAPS[input.channel] : null;
  if (caps && caps.maxMediaCount > 0 && input.mediaCount === 0) {
    // Instagram is image-only (#229) — "or video" would mislead an IG owner into adding one.
    blockers.push(
      input.channel === "instagram"
        ? "Add at least one image before approving."
        : "Add at least one image or video before approving.",
    );
  }
  return blockers;
}

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
        caps.maxMediaCount === 0
          ? `${caps.label} posts are text-only for now.`
          : caps.maxMediaCount === 1
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
