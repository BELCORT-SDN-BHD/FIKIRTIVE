import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { DisplayNameField } from "./ProfileNames";
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
// Team/workspace defaults live under Settings; billing lives under Billing
// & credits. This page never reads or writes credits.
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
      <div className="max-w-2xl">
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
      </div>
    </SettingsShell>
  );
}
