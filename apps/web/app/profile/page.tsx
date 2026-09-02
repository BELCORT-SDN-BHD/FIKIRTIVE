import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { DisplayNameField } from "./ProfileNames";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { SettingsShell } from "@/components/settings/SettingsShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      description="Manage the personal details attached to your account."
    >
      <div className="flex max-w-2xl flex-col gap-6">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Account details</CardTitle>
            <CardDescription>Keep your personal identity on Fikirtive up to date.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-7">
            <DisplayNameField displayName={names.displayName} />
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input id="profile-email" value={names.email} disabled readOnly />
              <FieldDescription>Your sign-in address. Contact support if this needs to change.</FieldDescription>
            </Field>
          </CardContent>
        </Card>
        {/* Sign out lives once, in the global nav's identity menu right next to this
            page's own link (#513 A组返工 item 2) — not duplicated again here. */}

        {/* 账号删除(前端基线合并 FRONT-A1)。它是个人动作,所以落在 Personal 这一面;
            两份法务页现在指的就是这里。产品本身不删任何东西——按钮只开一封邮件。 */}
        <DeleteAccountCard email={names.email} />
      </div>
    </SettingsShell>
  );
}
