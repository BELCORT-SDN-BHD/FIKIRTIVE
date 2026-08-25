import { R22RoutinesEntry } from "@/components/routines/R22RoutinesEntry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Routines · Fikirtive" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <R22RoutinesEntry searchParams={searchParams} />;
}
