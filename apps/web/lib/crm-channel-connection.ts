/**
 * crm-channel-connection — the ONE answer to "does this workspace have a messaging channel
 * connected, and what do we tell the merchant about it".
 *
 * #727: six CRM surfaces spoke about the same fact. Three of them read it — Templates and the
 * broadcast composer offer the workspace's `ChannelScope` rows in a dropdown, the conversation
 * page renders its banner from the preflight connection axis. The other three (Inbox list,
 * Broadcasts list, broadcast detail) had the sentence typed into the JSX with no condition and
 * no read at all. Nothing writes a `ChannelScope` row in production today, so the fixed text is
 * accidentally true; the day a channel exists, those three screens contradict the other three
 * in front of the merchant, and no test, type or guard would notice — the page never asked.
 *
 * That is this project's standing root cause: what the product SAYS drifting from what it DOES.
 * The fix is not three better sentences, it is one authority. A surface passes in the read it
 * already performs; this file decides what is true and supplies the words. A surface that cannot
 * read the state gets `unreadable` — never "not connected", because a failed read is not a fact
 * about the workspace.
 *
 * Pure presentation over a value the caller already fetched: no data access, no tenant logic.
 */

import { channelAccountLabel } from "./crm-labels";

/**
 * 判官 r2 P1-1 — a channel account is an IDENTITY (`ChannelScope`, which the schema keeps
 * deliberately lifecycle-free); whether it is CONNECTED is a separate fact carried by
 * `connectionState`, derived server-side from `ChannelConnection.status`. Conflating the two is
 * how a merchant with an expired connection, or with an identity that was never connected, got
 * told they were connected. A row without `connectionState` is treated as not connected: a
 * caller that did not supply the lifecycle does not get to imply one.
 */
export type ChannelAccount = {
  id: string;
  channel: string;
  scopeKey: string;
  connectionState?: "active" | "inactive" | "none";
};

/** The result shape of every tenant-gated channel-account read in the product. */
export type ChannelAccountsResult =
  | { ok: true; resource: ChannelAccount[] }
  | { ok: false; error: string };

export type ChannelConnection =
  /** At least one account has a live connection. `accounts` are the live ones. */
  | { kind: "connected"; accounts: ChannelAccount[] }
  /** Accounts were connected once and are not now. `accounts` are the lapsed ones. */
  | { kind: "expired"; accounts: ChannelAccount[] }
  /** Nothing is connected. `accounts` are the identities on file, possibly none at all. */
  | { kind: "none"; accounts: ChannelAccount[] }
  | { kind: "unreadable" };

/**
 * The only sentence in the product about connecting a channel. It is a product fact, not a
 * workspace fact: no screen anywhere can connect a messaging channel yet (#541), which is why
 * no page offers a CTA into Connections. It belongs only to the `none` branch — telling a
 * merchant who already has a channel that channels cannot be connected is the same lie in
 * reverse.
 */
export const CHANNEL_CONNECT_UNAVAILABLE_NOTE = "Messaging channels are not available to connect yet.";

/** Derive the connection state from a gateway read. An absent read is `unreadable`: a page that
 *  was not given the authority does not get to guess at it. */
export function channelConnectionFrom(result: ChannelAccountsResult | undefined | null): ChannelConnection {
  if (!result || !result.ok) return { kind: "unreadable" };
  const accounts = result.resource;
  const live = accounts.filter((account) => account.connectionState === "active");
  if (live.length > 0) return { kind: "connected", accounts: live };
  const lapsed = accounts.filter((account) => account.connectionState === "inactive");
  if (lapsed.length > 0) return { kind: "expired", accounts: lapsed };
  return { kind: "none", accounts };
}

/**
 * 判官 r2 P1-1 — the OTHER question, kept separate on purpose: does this workspace have a channel
 * account the composer could name? That is what the create form needs (it submits a
 * `channelScopeId`), and it is why a lapsed connection must not take the form away — the merchant
 * can still fill it in, and the run is simulated either way. `null` means the read failed, and an
 * unknown never removes an action.
 */
export function hasChannelAccountOnFile(connection: ChannelConnection): boolean | null {
  if (connection.kind === "unreadable") return null;
  return connection.accounts.length > 0;
}

/** Same derivation for a caller that already unwrapped its read (the composer options carry the
 *  rows inline). `null` means the surrounding read failed, so it is `unreadable`, not `none`. */
export function channelConnectionFromAccounts(
  accounts: ChannelAccount[] | undefined | null,
): ChannelConnection {
  return channelConnectionFrom(accounts ? { ok: true, resource: accounts } : null);
}

/** What every CRM surface says about connection, in one voice. */
export function channelConnectionHeadline(connection: ChannelConnection): string {
  switch (connection.kind) {
    case "connected":
      return connection.accounts.length === 1
        ? `Connected messaging channel: ${channelAccountLabel(connection.accounts[0])}.`
        : `Connected messaging channels: ${connection.accounts.map(channelAccountLabel).join(", ")}.`;
    // 判官 r2 P1-1 — a lapsed connection is materially different from never having had one, and
    // the merchant is the one who needs to know which. It still opens with the same clause, so a
    // reader (and a test) can rely on one sentence meaning "not connected".
    case "expired":
      return connection.accounts.length === 1
        ? `No messaging channel is connected in this workspace: the connection for ${channelAccountLabel(connection.accounts[0])} is no longer active.`
        : `No messaging channel is connected in this workspace: the connections for ${connection.accounts.map(channelAccountLabel).join(", ")} are no longer active.`;
    case "none":
      return "No messaging channel is connected in this workspace yet.";
    case "unreadable":
      return "Whether a messaging channel is connected could not be read, so this page does not claim either way.";
  }
}

/** True only when the read succeeded AND said nothing is connected — the one condition under
 *  which a surface may add the "channels cannot be connected yet" note. */
export function channelConnectionIsConfirmedAbsent(connection: ChannelConnection): boolean {
  return connection.kind === "none" || connection.kind === "expired";
}

/** The zero-channel explanation shared by every surface that would otherwise offer an action a
 *  merchant cannot finish. `lead` is the surface's own reason the channel matters. */
export function channelUnavailableCopy(lead: string): string {
  return `${lead} ${CHANNEL_CONNECT_UNAVAILABLE_NOTE}`;
}
