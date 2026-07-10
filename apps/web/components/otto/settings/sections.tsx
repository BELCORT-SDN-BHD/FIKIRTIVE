"use client";
import type { SettingsSection } from "./types";
import type { AccountInfo } from "@/lib/account-actions";
import { signOutAction } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { setAdsAutonomy } from "@/lib/otto-client-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { creditsLabel } from "@/lib/credit-format";
import type { CreditPack } from "@/lib/billing-actions";

export type ChannelState = {
  id: string;
  label: string;
  status: "connected" | "needs_reconnect" | "not_connected";
  targets: string[];
  connectUrl: string;
};

function fmtPrice(amountCents: number, currency: string): string {
  return (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export function buildSettingsSections(args: {
  account: AccountInfo;
  settings: OwnerSettings;
  channels: ChannelState[];
  packs: CreditPack[];
  adsAutonomy: "ASK" | "AUTO";
  onDeleteAccountRequest: () => void;
}): SettingsSection[] {
  const { account, settings, channels, packs, adsAutonomy, onDeleteAccountRequest } = args;
  const canChangeAdsAutonomy = channels.some((c) => c.status === "connected");

  const toggle =
    (k: keyof OwnerSettings) =>
    (v: boolean) => setOwnerSetting(k, v as never);

  const num =
    (k: keyof OwnerSettings) =>
    (v: number) => setOwnerSetting(k, v as never);

  return [
    {
      id: "profile",
      title: "Profile",
      subtitle: "Who you are on Fikirtive.",
      fields: [
        {
          kind: "text",
          id: "email",
          label: "Email",
          hint: "Used to sign in",
          value: account.email,
          readOnly: true,
        },
        {
          kind: "custom",
          id: "signout",
          render: () => (
            <form action={signOutAction} style={{ marginLeft: "auto" }}>
              <button className="cv-set-btn" type="submit">
                Sign out
              </button>
            </form>
          ),
        },
      ],
    },
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
                <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {creditsLabel(account.balance)}
                </div>
                {account.reserved > 0 ? (
                  <div className="cv-set-hint">
                    {creditsLabel(account.reserved)} on hold
                  </div>
                ) : null}
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {packs.length > 0 ? (
                  packs.map((pack) => (
                    <BuyPackButton
                      key={pack.priceId}
                      priceId={pack.priceId}
                      label={`Buy · ${fmtPrice(pack.amountCents, pack.currency)}`}
                    />
                  ))
                ) : (
                  <span className="cv-set-hint">
                    No credit packs available right now.
                  </span>
                )}
              </div>
            </div>
          ),
        },
        {
          kind: "custom",
          id: "ledger",
          render: () => (
            <div style={{ width: "100%" }}>
              {account.recent.slice(0, 8).map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 15px",
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{a.label}</span>
                  <span
                    style={{
                      color:
                        a.delta > 0 ? "#15803D" : "var(--muted-foreground)",
                      fontVariantNumeric: "tabular-nums",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                    }}
                  >
                    {a.delta > 0 ? "+" : ""}
                    {a.delta}
                  </span>
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
        "Connect Instagram and Facebook so OTTO can schedule posts, remind you to post, and read results — auto-publish is coming soon.",
      fields: channels.map((c) => ({
        kind: "custom" as const,
        id: `conn-${c.id}`,
        render: () => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div>
              <div className="cv-set-lbl">{c.label}</div>
              <div className="cv-set-hint">
                {c.status === "connected"
                  ? c.targets.join(", ") || "Connected"
                  : c.status === "needs_reconnect"
                    ? "Reconnect needed"
                    : "Not connected"}
              </div>
            </div>
            <a className="cv-set-btn" href={c.connectUrl}>
              {c.status === "connected" ? "Manage" : c.status === "needs_reconnect" ? "Reconnect" : "Connect"}
            </a>
          </div>
        ),
      })),
    },
    {
      id: "otto",
      title: "OTTO behavior",
      subtitle: "How much OTTO does on its own.",
      fields: [
        {
          kind: "toggle",
          id: "ads",
          label: "Ask before ad spend",
          hint: canChangeAdsAutonomy
            ? "OTTO checks with you before spending on ads"
            : "Connect Meta before changing ad-spend autonomy",
          value: adsAutonomy === "ASK",
          disabled: !canChangeAdsAutonomy,
          onToggle: (v) => setAdsAutonomy(v ? "ASK" : "AUTO"),
        },
        {
          kind: "toggle",
          id: "autopub",
          label: "Auto-publish posts",
          hint: "Publish approved posts automatically at their time",
          value: settings.autoPublish,
          onToggle: toggle("autoPublish"),
        },
        {
          kind: "number",
          id: "cap",
          label: "Spend cap",
          hint: "OTTO pauses a task over this many credits (0 = no cap)",
          value: settings.spendCapCredits,
          unit: "credits",
          onSave: num("spendCapCredits"),
        },
      ],
    },
    {
      id: "notifications",
      title: "Notifications",
      fields: [
        {
          kind: "toggle",
          id: "nemail",
          label: "Email",
          value: settings.notifyEmail,
          onToggle: toggle("notifyEmail"),
        },
        {
          kind: "toggle",
          id: "ninapp",
          label: "In-app",
          value: settings.notifyInApp,
          onToggle: toggle("notifyInApp"),
        },
      ],
    },
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
    {
      id: "danger",
      title: "Danger zone",
      danger: true,
      fields: [
        {
          kind: "action",
          id: "del",
          label: "Delete account",
          hint: "Hides your workspace. Contact us to fully erase.",
          button: "Delete",
          tone: "danger",
          onClick: onDeleteAccountRequest,
        },
      ],
    },
  ];
}
