import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyAccount, signOutAction } from "@/lib/account-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Fikirtive" };

// #513 三.1 — the identity area's "Profile" destination: who you are, nothing more.
// Team/workspace defaults live under Workspace settings; billing lives under Billing
// & credits. This page never reads or writes credits.
export default async function ProfilePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  const accountResult = await getMyAccount();
  const account = "error" in accountResult ? null : accountResult;
  const name = owner.email.split("@")[0];

  return (
    <div className="gb" style={{ flex: 1, overflow: "auto", minHeight: "100dvh", padding: 24 }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>Profile</h1>
        <p className="text-muted-foreground" style={{ fontSize: 16, marginTop: 6, marginBottom: 24 }}>
          Who you are on Fikirtive.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="text-muted-foreground" style={{ fontSize: 13 }}>Name</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{name}</div>
          </div>
          <div>
            <div className="text-muted-foreground" style={{ fontSize: 13 }}>Email</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{owner.email}</div>
          </div>
          {account && (
            <div>
              <div className="text-muted-foreground" style={{ fontSize: 13 }}>Workspace</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{account.organizationName}</div>
            </div>
          )}
        </div>

        <form action={signOutAction} style={{ marginTop: 32 }}>
          <button
            type="submit"
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: "var(--radius-card, 10px)",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
