import { redirect } from "next/navigation";
import { R22ApprovalsView } from "@/components/approvals/R22ApprovalsView";
import { requireOwner } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "empty" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureOutcome = requestedOutcome === "error" || requestedOutcome === "permission" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <R22ApprovalsView fixture fixtureState={fixtureState} fixtureOutcome={fixtureOutcome} />;
  }
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  return <R22ApprovalsView />;
}
