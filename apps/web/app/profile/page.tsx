import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-actions";
import { ProfileNames } from "./ProfileNames";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Fikirtive" };

// #513 三.1 — the identity area's "Profile" destination: who you are, nothing more.
// Team/workspace defaults live under Workspace settings; billing lives under Billing
// & credits. This page never reads or writes credits.
//
// #542 — and it is now WRITABLE. Both names live here rather than in Settings because
// Settings deliberately has no identity section: #513 A组返工 item 2 removed its "profile"
// section precisely because it duplicated this page (see the comment in
// components/otto/settings/sections.tsx). Putting the workspace name back into Settings
// would re-create that duplication; putting it next to the merchant's own name is where
// "who you are on Fikirtive" already lives, and it is the promise /signup already makes
// under the shop-name field ("You can change it later").
export default async function ProfilePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const names = await getMyProfileNames();
  if ("error" in names) redirect("/login");

  return (
    <div className="gb" style={{ flex: 1, overflow: "auto", minHeight: "100dvh", padding: 24 }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>Profile</h1>
        <p className="text-muted-foreground" style={{ fontSize: 16, marginTop: 6, marginBottom: 24 }}>
          Who you are on Fikirtive.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ProfileNames displayName={names.displayName} workspaceName={names.workspaceName} />
          <div>
            <div className="text-muted-foreground" style={{ fontSize: 13 }}>Email</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{names.email}</div>
          </div>
        </div>
        {/* Sign out lives once, in the global nav's identity menu right next to this
            page's own link (#513 A组返工 item 2) — not duplicated again here. */}
      </div>
    </div>
  );
}
