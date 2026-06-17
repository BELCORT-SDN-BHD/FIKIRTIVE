import { auth, allowed } from "@/auth";
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
  { href: "/admin/audit", label: "Content & audit", live: true },
  { href: "/admin/team", label: "Team & access", live: true },
  { href: "#", label: "System & queue", live: false },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login");
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
