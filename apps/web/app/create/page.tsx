import { R22ProjectsEntry } from "@/components/projects/R22ProjectsEntry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canvas projects · Fikirtive" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <R22ProjectsEntry searchParams={searchParams} />;
}
