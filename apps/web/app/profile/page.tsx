import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { DisplayNameField } from "./ProfileNames";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Fikirtive" };

// #513 三.1 — the identity area's "Profile" destination: who you are, nothing more.
// Team/workspace defaults live under Settings; billing and the spend cap live under
// Billing & credits. This page never reads or writes credits — the one account-level
// action it does carry is deleting the account itself, which spends nothing.
//
export default async function ProfilePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const names = await getMyProfileNames();
  if ("error" in names) redirect("/login");

  return (
    <SettingsShell
      active="profile"
      title="Profile"
      scopeNote="Changes here affect only your account."
      description="Manage the personal details attached to your account."
    >
      {/* 已冻结的 Settings pattern(夹具 `ProfileContent`):一张 `max-w-2xl` 的裸表单
          —— Display name、Email、一个 `Save changes`,不套 card。Email 由身份系统持有,
          所以它是只读字段,跟着显示名字进同一张表。 */}
      <div className="mx-auto w-full max-w-2xl py-8">
        <DisplayNameField displayName={names.displayName}>
          <Field className="mt-7">
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input id="profile-email" value={names.email} disabled readOnly />
            <FieldDescription>Your sign-in address. Contact support if this needs to change.</FieldDescription>
          </Field>
        </DisplayNameField>
        {/* Sign out lives once, in the global nav's identity menu right next to this
            page's own link (#513 A组返工 item 2) — not duplicated again here. */}

        {/* 账号删除(前端基线合并 FRONT-A1)。它是个人动作,所以落在 Personal 这一面;
            两份法务页现在指的就是这里。产品本身不删任何东西——按钮只开一封邮件。
            夹具没有这一块(评审件不声称任何后端能力),所以按第②条例外:用夹具的
            plain row 样式呈现,不自创第三种长相。 */}
        <div className="mt-8 border-t border-border pt-8">
          <DeleteAccountCard email={names.email} />
        </div>
      </div>
    </SettingsShell>
  );
}
