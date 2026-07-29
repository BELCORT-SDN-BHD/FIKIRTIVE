"use client";
import type { SettingsSection } from "./types";
import type { AccountInfo } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { setAdsAutonomy } from "@/lib/otto-client-actions";
import type { CreditPack } from "@/lib/billing-actions";
import { AUTO_PUBLISH_GATE_HINT, canAutoPublish } from "@/lib/auto-publish-gate";

export type ChannelState = {
  id: string;
  label: string;
  status: "connected" | "needs_reconnect" | "not_connected";
  targets: string[];
  connectUrl: string;
};

export function buildSettingsSections(args: {
  account: AccountInfo;
  settings: OwnerSettings;
  channels: ChannelState[];
  packs: CreditPack[];
  adsAutonomy: "ASK" | "AUTO";
  canPublish: boolean;
  onDeleteAccountRequest: () => void;
}): SettingsSection[] {
  const { settings, channels, adsAutonomy, canPublish, onDeleteAccountRequest } = args;
  const canChangeAdsAutonomy = channels.some((c) => c.status === "connected");
  const connectedChannelIds = channels.filter((c) => c.status === "connected").map((c) => c.id);
  const autoPublishAvailable = canAutoPublish(connectedChannelIds, canPublish);

  const toggle =
    (k: keyof OwnerSettings) =>
    (v: boolean) => setOwnerSetting(k, v as never);

  const num =
    (k: keyof OwnerSettings) =>
    (v: number) => setOwnerSetting(k, v as never);

  // "profile" and "billing" sections were removed here (#513 A组返工 item 2) — they
  // duplicated the global nav's Profile page and Billing & credits destination
  // (identity/email/workspace, credit balance + buy buttons, and their own Sign out).
  return [
    {
      id: "connections",
      title: "Connections",
      subtitle:
        "Connect Instagram and Facebook so Otto can schedule posts and read results — auto-publish unlocks once Meta approves publishing.",
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
      title: "Otto behavior",
      subtitle: "How much Otto does on its own.",
      fields: [
        {
          kind: "toggle",
          id: "ads",
          label: "Ask before ad spend",
          hint: canChangeAdsAutonomy
            ? "Otto checks with you before spending on ads"
            : "Connect Meta before changing ad-spend autonomy",
          value: adsAutonomy === "ASK",
          disabled: !canChangeAdsAutonomy,
          onToggle: (v) => setAdsAutonomy(v ? "ASK" : "AUTO"),
        },
        {
          kind: "toggle",
          id: "autopub",
          label: "Auto-publish posts",
          hint: autoPublishAvailable
            ? "Publish approved posts automatically at their time"
            : AUTO_PUBLISH_GATE_HINT,
          value: settings.autoPublish,
          disabled: !autoPublishAvailable,
          onToggle: toggle("autoPublish"),
        },
        {
          kind: "number",
          id: "cap",
          label: "Spend cap",
          hint: "Otto pauses a task over this many credits (0 = no cap)",
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
