# Schedule — design spec (Buffer-like social scheduler, OTTO-driven)

Date: 2026-06-30 · Builds third / largest · Phased (A → B → C)

## Goal
A Buffer-like scheduler for **Instagram + Facebook**, driven by OTTO, for
non-technical SMB owners: build/queue posts, see them on a week/month calendar,
and have them **auto-publish at the scheduled time**. OTTO proposes posts + best
times and can fill a cadence ("post every day / 3× a week"); the owner approves;
approved posts publish automatically (or, when auto-publish is off, ping the owner
to publish). gb skin; coral = OTTO only.

## Hard external constraints (these bound the design — verified via research)
1. **Instagram has no native scheduling.** Publishing is immediate (create media
   container → publish). "Scheduling" = **our own timed scheduler** stores the post
   and calls publish at the chosen time. (Facebook Pages *do* support native
   `scheduled_publish_time`, but we run ONE unified scheduler for both.)
2. **Rate limit: 25 published posts / 24h (rolling) per IG account** (a carousel = 1;
   reels/stories count). We must enforce it (check `GET /{ig-id}/content_publishing_limit`).
3. **App Review prerequisite**: auto-publishing needs `instagram_content_publish`
   (+ `pages_manage_posts` for FB), approved by Meta (screencast + use-case,
   ~1–4 weeks). Our app has *read* scope today. **Build proceeds now; live publish
   switches on when review passes** (founder submits in parallel).
4. **IG Business accounts only** (not Creator/Personal). Reels with music / Stories
   with stickers/links can't auto-publish → **reminder fallback** (Phase B).
5. Carousels ≤ 10 items.

## Data model — `ScheduledPost` (new, owner-scoped)
```
ScheduledPost {
  id, ownerId, projectId
  channel: "instagram" | "facebook"
  metaTargetId            // connected IG business id / FB page id
  caption: string
  mediaGenerationIds: string[]   // REUSE existing generations (already paid) — 1 = single, 2..10 = carousel
  firstComment?: string          // hashtags etc., published as the first comment
  scheduledAt: DateTime          // UTC; owner's tz stored in settings
  status: DRAFT | SCHEDULED | PUBLISHING | PUBLISHED | FAILED | NEEDS_ATTENTION
  publishMode: AUTO | REMINDER
  metaPostId?: string            // set after publish
  lastError?: string
  source: "otto" | "owner"
  approvedAt?: DateTime          // null until the owner approves → only then eligible to queue
  createdAt, updatedAt
}
```
- Media is **referenced**, never re-generated — no new fal spend on the Schedule path.
- A post is eligible for the scheduler ONLY when `status = SCHEDULED` AND
  `approvedAt != null` (the owner's approval = the publish consent).

## Components

### 1. Scheduler worker — `apps/worker/src/jobs/publish.ts` (new)
- A pg-boss timed/cron consumer (e.g. polls every minute, or scheduled jobs keyed
  to `scheduledAt`). On fire:
  1. **Atomically claim** the post (SCHEDULED+approved → PUBLISHING) in a tx with a
     guard so two workers can't both claim it (no double-post) — same fail-closed
     discipline as the gen worker; if already PUBLISHING/PUBLISHED, skip.
  2. **Rate-limit check** via `content_publishing_limit`; if at 25/24h → defer +
     mark NEEDS_ATTENTION with a clear reason.
  3. **Publish** via `meta-publish-actions` (below). Success → PUBLISHED + `metaPostId`
     (+ post the first comment). Transient failure → bounded retry then NEEDS_ATTENTION.
  4. **publishMode = REMINDER** (Phase B / unsupported content) → don't publish;
     notify the owner ("time to post X — open IG").
- Idempotent: a `metaPostId` already set ⇒ never re-publish (resume = no double charge/post).

### 2. Organic publish — `apps/web/lib/meta-publish-actions.ts` (new, separate from the ADS meta-write-actions)
- IG: `createMediaContainer(image|carousel)` → poll container ready → `publishMedia`.
- FB: page feed post (image/link).
- Reuses the existing Meta OAuth/token + pages plumbing; adds the publish scopes.
- Phase A: IG **feed image + carousel**, FB **feed image**. (Reels/Stories = Phase B.)

### 3. Schedule page UI (replaces the `ComingSoon` branch)
Matches the locked mockup (`docs/ui-rework-mockups/schedule.html`):
- Header: "Schedule" + **connected IG/FB chips** (or a Connect card if not connected)
  + **OTTO auto-publish toggle** (reads/writes the OwnerSettings `autoPublish`) +
  Week/Month toggle.
- **OTTO best-time nudge banner** (Phase B for the real "best time"; Phase A shows
  OTTO cadence proposals: "want me to fill this week?").
- **Calendar** (week default): each day shows its posts as cards (channel icon,
  time, thumbnail, status pill: Draft / Scheduled / Posted / Needs attention). "+"
  on a day opens the composer at that day.
- **Composer** (add/edit a post): media picker (from canvas / My Stuff — existing
  generations), caption (write or "ask OTTO"), channel(s), date+time, first comment.
  Save as Draft or "Approve & schedule".

### 4. OTTO integration
- OTTO can **propose** posts and a **cadence**. The owner says "post every day" /
  "3× a week" → OTTO drafts a week of `ScheduledPost`s (status DRAFT, source otto)
  at sensible times, surfaced as a **plan card** (like the existing ad plan-card /
  `OttoPlanCard` pattern) — owner reviews and **Approve all** or tweak/approve each.
- A new OTTO skill (`defineOttoSkill`, fail-closed gate) — e.g. `schedulePosts` —
  that creates DRAFT ScheduledPosts (NO publish, NO spend; it only drafts). Publish
  happens later via the scheduler after owner approval.

## Flow & state machine
```
(OTTO proposes | owner builds) → DRAFT
   owner approves            → SCHEDULED (approvedAt set)
   scheduler fires, claims   → PUBLISHING
     publish ok              → PUBLISHED (metaPostId, + first comment)
     transient fail          → retry → NEEDS_ATTENTION
     reminder mode           → NEEDS_ATTENTION (notify owner)
```

## Money / safety
- **No fal spend on the Schedule path** — media reuses already-paid generations;
  organic publishing is a free Meta API call. No do-not-touch money files.
- **Public-content consent**: a post is NEVER queued/published without
  `approvedAt` (the owner's explicit approval — per post or per approved batch).
  This satisfies the "publishing public content needs explicit permission" rule.
- **Guardrails**: atomic claim (no double-post), idempotent on `metaPostId`,
  rate-limit enforcement, wrong-time guard (don't fire a post whose `scheduledAt`
  is far in the past without re-confirm), and auto-publish is a per-owner toggle
  the owner controls.
- Connecting IG/FB + granting publish scope = the owner's OAuth action.

## Phasing (build order; not feature-cutting)
- **Phase A (this spec's build)**: connect IG/FB · ScheduledPost model · the
  scheduler worker · organic publish (IG feed image+carousel, FB feed image) ·
  calendar (week/month) + composer · drafts · first comment · OTTO propose +
  cadence + approve · auto-publish toggle (AUTO vs REMINDER). App-review-gated for
  live publish.
- **Phase B**: Reels + Stories (+ reminder fallback for music/stickers) ·
  real "best time to post" (smart scheduling) · cadence auto-fill polish · bulk.
- **Phase C**: deeper Analytics tie-in (post-level performance back onto the
  calendar) · multi-user approval roles (if ever needed) · more channels.

## Out of scope (Phase A)
Reels/Stories auto-publish, best-time AI, channels beyond IG/FB, multi-user roles,
DM/comment inbox.

## Testing
- Scheduler claim: two concurrent claims → exactly one publishes (idempotency).
- Rate-limit: at 25/24h → defers, doesn't publish.
- `metaPostId` set → never re-publishes (resume safety).
- Publish path with a mocked Meta client (container→publish→first comment).
- State-machine transitions (pure helper, unit-tested).
- OTTO `schedulePosts` skill creates DRAFTs only — never publishes, never spends.

## Open questions for the plan
- pg-boss scheduled-job vs minutely-poll for the scheduler (latency vs simplicity).
- FB native `scheduled_publish_time` — use it for FB and our timer only for IG, or
  one unified timer for both? (Lean: one unified timer — simpler, consistent.)
- Reminder delivery channel in Phase A (email vs in-app) if a post can't auto-publish.
- Where the Meta publish scopes get added in the OAuth flow (coordinate with the
  read-connector already live; don't break it).
