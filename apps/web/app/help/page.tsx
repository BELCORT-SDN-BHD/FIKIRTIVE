import { redirect } from "next/navigation";
import { R22HelpView } from "@/components/help/R22HelpView";
import { requireOwner } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function HelpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requested = first(params.state);
    const state = requested === "loading" || requested === "error" || requested === "permission" || requested === "unknown" ? requested : "ready";
    const requestedSupportOutcome = first(params.supportOutcome);
    const supportOutcome = requestedSupportOutcome === "error" || requestedSupportOutcome === "unknown" ? requestedSupportOutcome : "success";
    const requestedSupportPhase = first(params.support);
    const initialSupportPhase = requestedSupportPhase === "review" || requestedSupportPhase === "queued" || requestedSupportPhase === "waiting" || requestedSupportPhase === "closed" ? requestedSupportPhase : undefined;
    return <R22HelpView fixture state={state} initialArticleId={first(params.article)} supportOutcome={supportOutcome} initialSupportPhase={initialSupportPhase} />;
  }
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  return <R22HelpView />;
}
