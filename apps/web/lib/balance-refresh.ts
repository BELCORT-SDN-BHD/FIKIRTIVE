/**
 * Balance-refresh signal — "the money moved, whoever is showing it should re-read it".
 *
 * The spendable balance is rendered in exactly one place now: the persistent global
 * navigation (#513 A组). That rail is mounted by the root layout, while every spend
 * happens deep inside a page's own tree (Otto turns, canvas generations, the asset
 * detail panel) — there is no shared React state between them, so a settle had no way
 * to reach the number the merchant is actually looking at. It stayed on the value
 * fetched at mount until a full page reload (#550: the sidebar lagged the database by
 * 84s+ during the S2/S6 walkthrough).
 *
 * This is a plain module-scoped emitter, not a poll: a spend site calls
 * notifyBalanceRefresh() at the moment it already knows a charge settled, and whoever
 * displays a balance re-reads it then. No new timer is introduced — #544 flagged one
 * timer too many, and the discipline outlived the timer it was about: the 4s
 * thread-activity poll this comment used to name is gone (grep: no interval reads
 * /api/otto/thread-activity today; the panel's expand signal asks it exactly once per
 * visit, `lib/otto-panel-activity.ts`). "No new timer" still governs both.
 *
 * Client-side only by construction — the listener set is module state, so it is
 * meaningful only inside the browser bundle where the nav and the spend sites share it.
 */

type BalanceRefreshListener = () => void;

const listeners = new Set<BalanceRefreshListener>();

/** Register a balance display. Returns the unsubscribe for the effect's teardown. */
export function subscribeBalanceRefresh(listener: BalanceRefreshListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Guard a repeatedly-issued async read against out-of-order responses.
 *
 *  Call the returned `begin()` when a read starts; it hands back an `isLatest()` that is
 *  false once a newer read has begun. A settle fires several refreshes in quick
 *  succession (the hold, then the settle/refund), and `getMyAccount` responses are not
 *  guaranteed to come back in the order they were sent — without this, a slow earlier
 *  response can land last and repaint an OLDER balance. That makes a "refresh" actively
 *  worse than not refreshing, which is the opposite of what #550 is trying to buy.
 *
 *  Each gate has its own sequence, so two independent displays never invalidate each
 *  other's reads. */
export function createLatestReadGate(): () => () => boolean {
  let issued = 0;
  return () => {
    const mine = ++issued;
    return () => mine === issued;
  };
}

/** Announce that a charge settled and any displayed balance is now stale. Iterates a
 *  snapshot so a listener that subscribes/unsubscribes during delivery cannot change
 *  who this round reaches, and one throwing listener cannot swallow the rest — a
 *  display bug must never surface as a failure on a spend path. */
export function notifyBalanceRefresh(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("balance-refresh listener failed (non-fatal):", error);
    }
  }
}
