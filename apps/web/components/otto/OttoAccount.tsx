"use client";
import { useRouter } from "next/navigation";
import type { AccountInfo } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import type { CreditPack } from "@/lib/billing-actions";
import { SettingsPage } from "./settings/SettingsPage";
import { buildSettingsSections, type ChannelState } from "./settings/sections";

export function OttoAccount({ account, settings, channels = [], packs = [], adsAutonomy = "ASK" }: {
  account: AccountInfo | null;
  settings?: OwnerSettings;
  channels?: ChannelState[];
  packs?: CreditPack[];
  adsAutonomy?: "ASK" | "AUTO";
}) {
  const router = useRouter();
  if (!account) return <div className="cv-settings-body">Could not load your account.</div>;
  const sections = buildSettingsSections({ account, settings: settings ?? DEFAULT_SETTINGS, channels, packs, adsAutonomy, onSettings: () => router.refresh() });
  return <SettingsPage sections={sections} />;
}
export default OttoAccount;
