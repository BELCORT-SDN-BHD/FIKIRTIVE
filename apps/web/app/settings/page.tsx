import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { WorkspaceNameField } from "@/app/profile/ProfileNames";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Workspace identity only. Personal identity, connections and billing have their own routes. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Fikirtive" };

export default async function SettingsRoutePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const names = await getMyProfileNames();
  if ("error" in names) redirect("/login");

  return (
    <SettingsShell
      active="general"
      title="General"
      description="Manage the name and identity of this workspace."
      scopeNote="Changes affect everyone in this workspace."
    >
      <div className="max-w-2xl">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Workspace identity</CardTitle>
            <CardDescription>This name identifies your workspace. It does not replace your Brand context.</CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceNameField workspaceName={names.workspaceName} />
          </CardContent>
        </Card>
      </div>
    </SettingsShell>
  );
}
