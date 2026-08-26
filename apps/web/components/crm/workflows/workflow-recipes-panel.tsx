"use client";

import { useState } from "react";
import { Clock3, CookingPot, LoaderCircle, Unplug } from "lucide-react";
import {
  getBusinessHoursPolicy,
  listBusinessHoursPolicies,
} from "@/lib/customer-workflow-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dateTimeLabel, workflowErrorMessage } from "./workflow-format";

type PoliciesResult = Awaited<ReturnType<typeof listBusinessHoursPolicies>>;
type Policy = Extract<PoliciesResult, { ok: true }>["resource"]["items"][number];
type PolicyDetailResult = Awaited<ReturnType<typeof getBusinessHoursPolicy>>;
type PolicyDetail = Extract<PolicyDetailResult, { ok: true }>["resource"];

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function minuteLabel(minute: number) {
  const hours = Math.floor(minute / 60).toString().padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function statusLabel(status: string) {
  return `${status.charAt(0).toUpperCase()}${status.slice(1).replaceAll("_", " ")}`;
}

export default function WorkflowRecipesPanel({ initialPolicies }: { initialPolicies: PoliciesResult }) {
  const [policies, setPolicies] = useState<Policy[]>(
    initialPolicies.ok ? initialPolicies.resource.items : [],
  );
  const [cursor, setCursor] = useState(initialPolicies.ok ? initialPolicies.resource.nextCursor : null);
  const [listError, setListError] = useState<string | null>(
    initialPolicies.ok ? null : initialPolicies.error,
  );
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PolicyDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"list" | "detail" | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setBusy("list");
    try {
      const page = await listBusinessHoursPolicies({ cursor, limit: 50 });
      if (!page.ok) setListError(page.error);
      else {
        setPolicies((current) => [...current, ...page.resource.items]);
        setCursor(page.resource.nextCursor);
        setListError(null);
      }
    } catch {
      setListError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  async function viewPolicy(businessHoursPolicyId: string) {
    if (selectedPolicyId === businessHoursPolicyId && detail) {
      setSelectedPolicyId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setSelectedPolicyId(businessHoursPolicyId);
    setDetail(null);
    setDetailError(null);
    setBusy("detail");
    try {
      const result = await getBusinessHoursPolicy({ businessHoursPolicyId });
      if (!result.ok) setDetailError(result.error);
      else setDetail(result.resource);
    } catch {
      setDetailError("NETWORK");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="recipes" className="scroll-mt-8" aria-labelledby="workflow-recipes-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[var(--r22-track-caps)] text-brand-strong">Configure</p>
        <h2 id="workflow-recipes-heading" className="mt-2 text-2xl font-semibold tracking-tight">Recipes and business hours</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Recipes create ordinary workflow definitions and disabled Routine drafts. Installing a recipe never authorizes customer contact.</p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Card className="border-dashed shadow-none">
          <CardContent><span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><CookingPot className="size-4" /></span><div className="mt-4 flex items-center gap-2"><h3 className="font-semibold">Inbox recipes</h3><Badge variant="outline">Unavailable</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">The server-owned recipe catalog is not exposed by the current gateway. No recipe names, versions, or install state are guessed.</p></CardContent>
        </Card>
        <Card>
          <CardContent>
            <span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><Clock3 className="size-4" /></span>
            <div className="mt-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><h3 className="font-semibold">Business hours</h3>{!listError ? <Badge variant="outline">{policies.length} loaded</Badge> : <Badge variant="outline">Unavailable</Badge>}</div></div>
            {listError ? <div className="mt-3 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-sm leading-6 text-warning-soft-foreground" data-error-code={listError}><p>{listError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(listError)} Nothing is guessed in its place.</p></div> : policies.length === 0 ? <p className="mt-3 text-sm leading-6 text-muted-foreground">No business-hours policies exist.</p> : <div className="mt-3 grid gap-2">{policies.map((policy) => <div key={policy.id} className="rounded-xl border border-border bg-secondary/20 p-3"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{policy.name}</p><Badge variant="outline">{statusLabel(policy.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{policy.timeZone}</p></div><Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void viewPolicy(policy.id)}>{busy === "detail" && selectedPolicyId === policy.id ? <LoaderCircle className="animate-spin" /> : null}{selectedPolicyId === policy.id && detail ? "Hide hours" : "View hours"}</Button></div>{selectedPolicyId === policy.id ? <div className="mt-3 border-t border-border pt-3">{detailError ? <div className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-soft-foreground" data-error-code={detailError}><p>{detailError === "NETWORK" ? "The request could not finish." : workflowErrorMessage(detailError)} The schedule remains unavailable.</p></div> : detail ? <div><p className="text-xs font-semibold">Exact weekly windows · {detail.timeZone}</p>{detail.weeklyWindows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No open windows.</p> : <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">{detail.weeklyWindows.map((window, index) => <li key={`${window.weekday}-${window.startMinute}-${index}`}>{WEEKDAYS[window.weekday]}: {minuteLabel(window.startMinute)}–{minuteLabel(window.endMinute)}</li>)}</ul>}<p className="mt-2 text-[11px] text-muted-foreground">Updated {dateTimeLabel(detail.updatedAt)}{detail.supersedesPolicyId ? " · replaces an earlier version of these hours" : ""}</p></div> : <p className="text-xs text-muted-foreground">Reading exact policy hours…</p>}</div> : null}</div>)}{cursor ? <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void loadMore()}>{busy === "list" ? <LoaderCircle className="animate-spin" /> : null}Load more policies</Button> : null}</div>}
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground"><Unplug className="mt-0.5 size-4 shrink-0" /><span>Outside-hours replies remain unavailable until the strict workflow messaging classification is connected. No automatic reply is sent in this simulated workspace.</span></div>
    </section>
  );
}
