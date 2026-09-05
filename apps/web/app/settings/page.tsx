import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { WorkspaceNameField } from "@/app/profile/ProfileNames";
import { SettingsShell } from "@/components/settings/SettingsShell";

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
      {/* 已冻结的 Settings pattern §3.3:一面之内按任务组成 section,默认 plain rows / forms,
          不给单个表单套一张 marketing card。夹具的 General 就是一个 `max-w-2xl` 的裸表单。 */}
      <div className="mx-auto w-full max-w-2xl py-8">
        <WorkspaceNameField workspaceName={names.workspaceName} />
      </div>
    </SettingsShell>
  );
}
