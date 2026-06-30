"use client";
import { useEffect, useState } from "react";
import type { AccountInfo } from "@/lib/account-actions";
import { SettingsPage } from "./settings/SettingsPage";
import { buildSettingsSections } from "./settings/sections";
import { getAccountViewData, type AccountViewData } from "@/lib/account-view-data";

export function OttoAccount({ account, previewData }: { account: AccountInfo | null; previewData?: AccountViewData }) {
  const [data, setData] = useState<AccountViewData | null>(previewData ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (previewData) return; // harness injects data; skip the fetch
    let alive = true;
    getAccountViewData()
      .then((r) => { if (alive) { if ("error" in r) setFailed(true); else setData(r); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [previewData]);

  if (!account) return <div className="cv-settings-body">Could not load your account.</div>;
  if (failed) return <div className="cv-settings-body">Could not load your settings. Please refresh.</div>;
  if (!data) return <div className="cv-settings-body">Loading…</div>;
  const sections = buildSettingsSections({ account, settings: data.settings, channels: data.channels, packs: data.packs, adsAutonomy: data.adsAutonomy });
  return <SettingsPage sections={sections} />;
}
export default OttoAccount;
