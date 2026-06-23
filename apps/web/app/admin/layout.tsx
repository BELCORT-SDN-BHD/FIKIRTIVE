import { auth, allowed, isFounderAdmin } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

/**
 * OPT-6 P1a admin shell. Server component: gates with auth() + the email
 * allowlist (R7), then renders a left-nav + content pane. Only Settings and
 * "Prompt & knowledge" (the existing /admin/directives) are live; the rest are
 * disabled "Coming soon" placeholders, one per planned OPT-6 section. The admin
 * ACTIONS still re-assert requireAdmin independently — this wall is convenience,
 * not the only guard.
 */
const NAV = [
  { href: "/admin/settings", label: "Settings", live: true },
  { href: "/admin/directives", label: "Prompt & knowledge", live: true },
  { href: "/admin/knowledge", label: "Knowledge", live: true },
  { href: "/admin/models", label: "Model & provider", live: true },
  { href: "/admin/cost", label: "Cost & usage", live: true },
  { href: "/admin/credits", label: "Credits", live: true },
  { href: "/admin/content", label: "Content review", live: true },
  { href: "/admin/conversations", label: "Otto conversations", live: true },
  { href: "/admin/team", label: "Team & access", live: true },
  { href: "/admin/tenants", label: "Tenants", live: true },
  { href: "/admin/system", label: "System & queue", live: true },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!(await allowed(session?.user?.email))) redirect("/login");
  // Closed-beta: /admin is founder-only. The allowlist (allowed()) admits every beta
  // merchant, and the default User.role is "viewer" — which SECTION_MATRIX grants read on
  // model/system/knowledge. Without this gate a merchant could open /admin/system and see
  // platform-wide spend + every org's queue. Lock to the founder until real staff roles
  // are provisioned; expand to a staff check (founder-org membership) when that happens.
  if (!isFounderAdmin(session?.user?.email)) redirect("/");
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        {NAV.map((n) =>
          n.live ? (
            <Link key={n.label} href={n.href} className="admin-nav-link">{n.label}</Link>
          ) : (
            <span key={n.label} className="admin-nav-link is-disabled" title="Coming soon">{n.label}</span>
          ),
        )}
      </nav>
      <main className="admin-content">{children}</main>
    </div>
  );
}
