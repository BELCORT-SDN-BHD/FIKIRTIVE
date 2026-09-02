"use client";
/**
 * ⚠️ 前端基线合并(FRONT-A1):这一份**已经没有任何路由渲染它**。
 *
 * 换壳之前它是整屏的 Otto 设置面(`/otto?view=account`)。新壳把 Settings 拆成四面之后
 * 那条旧地址落到 General,而这个组件一个挂载点都没有 —— 于是余额、持有、花费上限、账号
 * 删除四块整整消失在商家面前(服务端仍然照旧按上限拒绝动作)。
 *
 * 修复没有把这一整面搬回来(新壳的 Settings 不是一页,把它整块挂回去等于复活已退役的旧
 * 设置面),而是把它真正承重的两块搬到已批准的落点:
 *   · 余额 / 持有 / 花费上限 → Billing & credits(`app/billing/page.tsx`,上限控件是
 *     `app/billing/SpendCapCard.tsx`,复用同一个 NumberField 与 setOwnerSetting);
 *   · 账号删除 → Personal 的 Profile(`app/profile/DeleteAccountCard.tsx`,确认框与文案
 *     逐字照搬本文件下方那一份)。
 *
 * 本文件与 `components/otto/settings/*` 暂时原样留着:它们仍是 main 那份被测实现
 * (`lib/__tests__/account-settings.test.ts` 等直接测 buildSettingsSections)。整块退役是
 * 另一张票,不在「纯合并段」的写集里。**不要在这里再改任何商家可见行为** —— 改了没人看得到。
 */
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
