import { redirect } from "next/navigation";

/** The separate "Simple mode" (/m) merchant surface is retired — Otto IS the single
 *  merchant surface now. Redirect old /m links to /otto (which does its own auth gate
 *  via requireOwner), so there is one Otto, not two. */
export default async function SimplePage() {
  redirect("/otto");
}
