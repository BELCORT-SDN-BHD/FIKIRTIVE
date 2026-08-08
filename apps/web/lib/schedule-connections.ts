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
import { CONNECTABLE_CHANNEL_META, isConnectableChannel, channelMeta } from "./channels/channel-meta";
import { canAutoPublish } from "./auto-publish-gate";
import {
  ACCOUNTS_UNREADABLE_ERROR,
  CONNECTION_BLOCKER_COPY,
  scheduleApproveBlockers,
  type ChannelReadState,
  type ConnectionBlocker,
} from "@fikirtive/core/schedule-draft";

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
export type AccountsRead = {
  targets: readonly OwnerTarget[];
  /** Per channel, what the read found. Absent ⇒ never read ⇒ unreadable (#741 r5 P1). */
  channelStates: Readonly<Record<string, ChannelReadState>>;
  canPublish: boolean;
};

/**
 * One channel's entry, resolved ONCE when the value is built.
 *
 * The stored shape deliberately has no flat target list any more (#741 r5 P1). While it did,
 * `postableChannelIds` read `state.targets` directly and skipped the `channelStates[c] ?? "unreadable"`
 * default — so a channel whose read had failed still counted as postable, unlocked auto-publish, and
 * (because the header then took its "connected" branch) swallowed the very "couldn't check" notice
 * that was supposed to explain it. Deleting the flat list makes that shortcut unavailable rather
 * than merely discouraged: every consumer must name a channel, and naming one always applies the
 * default.
 */
type ChannelEntry = { state: ChannelReadState; targets: readonly OwnerTarget[] };

type AccountsState =
  | { phase: "loading" }
  | {
      phase: "loaded";
      /** True while a refresh is in flight over this value — see markRechecking. */
      rechecking: boolean;
      byChannel: Readonly<Record<string, ChannelEntry>>;
      canPublish: boolean;
    };

const read = (accounts: ConnectedAccounts): AccountsState => accounts as unknown as AccountsState;

/** The per-channel entry, with the fail-safe default applied. The ONLY way into the stored data. */
function entryFor(state: AccountsState, channel: string): ChannelEntry {
  if (state.phase !== "loaded") return { state: "unreadable", targets: [] };
  return state.byChannel[channel] ?? { state: "unreadable", targets: [] };
}

/** Every channel this value has an answer about — used only to fold over channels, never to
 *  bypass `entryFor`. */
function loadedChannels(state: AccountsState): string[] {
  return state.phase === "loaded" ? Object.keys(state.byChannel) : [];
}

/**
 * Nothing read yet — the read is in flight. Not "nothing connected", and NOT where a failed read
 * lands either: a failure is a finished read with a different answer, so the screen leaves this
 * phase either way. Staying here forever is what made a persistent outage render "Checking…" with
 * no end and no way out (#741 r5 P1).
 */
export const ACCOUNTS_LOADING = { phase: "loading" } as unknown as ConnectedAccounts;

/**
 * A completed read — BOTH facts together, which is the point: a caller that only has one of them
 * cannot build this value, so it cannot half-publish a connection state to the screen. An empty
 * target list is a real, final answer: nothing is connected.
 */
export function loadedAccounts(value: AccountsRead): ConnectedAccounts {
  // Attribute every target to its channel HERE, once. A target whose channel the server did not
  // report on is dropped: we have no state to judge it by, and an unattributed account is exactly
  // the kind of half-fact this module exists to refuse.
  const byChannel: Record<string, ChannelEntry> = {};
  for (const [channel, state] of Object.entries(value.channelStates)) {
    byChannel[channel] = {
      state,
      targets: state === "ok" ? value.targets.filter((t) => t.channel === channel) : [],
    };
  }
  return { phase: "loaded", rechecking: false, byChannel, canPublish: value.canPublish } as unknown as ConnectedAccounts;
}

/**
 * The same knowledge, now known to be mid-re-read (#741 r5 P1).
 *
 * `seq` already stopped a slow response from overwriting a newer one, but it never stopped the
 * PREVIOUS answer from being read while the next one was in flight — so during a slow, hung, or
 * overlapping refresh the plan card went on counting last cycle's accounts as ready. Approving
 * then consents on facts we are at that moment re-checking. The list stays on screen (blanking it
 * every poll would be its own lie), but nothing counts as ready until the new answer lands.
 */
export function markRechecking(accounts: ConnectedAccounts): ConnectedAccounts {
  const state = read(accounts);
  if (state.phase !== "loaded") return accounts;
  return { ...state, rechecking: true } as unknown as ConnectedAccounts;
}

/**
 * The read never came back at all (the request itself failed). A finished read that learned
 * nothing: no channel is marked, so every one of them reads as unreadable and the screen says
 * "we couldn't check" rather than sitting in "Checking…" forever. Built here rather than at the
 * call site so no screen ever hand-writes a channelStates map — authoring that map is authoring
 * the truth (#741 r5 P1).
 */
export const UNREAD_ACCOUNTS: ConnectedAccounts = loadedAccounts({
  targets: [],
  channelStates: {},
  canPublish: false,
});

/** True while the answer is still unknown. For UI that must not commit either way yet. */
export function isCheckingAccounts(accounts: ConnectedAccounts): boolean {
  return read(accounts).phase === "loading";
}

/**
 * True when nothing here may be ACTED on: either we have never read, or a re-read is in flight and
 * what we hold is last cycle's answer.
 *
 * Display and decision are split deliberately. The list keeps rendering during a refresh — blanking
 * the merchant's own channels every 60 seconds would be its own kind of lie, and it tells them
 * nothing true. But every judgement (approve, "is this id still good", unlocking auto-publish)
 * treats the window as unknown, because that is exactly what it is (#741 r5 P1).
 */
function decisionsSuspended(accounts: ConnectedAccounts): boolean {
  const state = read(accounts);
  return state.phase !== "loaded" || state.rechecking;
}

// ── Merchant-facing copy owned by this module ────────────────────────────────────────────────
// These two sentences describe states the shared core rule cannot know about — "we haven't looked
// yet" is a client-only fact, and "this channel has no connect flow" comes from the channel mirror
// in this app. They live here, once, for the same reason the approve sentences live once in core.

/** Said while the connection read is in flight. Never an assertion about the connection itself. */
export const CHECKING_ACCOUNTS_BLOCKER = "Checking your connected accounts…";

/**
 * Said once a read has come back empty-handed. States the fact and that we keep trying — still not
 * an assertion about the connection. Paired everywhere with a Retry control, because "we couldn't
 * check" is only honest if the merchant has a way to make us check again (#741 r5 P1).
 */
export const ACCOUNTS_CHECK_FAILED = "We couldn't check your connected accounts. Retrying…";

/** The short label for a connection that exists but can't publish — the SAME words the
 *  Connections page shows, so one fact never gets two names. */
export function connectionBlockerStatus(blocker: ConnectionBlocker): string {
  return CONNECTION_BLOCKER_COPY[blocker].status;
}

/** Said for a channel nobody can connect. Points at the only action that actually exists. */
export function channelUnavailableBlocker(channel: string): string {
  const label = channelMeta(channel)?.label ?? channel;
  return `${label} is not available yet — move this post to another channel to send it.`;
}

// ── The one per-channel view everything else is derived from ─────────────────────────────────

/**
 * What we currently know about ONE channel. Every selector below is a thin reading of this, so a
 * new consumer cannot invent a fourth interpretation of the same facts.
 *
 * Ordering matters and is encoded here once: a channel the product cannot connect at all outranks
 * every account question (there is nothing to pick and nowhere to send anyone), then "still
 * looking", then "looked and failed", then "connected but unusable", and only last the real list.
 */
export type ChannelConnection =
  | { phase: "unconnectable" }
  | { phase: "checking" }
  | { phase: "unreadable" }
  | { phase: "blocked"; blocker: ConnectionBlocker }
  | { phase: "targets"; targets: readonly OwnerTarget[] };

export function channelConnection(accounts: ConnectedAccounts, channel: string): ChannelConnection {
  if (!isConnectableChannel(channel)) return { phase: "unconnectable" };
  const state = read(accounts);
  if (state.phase === "loading") return { phase: "checking" };
  // A channel missing from the map was never read. Applying that default HERE, in the one reader,
  // is what stops a truncated answer from being mistaken for an empty one.
  const entry = entryFor(state, channel);
  if (entry.state === "unreadable") return { phase: "unreadable" };
  if (entry.state !== "ok") return { phase: "blocked", blocker: entry.state };
  return { phase: "targets", targets: entry.targets };
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
  const view = channelConnection(accounts, post.channel);
  if (view.phase === "unconnectable") {
    return { blockers: [channelUnavailableBlocker(post.channel)], canApprove: false };
  }
  // Never read, or being re-read right now — either way we are not entitled to approve from it.
  if (view.phase === "checking" || decisionsSuspended(accounts)) {
    return { blockers: [CHECKING_ACCOUNTS_BLOCKER], canApprove: false };
  }
  // Same sentence the server refuses with when its own re-read fails — the merchant hears the one
  // true reason, and never "you have no account" for a connection we simply could not reach.
  if (view.phase === "unreadable") return { blockers: [ACCOUNTS_UNREADABLE_ERROR], canApprove: false };
  const blockers = scheduleApproveBlockers({
    channel: post.channel,
    targetId: post.targetId,
    mediaCount: post.mediaCount,
    connectedTargetIds: view.phase === "targets" ? view.targets.map((t) => t.id) : [],
    connectionBlocker: view.phase === "blocked" ? view.blocker : null,
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
  | { phase: "unreadable" }
  | { phase: "blocked"; blocker: ConnectionBlocker }
  | { phase: "none" }
  | { phase: "ready"; options: readonly AccountOption[] };

export function accountPicker(accounts: ConnectedAccounts, channel: string): AccountPicker {
  const view = channelConnection(accounts, channel);
  switch (view.phase) {
    case "unconnectable":
      return { phase: "unavailable" };
    case "checking":
      return { phase: "checking" };
    case "unreadable":
      return { phase: "unreadable" };
    case "blocked":
      return { phase: "blocked", blocker: view.blocker };
    default:
      return view.targets.length > 0
        ? { phase: "ready", options: view.targets.map((t) => ({ value: t.id, label: t.name })) }
        : { phase: "none" };
  }
}

/**
 * Channels with at least one real publishable target. Empty while the answer is unknown.
 *
 * Goes through `channelConnection` per channel like everything else (#741 r5 P1): this function
 * used to read the flat target list, which skipped the "absent ⇒ unreadable" default and let a
 * channel we had failed to read count as postable.
 */
export function postableChannelIds(accounts: ConnectedAccounts): Set<string> {
  const out = new Set<string>();
  for (const channel of loadedChannels(read(accounts))) {
    const view = channelConnection(accounts, channel);
    if (view.phase === "targets" && view.targets.length > 0) out.add(channel);
  }
  return out;
}

/**
 * Whether the screen knows enough to invite the merchant to connect something. Only true when
 * EVERY connectable channel gave a real list: "you haven't connected anything" is a claim, and a
 * channel we couldn't read — or one that is connected but expired — makes it false (#741 r5 P1).
 */
export function canOfferConnect(accounts: ConnectedAccounts): boolean {
  return CONNECTABLE_CHANNEL_META.every((c) => channelConnection(accounts, c.id).phase === "targets");
}

/** True when a connectable channel's read came back empty-handed — the screen should say so and
 *  offer to try again, rather than pretending it is still looking. */
export function accountsUnreadable(accounts: ConnectedAccounts): boolean {
  return CONNECTABLE_CHANNEL_META.some((c) => channelConnection(accounts, c.id).phase === "unreadable");
}

/**
 * A connection that exists but can't publish, if any — so the screen itself (not only an opened
 * post) can state the fact and point at the fix. A merchant with an empty schedule would otherwise
 * see nothing at all about an expired connection: no chip, no Connect prompt, no reason.
 */
export function blockedConnection(accounts: ConnectedAccounts): ConnectionBlocker | null {
  for (const c of CONNECTABLE_CHANNEL_META) {
    const view = channelConnection(accounts, c.id);
    if (view.phase === "blocked") return view.blocker;
  }
  return null;
}

/**
 * Whether the auto-publish switch may be operated at all: a real publishable channel AND the
 * platform's publish permission, judged by the SAME shared gate the settings copy explains. False
 * while anything is unknown — the switch is a promise about what happens without the merchant
 * watching, so an unfinished read never unlocks it.
 */
export function autoPublishAllowed(accounts: ConnectedAccounts): boolean {
  const state = read(accounts);
  if (state.phase !== "loaded" || decisionsSuspended(accounts)) return false;
  return canAutoPublish([...postableChannelIds(accounts)], state.canPublish);
}

/** Whether a stored target id is still one of the merchant's accounts on that channel. False for
 *  everything we did not positively read — uncertainty never vouches for an id. */
export function isConnectedTarget(accounts: ConnectedAccounts, channel: string, targetId: string | null): boolean {
  if (decisionsSuspended(accounts)) return false;
  const view = channelConnection(accounts, channel);
  if (view.phase !== "targets" || !targetId) return false;
  return view.targets.some((t) => t.id === targetId);
}
