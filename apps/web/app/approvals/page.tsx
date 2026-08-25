import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals · Fikirtive" };

export default async function ApprovalsAliasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
    else if (value !== undefined) next.set(key, value);
  }
  const query = next.toString();
  redirect(`/campaign/workbench${query ? `?${query}` : ""}`);
}
