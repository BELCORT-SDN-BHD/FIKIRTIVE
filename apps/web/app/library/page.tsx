import { redirect } from "next/navigation";
import { auth, allowed } from "@/auth";

/** The old Workbench is retired — element management now lives in the Studio's
 *  Elements surface (the same fully-engined Library). Redirect old /library links
 *  straight to that view, so there's a single UI and no "am I on the old version?"
 *  confusion. (Per-entity ?e deep-links land on the Elements list, not a selection.) */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const session = await auth();
  if (!(await allowed(session?.user?.email))) redirect("/login");
  const { p } = await searchParams;
  redirect(`/studio?view=elements${p ? `&p=${encodeURIComponent(p)}` : ""}`);
}
