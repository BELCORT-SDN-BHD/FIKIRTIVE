import { redirect } from "next/navigation";

/** The old Library/Workbench is retired — asset management now lives in Otto's
 *  Library surface. Redirect old /library links straight to Otto (which does its
 *  own auth gate via requireOwner), so there's a single UI and no "am I on the old
 *  version?" confusion. */
export default async function LibraryPage() {
  redirect("/otto?view=library");
}
