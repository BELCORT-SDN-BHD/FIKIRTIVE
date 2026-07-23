"use client";
import { useEffect, useState } from "react";
import type { AccountInfo } from "@/lib/account-actions";
import { SettingsPage } from "./settings/SettingsPage";
import { buildSettingsSections } from "./settings/sections";
import { getAccountViewData, type AccountViewData } from "@/lib/account-view-data";
import { OttoConfirmDialog } from "./OttoPromptDialog";

export function OttoAccount({ account, previewData }: { account: AccountInfo | null; previewData?: AccountViewData }) {
  const [data, setData] = useState<AccountViewData | null>(previewData ?? null);
  const [failed, setFailed] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
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
  const sections = buildSettingsSections({
    account,
    settings: data.settings,
    channels: data.channels,
    packs: data.packs,
    adsAutonomy: data.adsAutonomy,
    canPublish: data.canPublish,
    onDeleteAccountRequest: () => setDeleteAccountOpen(true),
  });
  return (
    <>
      <SettingsPage sections={sections} />
      <OttoConfirmDialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        title="Request account deletion?"
        description="Otto will open an email request to support. Your workspace is not erased until support handles the request."
        impacts={[
          "You can keep using the account until support confirms deletion.",
          "Billing and credit history may need to be retained for records.",
          "This does not trigger any paid provider action.",
        ]}
        confirmText={account.email}
        confirmLabel="Open email request"
        tone="danger"
        onConfirm={() => {
          location.assign("mailto:tao@belcort.com?subject=Delete%20my%20account");
        }}
      />
    </>
  );
}
export default OttoAccount;
