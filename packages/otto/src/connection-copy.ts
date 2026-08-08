/**
 * What Otto says about a connection that EXISTS but cannot be used right now (#741 r5 P1).
 *
 * Every Meta-reading skill had independently written `"notConnected" in res || "needsReconnect" in
 * res` and answered both with its own "Meta isn't connected yet" copy. For a merchant whose token
 * merely expired that is false — and it contradicts the Connections page sitting in front of them,
 * which says "Reconnect needed". One OR per file, six files, one lie.
 *
 * The classification comes from @fikirtive/core (shared with the web channel adapters) and the
 * label from CONNECTION_BLOCKER_COPY, so Otto and the human screens cannot describe the same
 * connection differently. Each skill keeps its OWN "never connected" and "couldn't reach Meta"
 * copy — those are contextual ("…so I can't read your per-ad performance") and were never wrong.
 */
import {
  CONNECTION_BLOCKER_COPY,
  classifyConnectionFailure,
  type ConnectionBlocker,
} from "@fikirtive/core";

// The wording deliberately avoids spelling out the false claim, even to forbid it: a message
// containing "…they have not connected Meta" reads as that assertion to anything scanning the
// output (including this package's own behavioural fence), and it is one careless quote away from
// reaching the merchant. Say what IS true and name the shape to use instead.
const BLOCKED_MESSAGE: Record<ConnectionBlocker, string> = {
  needs_reconnect:
    `${CONNECTION_BLOCKER_COPY.needs_reconnect.status} — Meta IS connected, its access just expired. ` +
    "Ask the user to open Connections and reconnect, then try again. Describe it as an expired connection, never as a missing one.",
  needs_page_permission:
    `${CONNECTION_BLOCKER_COPY.needs_page_permission.status} — Meta IS connected, but it cannot see their Pages. ` +
    "Ask the user to reconnect and allow Page access, then try again. Describe it as a missing permission, never as a missing connection.",
};

/**
 * Whether a failed connection read means "connected, but not usable right now" — as opposed to a
 * genuinely absent connection or an unreachable platform, which each skill answers correctly in its
 * own contextual words. A type guard so the skill's remaining branches still narrow: the states are
 * separated by the compiler, not by everyone remembering to check.
 */
export function isConnectionBlocked(
  read: object,
): read is { needsReconnect: true } | { needsPageScope: true } {
  const state = classifyConnectionFailure(read as Record<string, unknown>);
  return state === "needs_reconnect" || state === "needs_page_permission";
}

/** Otto's answer for such a read — one wording, shared with the human screens. */
export function ottoConnectionBlockedAnswer(read: object): { blocked: ConnectionBlocker; message: string } {
  const blocked = classifyConnectionFailure(read as Record<string, unknown>) as ConnectionBlocker;
  return { blocked, message: BLOCKED_MESSAGE[blocked] };
}
