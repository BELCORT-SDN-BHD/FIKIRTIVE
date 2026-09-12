import "server-only";
import { consumeRateLimit } from "@fikirtive/db/rate-limit";
import { callerKey } from "@/lib/caller-identity";
import {
  MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS,
  alertMediaProxyStoreUnreachable,
  rememberMediaProxySuccess,
  withinMediaProxyGrace,
} from "@/lib/media-proxy-degraded";

export { callerKey } from "@/lib/caller-identity";

/**
 * #795 — the product's own gates, in one place.
 *
 * Better Auth guards its own endpoints (and now counts them in Postgres). These are the four
 * doors it knows nothing about, and every one of them had NO limit at all:
 *
 *   · the PASSWORD door — Better Auth caps it at 3 per 10 seconds, which stops a fast attack and
 *     does nothing at all about a patient one (3/10s is 1,080 attempts an hour from one address);
 *   · the OTTO CONVERSATION door (added 2026-08-18) — credits bound what a turn can SPEND, not
 *     how many turns a stuck client can start, and every started turn is a real model call we
 *     pay for before any of it settles;
 *   · GENERATION — the paid dispatch. Credits bound what can be SPENT, not how many jobs, rows
 *     and queue messages a stuck client loop can create on the way to running out;
 *   · UPLOAD — mints a presigned URL into our own bucket, once per call, with nothing counting;
 *   · the EXTERNAL LINK — the signed media proxy, then the only route with no session by design
 *     (B0-28 added a second, the share preview below, and its gate is at the bottom of this file).
 *
 * WHY EACH LIMIT IS THE NUMBER IT IS is written at the constant. The rule used for all of them:
 * size the cap against the most demanding REAL use we can name (a 24-cell batch, a bulk product
 * import, ten people behind one office address), then leave headroom — a gate that refuses honest
 * work is an outage we inflicted on ourselves, and every one of these is a first gate where there
 * was none, so "generous" is still strictly tighter than what it replaces.
 *
 * KEYS. `door:subject`. The subject is a TENANT id for merchant doors (a signed-in caller is
 * counted as themselves, not as their office's shared address) and a caller address for the
 * public ones (there is nobody else to count).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/*
 * SIGNIN-A4 —— 这里以前还有一条 `PASSWORD_DOOR_PER_CALLER_PER_HOUR = 30`（密码登录门的每小时
 * 闸，#795）。密码整体退役之后（docs/specs/sign-in.md 已冻结 · v1）`/sign-in/email` 在 router
 * 层就 404，那道闸没有门可守，而且它跑在转发之前，会把验收 A4 要的「一律 404」变成第 31 次
 * 的 429。闸与 `consumePasswordDoor` 一起删掉，而不是留一个没人调用的导出。
 */

/**
 * #795 r2 — the PUBLIC Better Auth doors, per calling address, per hour.
 *
 * These used to be `rateLimit.customRules` entries with a 3600-second window, and moving Better
 * Auth's storage to the database silently broke them. Its database backend prunes with a cutoff
 * of `max(rateLimit.window, …built-in special rules)` — 10 s and 60 s respectively, so 60
 * seconds — and it does that pruning without consulting the custom rule that actually applied.
 * A row therefore disappears 61 seconds after it was last touched, and an hourly budget of five
 * became five per minute: roughly 300 an hour, from a rule that reads "5". The published number
 * was not the enforced number, which is the exact defect this whole ticket exists to remove.
 *
 * Raising Better Auth's global `window` to an hour would fix the cutoff and re-price EVERY other
 * endpoint it guards (`/get-session` and friends) from 100-per-10-seconds to 100-per-hour, which
 * would take out a shared office address in ordinary use. So the hourly caps move here instead,
 * onto our own counter, which prunes on its own `expiresAt` and cannot be undercut by a window
 * it does not know about. Better Auth keeps its short built-in burst rules on the same paths —
 * this is a second cap in front, never a replacement.
 *
 * The number is UNCHANGED at five per address per hour: this ticket restores what the config
 * already claimed, it does not re-price the door.
 */
export const PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR = 5;

/**
 * Paid generation dispatch, per tenant, per hour.
 *
 * Sized against the largest legitimate burst the product can produce: one factory batch is up to
 * MAX_BATCH_CELLS (24) startGen calls dispatched together, and a busy merchant may run several
 * back to back while also working the canvas. 600 leaves room for roughly twenty-five full
 * batches an hour — far past any human session — while still bounding a runaway client loop to
 * hundreds of refused attempts instead of unbounded ones.
 *
 * This is NOT a spend cap. Credits are the spend cap and stay the money authority; this only
 * bounds how much work a single tenant can ask for per hour.
 */
export const GENERATION_PER_TENANT_PER_HOUR = 600;

/**
 * Otto conversation turns, per tenant, per hour.
 *
 * IT BOUNDS RUNAWAY USAGE, NOT SPEND. The same shape as the generation gate above: credits are
 * the money authority and a conversation turn reserves against them before the model is called
 * (OTTO_CONVERSATION_TURN_MARGIN in @fikirtive/core prices it at the provider's cost plus 5%), so
 * nobody can be charged past their balance with or without this. What credits do NOT bound is how
 * many turns a stuck client can START — each one is a real model call, a hold, and a settle, and
 * a broken retry loop can produce them faster than a human ever would.
 *
 * IT IS NOT A PRICE AND NOT A SPEND CAP. It cannot charge anyone and it does not shrink with a
 * balance; the reserve does both. It exists only so one tenant's loop cannot manufacture an
 * unbounded number of turns while the merchant sees nothing wrong.
 *
 * WHY 60. Sized against the most demanding real hour we can name and then left generous: a
 * merchant working steadily with Otto sends a message every minute or two, and a beta session
 * that felt long measured well under twenty turns. Sixty is roughly one a minute for a solid
 * hour — past any human conversation — while still bounding a broken client to dozens of refused
 * calls an hour instead of thousands of dispatched ones. A gate that refuses honest work is an
 * outage we inflicted on ourselves; this one should never be reached by a person.
 */
export const OTTO_TURN_PER_TENANT_PER_HOUR = 60;

/**
 * Upload authorisation, per tenant, per hour.
 *
 * Every call mints a presigned URL into our own bucket. A bulk product import is tens of files
 * and a merchant may do several in a sitting, so the honest ceiling is high; 1000 bounds a script
 * without ever reaching a real import.
 */
export const UPLOAD_PER_TENANT_PER_HOUR = 1000;

/**
 * The signed media proxy, per calling address, per ten minutes.
 *
 * This one is generous ON PURPOSE. Its intended caller is a platform's own media-fetch fleet
 * pulling images for a post we already charged the merchant for, and those fleets are many
 * addresses making many requests. The cap exists to bound bulk scraping of signed URLs, not to
 * police the fetcher, so it sits far above any real fetch pattern.
 */
export const MEDIA_PROXY_PER_CALLER_PER_10_MIN = 600;

/**
 * The share-preview page, per calling address, per hour.
 *
 * The second session-less door in the product, and the first one a HUMAN walks through: a
 * merchant mints a read-only link for one scheduled post and sends it to a client, who opens it
 * in a browser with no account. Its authorization is the link's own HMAC plus a live mint row;
 * this only bounds how fast one address may spend that authorization.
 *
 * WHY 120. Sized against the most demanding honest hour: a client opening the link, refreshing a
 * few times, forwarding it to two colleagues behind one office address, each of them reloading
 * while they discuss it. That is tens, not hundreds. 120 leaves the honest reader far below the
 * cap while bounding a script that holds one valid link to a couple of page loads a minute.
 *
 * NOT the media behind it: each image the page shows is fetched through the signed media proxy,
 * which counts on its own generous gate (above). This one counts page loads.
 */
export const SHARE_PREVIEW_PER_CALLER_PER_HOUR = 120;

/**
 * SIGNIN-A17 —— 全站每小时能开出多少个新账号（docs/specs/sign-in.md 已冻结 · v1 §1.5）。
 *
 * 这是**反刷号**那一刀，不是反滥用的通用闸。码门对陌生人打开之后，开户不再需要任何邀请，
 * 而每一个新工作区都会拿到一笔 `SIGNUP_GRANT_CREDITS` 的真实供应商成本。归一化的赠金幂等键
 * （`packages/core` 的 `canonicalGrantEmail`）挡掉了 `me+001@` / `m.e@` 这一类同一个真实收件箱
 * 的变体；这条闸挡的是另一半 —— 一千个**互不相同**的真实地址。
 *
 * WHY 50 —— 规格写死的默认值。未公测、零商家（记忆库 `launch-status-no-users`，2026-08-01），
 * 一小时里出现 50 个真人新注册在今天是**异常**而不是繁荣，所以撞到它本身就是要人看一眼的
 * 信号（下面的 Sentry 告警）。它按小时滑动，不是终身上限：撞满之后下一小时自动恢复。
 *
 * 它只挡**开户**，不挡登录：计数发生在 `databaseHooks.user.create.before`，老商家的会话与
 * 重复登录根本不经过这里（验收 A17 的「老用户登录不受影响」）。
 */
export const NEW_ACCOUNTS_PER_HOUR = 50;

/** SIGNIN-A17 —— 一个全站共享的桶。key 是常量：数的是「新账号」这件事本身，不是谁在开。 */
export async function consumeNewAccountGate(): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: "signup:site", max: NEW_ACCOUNTS_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/**
 * The public Better Auth doors (today: verification resend — see HOURLY_PUBLIC_DOORS), each with
 * its OWN hourly bucket so one door being spent never closes another.
 * Returns the retry hint (ms) when refused, or null when allowed through.
 */
export async function consumePublicAuthDoor(door: string, requestHeaders: Headers): Promise<number | null> {
  const verdict = await consumeRateLimit([
    {
      key: `authdoor:${door}:${callerKey(requestHeaders)}`,
      max: PUBLIC_AUTH_DOOR_PER_CALLER_PER_HOUR,
      windowMs: HOUR,
    },
  ]);
  return verdict.granted ? null : verdict.retryAfterMs;
}

/** The paid generation dispatch. */
export async function consumeGenerationGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `gen:${ownerId}`, max: GENERATION_PER_TENANT_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/**
 * What a merchant is told when the Otto conversation gate refuses (2026-08-18).
 *
 * ONE sentence for BOTH doors — the streaming route and the non-streaming `ottoTurn` — so the two
 * entries to the same conversation cannot end up saying different things about the same limit.
 * Honest about the wait: the window is an hour, so "a moment" would be a promise it cannot keep.
 * It never mentions credits, because this refusal is not about them: nothing was reserved and
 * nothing was charged, and pointing at Billing would send the merchant to fix the wrong thing.
 */
export const OTTO_TURN_RATE_LIMIT_MESSAGE =
  "You've sent Otto a lot of messages in the last hour. Take a short break and try again a little later.";

/**
 * The Otto conversation door — both entries (stream route and ottoTurn) go through this.
 *
 * IT STAYS OPEN WHEN THE COUNTER CANNOT BE REACHED (product-lead call, 2026-08-18). It was the
 * SECOND gate here to do so; since SHARE-A3 (2026-09-12) flipped the media proxy to fail-closed
 * it is the ONLY one. The reasoning is per-door, not a global switch: weigh what a refusal costs
 * against what it protects.
 *
 * THE MONEY IS ALREADY PROTECTED WITHOUT THIS GATE. A conversation turn reserves against the
 * merchant's balance before the model is called, and that reserve fails closed on its own — a
 * database that cannot answer this counter cannot answer the reserve either, so nothing can be
 * spent while it is down. All this gate adds is a bound on runaway VOLUME, and a few unmetered
 * minutes of that is cheap. What a refusal costs is not cheap at all: Otto is how merchants use
 * this product, so a fail-closed gate turns a rate-table hiccup into "Otto is down" for everyone
 * at once.
 *
 * THE OTHER GATES DELIBERATELY DIFFER. `consumeGenerationGate` and `consumeUploadGate` stay
 * fail-CLOSED: they guard dispatch into a queue and a presigned URL into our own bucket, work
 * that needs Postgres anyway, so refusing while the database is unreachable costs nothing it was
 * not already going to cost.
 */
export async function consumeOttoTurnGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit(
    [{ key: `otto:${ownerId}`, max: OTTO_TURN_PER_TENANT_PER_HOUR, windowMs: HOUR }],
    { onStorageFailure: "allow" },
  );
  return verdict.granted;
}

/** Upload authorisation. */
export async function consumeUploadGate(ownerId: string): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `upload:${ownerId}`, max: UPLOAD_PER_TENANT_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}

/** What the media proxy learned. A refusal always carries the wait, so the route can be honest
 *  about it in `Retry-After` instead of leaving the caller to guess (SHARE-A3). */
export type MediaProxyGateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** `Retry-After` is whole seconds, and 0 would read as "come back now" — never round down to it. */
function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/**
 * The signed media proxy.
 *
 * SHARE-A3 —— THIS GATE USED TO STAY OPEN WHEN THE COUNTER COULD NOT BE REACHED, and it no longer
 * does. The old reasoning was sound for the caller it was written for: this is the only route
 * that otherwise touches no database, so refusing during a database blip would break a publish
 * the merchant already paid for, with the rate limiter as the only cause. What changed is the
 * OTHER caller. B0-28 put a human's browser on this same door (the seat-less share preview), and
 * after SHARE-A1 the route streams objects of up to 2 GB — so "open while the counter is down"
 * means anyone holding one valid link may pull as fast as the network allows, for the whole
 * outage, against our egress bill (#1053 finding 1).
 *
 * Founder ruled the three pieces ship together (2026-09-12, 场⑦), and they are all here:
 * refuse (429 + Retry-After), the short grace window that keeps a client who is ALREADY looking
 * from being cut off mid-page (SHARE-A4), and the alert that stops a silent mass-429 (SHARE-A12).
 * The cost of the refusal, with its eyes open, is written in the spec's 异议栏.
 *
 * Authorisation is unaffected either way: a forged, expired or foreign token still 404s regardless
 * of what this returns, and it is checked BEFORE this runs.
 */
export async function consumeMediaProxyGate(
  requestHeaders: Headers,
  options: { now?: number } = {},
): Promise<MediaProxyGateVerdict> {
  const now = options.now ?? Date.now();
  const caller = callerKey(requestHeaders);
  const verdict = await consumeRateLimit(
    [{ key: `media:${caller}`, max: MEDIA_PROXY_PER_CALLER_PER_10_MIN, windowMs: 10 * MINUTE }],
    { now, onStorageFailure: "deny" },
  );

  if (!verdict.degraded) {
    if (!verdict.granted) return { allowed: false, retryAfterSeconds: retryAfterSeconds(verdict.retryAfterMs) };
    rememberMediaProxySuccess(caller, now);
    return { allowed: true };
  }

  // The counter is unreachable. Tell a human (throttled, with a delivery receipt), then decide.
  await alertMediaProxyStoreUnreachable(now);
  if (withinMediaProxyGrace(caller, now)) return { allowed: true };
  return { allowed: false, retryAfterSeconds: MEDIA_PROXY_DEGRADED_RETRY_AFTER_SECONDS };
}

/**
 * The share-preview page (B0-28), per calling address.
 *
 * FAIL-CLOSED: this page's authorization needs Postgres anyway (the mint row is the authority
 * layer), so a database that cannot answer this counter cannot authorize the page either.
 * Refusing costs nothing that was not already going to be refused. (The media proxy next to it
 * used to be the exception; SHARE-A3 closed it too, for its own reasons written there.)
 */
export async function consumeSharePreviewDoor(requestHeaders: Headers): Promise<boolean> {
  const verdict = await consumeRateLimit([
    { key: `sharepv:${callerKey(requestHeaders)}`, max: SHARE_PREVIEW_PER_CALLER_PER_HOUR, windowMs: HOUR },
  ]);
  return verdict.granted;
}
