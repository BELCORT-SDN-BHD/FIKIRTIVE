/**
 * schedule-connections — the ONE source of "which accounts is this merchant connected to right
 * now", and the ONE place Schedule turns that into a decision.
 *
 * Why this module exists (#741 r2, third round of the same family of bug). "Connected accounts"
 * had grown several sources with different lifecycles: the plan card received `null` while the
 * read was in flight, the composer received the initial `[]`, and both were one-shot snapshots
 * taken at mount. So on the very same screen a stale draft could be counted READY by "Approve
 * all" and simultaneously accused of having no connection by the composer — and neither noticed a
 * merchant who disconnected in another tab. Every new consumer added another fork.
 *
 * The fix is not another patch, it is one shape with an explicit lifecycle:
 *
 *   ConnectedAccounts = ACCOUNTS_LOADING | loadedAccounts([...])   // [] is a real answer
 *
 * and one derived judgement, `approvalFor`. The type is OPAQUE on purpose: a component holding a
 * `ConnectedAccounts` cannot reach the array inside it, so it cannot hand-roll its own "is this
 * account still good" test — the compiler refuses. Everything a screen legitimately needs comes
 * from the selectors below.
 *
 * Three rules this module encodes, in this order:
 *   1. A channel the product cannot connect at all (X today) outranks every account question.
 *      There is no account to pick and no connect flow to send anyone to, so the only true next
 *      step is to move the post — never a connect call to action (#741 r2 P2).
 *   2. LOADING means UNCERTAIN: never approve, never count as ready, and never assert
 *      "connect your account" — we have not looked yet. Say we are looking.
 *   3. LOADED delegates to the shared server-side rule (scheduleApproveBlockers) with the real
 *      list, so the merchant is told in advance exactly what the server would refuse with.
 */
import type { OwnerTarget } from "./schedule-actions";
import { isConnectableChannel, channelMeta } from "./channels/channel-meta";
import { canAutoPublish } from "./auto-publish-gate";
import { scheduleApproveBlockers } from "@fikirtive/core/schedule-draft";

declare const CONNECTED_ACCOUNTS_BRAND: unique symbol;

/**
 * The merchant's connected publishing accounts, or the fact that we are still finding out.
 *
 * Deliberately opaque: there is no way to read the list off this value. Consumers use the
 * selectors below, which is what keeps every screen answering the same question the same way.
 */
export type ConnectedAccounts = { readonly [CONNECTED_ACCOUNTS_BRAND]: "connected-accounts" };

/**
 * Everything the screen knows about "can this merchant publish, and where" — assembled from BOTH
 * platform reads (#741 r3 P1). `canPublish` used to be its own piece of component state fed by its
 * own getMetaConnection() call with its own lifecycle, which is how the header could still be
 * hiding its Connect button ("still loading") while the plan card had already decided the merchant
 * had no accounts. Carrying it inside the same value makes that interleaving unrepresentable.
 */
export type AccountsRead = { targets: readonly OwnerTarget[]; canPublish: boolean };

type AccountsState = { phase: "loading" } | ({ phase: "loaded" } & AccountsRead);

const read = (accounts: ConnectedAccounts): AccountsState => accounts as unknown as AccountsState;

/** Nothing read yet. Not "nothing connected" — the two must never be confused. */
export const ACCOUNTS_LOADING = { phase: "loading" } as unknown as ConnectedAccounts;

/**
 * A completed read — BOTH facts together, which is the point: a caller that only has one of them
 * cannot build this value, so it cannot half-publish a connection state to the screen. An empty
 * target list is a real, final answer: nothing is connected.
 */
export function loadedAccounts(value: AccountsRead): ConnectedAccounts {
  return { phase: "loaded", ...value } as unknown as ConnectedAccounts;
}

/** True while the answer is still unknown. For UI that must not commit either way yet. */
export function isCheckingAccounts(accounts: ConnectedAccounts): boolean {
  return read(accounts).phase === "loading";
}

// ── Merchant-facing copy owned by this module ────────────────────────────────────────────────
// These two sentences describe states the shared core rule cannot know about — "we haven't looked
// yet" is a client-only fact, and "this channel has no connect flow" comes from the channel mirror
// in this app. They live here, once, for the same reason the approve sentences live once in core.

/** Said while the connection read is in flight. Never an assertion about the connection itself. */
export const CHECKING_ACCOUNTS_BLOCKER = "Checking your connected accounts…";

/** Said for a channel nobody can connect. Points at the only action that actually exists. */
export function channelUnavailableBlocker(channel: string): string {
  const label = channelMeta(channel)?.label ?? channel;
  return `${label} is not available yet — move this post to another channel to send it.`;
}

// ── The one derived judgement ────────────────────────────────────────────────────────────────

export type ApprovalView = {
  /** Everything still standing between this post and approval, in merchant-facing sentences. */
  blockers: string[];
  /** Approve may proceed. False whenever anything is unknown — uncertainty never approves. */
  canApprove: boolean;
};

export function approvalFor(
  accounts: ConnectedAccounts,
  post: { channel: string; targetId: string | null | undefined; mediaCount: number },
): ApprovalView {
  if (!isConnectableChannel(post.channel)) {
    return { blockers: [channelUnavailableBlocker(post.channel)], canApprove: false };
  }
  const state = read(accounts);
  if (state.phase === "loading") {
    return { blockers: [CHECKING_ACCOUNTS_BLOCKER], canApprove: false };
  }
  const blockers = scheduleApproveBlockers({
    channel: post.channel,
    targetId: post.targetId,
    mediaCount: post.mediaCount,
    connectedTargetIds: state.targets.filter((t) => t.channel === post.channel).map((t) => t.id),
  });
  return { blockers, canApprove: blockers.length === 0 };
}

// ── Derived views for the screens ────────────────────────────────────────────────────────────

/**
 * What the composer's Account field should be. Structural rather than ad-hoc so the two states
 * that must NOT offer a connect button ("checking" and "unavailable") cannot be collapsed back
 * into the empty case by a later edit.
 */
/**
 * One row of the Account dropdown, already reduced to what rendering needs. Deliberately NOT the
 * `OwnerTarget` (#741 r3 P2): handing the screen the real account objects hands it everything it
 * needs to hand-roll "is this account still good" — `picker.options.some(t => t.id === targetId)`
 * is a two-second edit away, and that edit is precisely how this screen grew a second judgement
 * point three rounds running. A `{ value, label }` cannot answer that question at all.
 */
export type AccountOption = { value: string; label: string };

export type AccountPicker =
  | { phase: "checking" }
  | { phase: "unavailable" }
  | { phase: "none" }
  | { phase: "ready"; options: readonly AccountOption[] };

export function accountPicker(accounts: ConnectedAccounts, channel: string): AccountPicker {
  if (!isConnectableChannel(channel)) return { phase: "unavailable" };
  const state = read(accounts);
  if (state.phase === "loading") return { phase: "checking" };
  const matching = state.targets.filter((t) => t.channel === channel);
  return matching.length > 0
    ? { phase: "ready", options: matching.map((t) => ({ value: t.id, label: t.name })) }
    : { phase: "none" };
}

/** Channels with at least one real publishable target. Empty while the answer is unknown. */
export function postableChannelIds(accounts: ConnectedAccounts): Set<string> {
  const state = read(accounts);
  return state.phase === "loaded" ? new Set(state.targets.map((t) => t.channel)) : new Set<string>();
}

/**
 * Whether the auto-publish switch may be operated at all: a real publishable channel AND the
 * platform's publish permission, judged by the SAME shared gate the settings copy explains. False
 * while anything is unknown — the switch is a promise about what happens without the merchant
 * watching, so an unfinished read never unlocks it.
 */
export function autoPublishAllowed(accounts: ConnectedAccounts): boolean {
  const state = read(accounts);
  if (state.phase !== "loaded") return false;
  return canAutoPublish([...postableChannelIds(accounts)], state.canPublish);
}

/** Whether a stored target id is still one of the merchant's accounts on that channel. */
export function isConnectedTarget(accounts: ConnectedAccounts, channel: string, targetId: string | null): boolean {
  const state = read(accounts);
  if (state.phase !== "loaded" || !targetId) return false;
  return state.targets.some((t) => t.channel === channel && t.id === targetId);
}
