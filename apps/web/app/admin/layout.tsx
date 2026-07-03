import { auth } from "@/lib/better-auth/compat";
import { allowed, isFounderAdmin } from "@/lib/allowlist";
import { redirect } from "next/navigation";
import { AdminV2Nav } from "@/components/admin/AdminV2Nav";

/**
 * Admin City Hall v2 shell. The outer wall stays founder-only until real staff
 * membership replaces the closed-beta gate; individual routes/actions still
 * re-assert their own role checks.
 */
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
    <div className="gb min-h-dvh bg-background text-foreground md:flex">
      <AdminV2Nav />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
