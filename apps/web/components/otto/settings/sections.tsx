"use client";
import type { SettingsSection } from "./types";
import type { AccountInfo } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { setAdsAutonomy } from "@/lib/otto-client-actions";
import { creditsLabel, formatCredits } from "@/lib/credit-format";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";
import type { CreditPackShelf } from "@/lib/billing-actions";
import { autoPublishHint, canAutoPublish } from "@/lib/auto-publish-gate";
import { isConnectableChannel } from "@/lib/channels/channel-meta";
import type { ConnectionBlocker } from "@fikirtive/core/schedule-draft";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

export type ChannelState = {
  id: string;
  label: string;
  status: "connected" | "needs_reconnect" | "not_connected";
  targets: string[];
  /** Connected, but not usable right now (#741 r5 P1). Rendered with the SAME words Schedule
   *  uses for the same fact — see CONNECTION_BLOCKER_COPY in @fikirtive/core. */
  blocker?: ConnectionBlocker | null;
  connectUrl: string;
};

export function buildSettingsSections(args: {
  account: AccountInfo;
  settings: OwnerSettings;
  channels: ChannelState[];
  shelf: CreditPackShelf;
  adsAutonomy: "ASK" | "AUTO";
  canPublish: boolean;
  onDeleteAccountRequest: () => void;
}): SettingsSection[] {
  const { account, settings, channels, shelf, adsAutonomy, canPublish, onDeleteAccountRequest } = args;
  const canChangeAdsAutonomy = channels.some((c) => c.status === "connected");
  const connectedChannelIds = channels.filter((c) => c.status === "connected").map((c) => c.id);
  const autoPublishAvailable = canAutoPublish(connectedChannelIds, canPublish);

  const toggle =
    (k: keyof OwnerSettings) =>
    (v: boolean) => setOwnerSetting(k, v as never);

  const num =
    (k: keyof OwnerSettings) =>
    (v: number) => setOwnerSetting(k, v as never);

  // "profile" was removed here (#513 A组返工 item 2) — it duplicated the global
  // nav's Profile page (identity/email/workspace, plus Sign out which now lives
  // once in the nav's identity menu). "billing" is KEPT past the #520 merge with
  // #516: its balance/Top-up field is still required by decision③'s own test
  // (apps/web/lib/__tests__/account-settings.test.ts — "billing top-up (decision
  // ③)"), and its ledger field is the ONLY place account.recent renders anywhere
  // in the app (the standalone /billing page shows balance + packs only, no
  // history) — so #516's real improvements here (explicit save+confirm lives in
  // SettingsPage's NumberField, unaffected by this file; the honest spend-cap
  // copy right below was already shared going into the merge; formatCredits'
  // thousands formatting and the per-task detail/atLabel ledger rows below are
  // this section's own content) would be silently deleted, not just de-duplicated,
  // if this section were dropped too. Tradeoff recorded in PR #517's description.
  return [
    {
      id: "billing",
      title: "Billing and credits",
      subtitle: "Your balance and where credits went.",
      fields: [
        {
          kind: "custom",
          id: "balance",
          render: () => (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                width: "100%",
                gap: 16,
              }}
            >
              <div>
                <div className="cv-set-hint">Credit balance</div>
                <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "var(--r22-track-display-lg)" }}>
                  {creditsLabel(account.balance)}
                </div>
                {account.reserved > 0 ? (
                  <div className="cv-set-hint">
                    {creditsLabel(account.reserved)} on hold
                  </div>
                ) : null}
              </div>
              {/* Single top-up entry (decision ③): one button into the unified /billing
                  page, which lists every pack with its credits AND price. No more than-one
                  price-only "Buy" button per pack duplicated here. */}
              {"unreadable" in shelf ? (
                // #786 — the catalogue read failed, so we know neither that there are packs
                // nor that there are none. Same sentence /billing shows for the same state,
                // and no human exit: a retryable error does not get one.
                <span className="cv-set-hint">{CREDIT_PACKS_UNREADABLE_MESSAGE}</span>
              ) : shelf.packs.length > 0 ? (
                <a className="cv-set-btn" href="/billing">Top up</a>
              ) : (
                // #687 — the same sentence /billing shows for the same state, plus the one
                // exit that is actually open. An empty shelf must not be a full stop for a
                // merchant who has already decided to pay.
                <span className="cv-set-hint">
                  {NO_CREDIT_PACKS_MESSAGE} <SupportExit subject="I want to buy credits" />
                </span>
              )}
            </div>
          ),
        },
        {
          kind: "custom",
          id: "ledger",
          render: () => (
            <div style={{ width: "100%" }}>
              {account.recent.slice(0, 8).map((a) => (
                <div key={a.id} style={{ padding: "12px 15px", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
                    <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{a.label}</span>
                    <span
                      style={{
                        color: a.delta > 0 ? "#15803D" : "var(--muted-foreground)",
                        fontVariantNumeric: "tabular-nums",
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                      }}
                    >
                      {a.delta > 0 ? "+" : ""}
                      {formatCredits(a.delta)}
                    </span>
                  </div>
                  <div className="cv-set-hint" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>{a.detail ?? " "}</span>
                    <span>{a.atLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          ),
        },
      ],
    },
    {
      id: "connections",
      title: "Connections",
      subtitle:
        "Instagram, Facebook, X, and messaging channels — one page for all of them.",
      fields: [
        {
          kind: "custom",
          id: "manage",
          render: () => {
            // #694 — count only what a merchant can actually connect today. The registry also
            // carries X, which has no connect flow, so "2 of 3 connected" told a fully connected
            // merchant they were still one short.
            const connectable = channels.filter((c) => isConnectableChannel(c.id));
            const connectedCount = connectable.filter((c) => c.status === "connected").length;
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div>
                  <div className="cv-set-lbl">Publishing channels</div>
                  <div className="cv-set-hint">
                    {connectedCount} of {connectable.length} connected
                  </div>
                </div>
                <a className="cv-set-btn" href={SHELL_ROUTES.connections}>
                  Manage connections
                </a>
              </div>
            );
          },
        },
      ],
    },
    {
      id: "otto",
      title: "Otto behavior",
      subtitle: "How much Otto does without asking you.",
      fields: [
        {
          kind: "toggle",
          id: "ads",
          label: "Ask before ad spend",
          hint: canChangeAdsAutonomy
            ? "When on, Otto checks with you before every ad change. When off (Auto), Otto may pause ads, lower budgets, and create paused draft campaigns in your ad account without asking you — anything that spends or goes live still asks you first."
            : "Connect Instagram or Facebook before changing ad-spend autonomy",
          value: adsAutonomy === "ASK",
          disabled: !canChangeAdsAutonomy,
          onToggle: (v) => setAdsAutonomy(v ? "ASK" : "AUTO"),
        },
        {
          kind: "toggle",
          id: "autopub",
          label: "Auto-publish posts",
          // #851 — the same authority the Schedule screen reads. This hand-written "publishes
          // automatically" line used to survive here whatever the product could actually do, so a
          // connected workspace kept reading a promise the Schedule screen had already withdrawn.
          hint: autoPublishHint(autoPublishAvailable),
          value: settings.autoPublish,
          disabled: !autoPublishAvailable,
          onToggle: toggle("autoPublish"),
        },
        {
          kind: "number",
          id: "cap",
          label: "Spend cap",
          // #524 — the sentence is true again. It was the original promise ("Otto pauses a
          // task over this many credits"), then #487's honest-copy pass had to retract it
          // because nothing read the setting. The cap is now enforced inside reserveCredits,
          // so this says what the charging path actually does — per single action, because
          // that is what is enforced; it is not a monthly budget.
          hint: "Otto stops any single action that would cost more credits than this — nothing is charged (0 = no cap)",
          value: settings.spendCapCredits,
          unit: "credits",
          onSave: num("spendCapCredits"),
        },
      ],
    },
    // #791-2: the "Notifications · Email / In-app" section is gone. Both toggles wrote to
    // Organization.settings and nothing ever read them — there is no email sender and no
    // in-app notification channel in the product, so "on" and "off" did exactly the same
    // thing. It comes back when there is something to switch off.
    {
      id: "schedule",
      title: "Schedule defaults",
      fields: [
        {
          kind: "text",
          id: "tz",
          label: "Time zone",
          value: settings.timezone,
          readOnly: true,
        },
        {
          kind: "text",
          id: "times",
          label: "Default posting times",
          hint: "Comma-separated, e.g. 09:00,18:00",
          value: settings.defaultPostTimes,
          readOnly: true,
        },
      ],
    },
    // #804 — the home of the dark-mode choice. Preferences is where "how this workspace
    // behaves for me" already lives (spend cap, posting defaults), and appearance is a
    // preference, not an identity fact — /profile is deliberately "who you are, nothing
    // more". The control renders itself: a theme is a device preference read from
    // localStorage on the client, so there is no server value for this file to pass in.
    {
      id: "appearance",
      title: "Appearance",
      subtitle: "How Fikirtive looks on this device.",
      fields: [{ kind: "custom", id: "theme", render: () => <ThemeToggle /> }],
    },
    {
      id: "danger",
      title: "Danger zone",
      danger: true,
      fields: [
        {
          kind: "action",
          id: "del",
          label: "Delete account",
          // #686 — "Contact us" used to be a bare span: the merchant was told to reach us
          // and given nothing to click. Same sentence, now a live way out.
          hint: (
            <>
              Hides your workspace.{" "}
              <SupportExit subject="Erase my workspace" label="Contact us" /> to fully erase.
            </>
          ),
          button: "Delete",
          tone: "danger",
          onClick: onDeleteAccountRequest,
        },
      ],
    },
  ];
}
