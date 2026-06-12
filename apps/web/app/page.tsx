import { redirect } from "next/navigation";

/** The redesigned Studio is the product. The root launches straight into it,
 *  preserving the project context (?p) so links through "/" don't silently drop
 *  back to the default (oldest) project. */
export default async function Page({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  redirect(p ? `/studio?p=${encodeURIComponent(p)}` : "/studio");
}
