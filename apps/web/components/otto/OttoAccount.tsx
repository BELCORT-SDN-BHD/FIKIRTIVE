"use client";
import { useEffect, useState } from "react";
import type { AccountInfo } from "@/lib/account-actions";
import { SettingsPage } from "./settings/SettingsPage";
import { buildSettingsSections } from "./settings/sections";
import { getAccountViewData, type AccountViewData } from "@/lib/account-view-data";
import { supportMailto } from "@/lib/exits";
import { OttoConfirmDialog } from "./OttoPromptDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

function SettingsError({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <Alert role="alert" variant="warning">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </div>
  );
}

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

  if (!account) return <SettingsError title="Account unavailable" description="Refresh to try reading your account again." />;
  if (failed) return <SettingsError title="Settings unavailable" description="Refresh to try loading your workspace settings again." />;
  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-10 sm:px-8" aria-label="Loading settings">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="mt-4 h-56 w-full" />
      </div>
    );
  }
  const sections = buildSettingsSections({
    account,
    settings: data.settings,
    channels: data.channels,
    shelf: data.shelf,
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
          location.assign(supportMailto("Delete my account"));
        }}
      />
    </>
  );
}
export default OttoAccount;
