import { redirect } from "next/navigation";
import { R22HelpView } from "@/components/help/R22HelpView";
import { R22HelpClosed } from "@/components/help/R22HelpClosed";
import { BETA_HELP_GATE_PARAM, helpDoorOpen } from "@/components/help/r22-help-beta";
import { requireOwner } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function HelpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  /*
   * beta 期这扇门收着(`r22-help-beta.ts` 的 `BETA_HELP_DOOR`)。地址仍然到得了 —— 商家
   * 从旧链接、收藏夹或直接输进来都不 404,落在一句实话上;`?help=all` 原样开回来。
   * 闸不越过鉴权:这一面照旧先认人,再决定给他哪一面。
   */
  const doorOpen = helpDoorOpen(params[BETA_HELP_GATE_PARAM]);
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    if (!doorOpen) return <R22HelpClosed />;
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
  if (!doorOpen) return <R22HelpClosed />;
  return <R22HelpView />;
}
