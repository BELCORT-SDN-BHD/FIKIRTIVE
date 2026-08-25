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

// ── Can a post actually reach a social account today? (#851) ─────────────────────────────────
//
// Right now: no. Facebook Login is switched off at the app level (#554), so NO merchant can
// connect Instagram or Facebook at all — a post written here has nowhere to go, however carefully
// it is written or approved. Founder's beta ruling (#850 ②) says the same thing from the product
// side: beta stops at "planned and saved", never "sent".
//
// The schedule itself is NOT a preview, and that boundary is the whole point of this section. The
// posts, their dates and times, and every approval are real rows the merchant owns and will find
// exactly as they left them. "The calendar is real, the sending is not" is ONE sentence, said
// once, by every surface a merchant could mistake for a send button: the Schedule screen, the
// approval card Otto mints, and Otto's own publishing skills.
//
// Turning publishing back on is ONE line — PUBLISHING_AVAILABLE below. Every surface reads its
// words through publishSurfaceCopy() / approvalOutcomeLine() / ottoPublishTruth(), so flipping
// that line changes what merchants read and hear with no second wording to hunt down. That is the
// reason the copy lives in core rather than on each screen: this product's oldest failure mode is
// a promise that outlives the thing it was promising.

/**
 * Can a post actually reach Instagram or Facebook right now?
 *
 * Annotated `boolean` on purpose. Left to infer, it would have the literal type `false`, and
 * TypeScript would then treat the "publishing is on" half of every branch below as dead code —
 * so the day we flip this line would begin with a compiler error instead of a working product.
 */
export const PUBLISHING_AVAILABLE: boolean = false;

/** The one word a publish surface wears while publishing is off. */
export const PUBLISH_PREVIEW_BADGE = "Preview";

/**
 * What every publish surface says, in four parts so a cramped surface can take just the first one
 * and a roomy one can say the whole thing — without anybody writing a shorter version by hand.
 */
export type PublishSurfaceCopy = {
  /** ① The plain fact about what does or does not happen. Short enough to stand alone. */
  readonly fact: string;
  /** ② Why that is so. */
  readonly why: string;
  /** ③ The boundary — what IS real and stays real. */
  readonly real: string;
  /** ④ What comes next. Never a date: a date is a promise we are not in a position to make. */
  readonly next: string;
};

/** While publishing is off. Read the four sentences in order — they are meant to be read that way. */
export const PUBLISH_PREVIEW_COPY: PublishSurfaceCopy = {
  fact: "Publishing is not switched on yet — nothing here goes out to Instagram or Facebook.",
  why: "No Instagram or Facebook account can be connected at the moment, so a post has nowhere to go.",
  real: "Your schedule is real: the posts you write, the dates and times you pick, and every approval are saved, and they stay exactly as you left them.",
  next: "Switching publishing on is what we are doing next, and we are not putting a date on it here.",
};

/** Once publishing is on. The same four slots, so no surface needs a second layout. */
export const PUBLISH_LIVE_COPY: PublishSurfaceCopy = {
  fact: "Approved posts go out to the account you picked, at the time you picked.",
  why: "Auto-publish sends them without you watching; with it off, an approved post waits here for you.",
  real: "Nothing leaves this workspace until you approve it.",
  next: "You can change or cancel a post any time before its slot.",
};

/**
 * The words for a given state. The parameter defaults to the current state, so a surface calls it
 * with no argument — and a fence can pin BOTH halves of the switch without flipping a global.
 */
export function publishSurfaceCopy(available: boolean = PUBLISHING_AVAILABLE): PublishSurfaceCopy {
  return available ? PUBLISH_LIVE_COPY : PUBLISH_PREVIEW_COPY;
}

/** The same four sentences in reading order, for a surface that renders them as a block. */
export function publishSurfaceLines(available: boolean = PUBLISHING_AVAILABLE): readonly string[] {
  const copy = publishSurfaceCopy(available);
  return [copy.fact, copy.why, copy.real, copy.next];
}

/** The badge a publish surface wears, or null once there is nothing to warn about. */
export function publishPreviewBadge(available: boolean = PUBLISHING_AVAILABLE): string | null {
  return available ? null : PUBLISH_PREVIEW_BADGE;
}

/**
 * One line naming what approving does to THIS post, on the channel it is written for. The approval
 * card shows it as its first detail line — the line a merchant reads while deciding to press a
 * button that used to claim it published.
 */
export function approvalOutcomeLine(
  channelLabel: string,
  available: boolean = PUBLISHING_AVAILABLE,
): string {
  return available
    ? `Publishes to ${channelLabel}`
    : `Booked for ${channelLabel} — publishing is not switched on, so nothing is sent`;
}

/** The title of that card. It must not name an outcome the product cannot deliver. */
export function approvalCardTitleLine(available: boolean = PUBLISHING_AVAILABLE): string {
  return available ? "Approve this post for publishing" : "Approve this post for its slot";
}

/**
 * What that same card says AFTER the merchant presses Approve.
 *
 * The card's own "what am I consenting to" lines already came from here, but its success state did
 * not: it said "Approved — it will publish as scheduled." one line under a detail line that says
 * nothing is sent. One card, two answers, and the contradicting half was the one a merchant reads
 * having just acted. A resolved state is still a publish surface, so it reads from the same switch
 * as the unresolved one.
 */
export function approvalDoneLine(available: boolean = PUBLISHING_AVAILABLE): string {
  return available
    ? "Approved — it will publish as scheduled."
    : "Approved — the slot is booked. Publishing is not switched on yet, so nothing is sent.";
}

/**
 * What Otto is told about publishing, wherever a skill of its could imply a post goes out.
 *
 * Same authority as the screens, so the assistant and the buttons cannot tell a merchant two
 * different stories about the same act (#851 ③ — Otto must never send anyone off to connect a
 * channel that cannot be connected).
 */
export function ottoPublishTruth(available: boolean = PUBLISHING_AVAILABLE): string {
  return available
    ? "Approving is consent to a real, irreversible publish to the user's own Instagram or Facebook account at the post's scheduled time."
    : "Publishing is NOT switched on: approving a post books its slot and saves it, and it sends nothing to Instagram or Facebook. No account can be connected either, so never tell the user that connecting one will make a post go out. Say this plainly whenever a post's fate comes up, never suggest a post leaves the workspace, and give no date for when publishing returns.";
}

/**
 * The one line about publishing that somebody WITHOUT an account reads.
 *
 * The sign-in gate and the sign-up card are the only two screens a visitor can reach, and they are
 * the two screens nobody remembers to revisit. The old wording on them was pinned sentence by
 * sentence in tests (#791-5 / #805 / #851 ⑥); the R22 rewrite replaced those pages wholesale, and
 * the pinned sentences went with them — including the half that made the claim conditional on this
 * switch. Founder ruling 2026-08-25: retire the sentence-level pins, keep the MECHANISM. That is
 * this function: the public pages hold no publishing wording of their own, so the day
 * PUBLISHING_AVAILABLE flips, what a visitor reads changes with it and nobody has to remember.
 *
 * Deliberately shorter than publishSurfaceCopy(). Those four sentences speak to a merchant who
 * already has a schedule ("Your schedule is real…"); a visitor has none yet, so the same words
 * would be describing something they cannot see. Same switch, different reader.
 */
export function publicPublishLine(available: boolean = PUBLISHING_AVAILABLE): string {
  return available
    ? "Each approved post publishes to the Instagram or Facebook account you picked, at the time you picked."
    : "Approved posts land in your schedule at the time you picked. Publishing is not switched on yet, so nothing is sent to Instagram or Facebook.";
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
