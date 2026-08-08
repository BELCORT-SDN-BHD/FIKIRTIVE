"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarRange, LoaderCircle, Save } from "lucide-react";
import { proposeCampaign } from "@/lib/campaign-actions";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CampaignNav } from "./campaign-nav";

type ListResult = Awaited<ReturnType<typeof listCampaigns>>;

export default function CampaignWorkbenchPage({ initialState }: { initialState: ListResult }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCampaign() {
    if ("error" in initialState || !name.trim() || !goal.trim() || !start || !end) return;
    setSaving(true);
    setError(null);
    try {
      const result = await proposeCampaign({
        campaignId: initialState.nextCampaignId,
        campaignProof: initialState.nextCampaignProof,
        title: name,
        goal,
        status,
        period: { start, end, tz: "Asia/Kuala_Lumpur" },
        theme: name,
        items: [],
        ideas: [],
      });
      if (!("ok" in result)) {
        setError(result.error);
        return;
      }
      router.push(`/campaign/${result.campaignId}`);
    } catch {
      setError("The save request could not finish. Retry this same draft.");
    } finally {
      setSaving(false);
    }
  }

  // #714 — the date picker enforces min={start}, but a typed or pasted end date does not go
  // through it. Both dates are YYYY-MM-DD here, so a plain string compare is the same order
  // the server's period check uses. This only saves the merchant a round trip: the server
  // refuses the same input with the same sentence.
  const backwardsPeriod = Boolean(start && end && end < start);
  const disabled = "error" in initialState || saving || !name.trim() || !goal.trim() || !start || !end || backwardsPeriod;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-5xl">
        <CampaignNav current="workbench" />
        <header className="mt-7 border-b border-border pb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Structured setup</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Campaign workbench</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Create the campaign container with a clear goal and period. This form does not use a chat prompt.
          </p>
        </header>

        {"error" in initialState ? (
          <div className="mt-6 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">
            {initialState.error}
          </div>
        ) : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Campaign details</CardTitle>
            <CardDescription>All fields are editable planning facts. No content is generated or sent.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">
              Campaign name
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Merdeka gift-box launch" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Goal
              <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} placeholder="Drive pre-orders from returning customers" />
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Start date
                <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                End date
                <Input
                  type="date"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  min={start || undefined}
                  aria-invalid={backwardsPeriod || undefined}
                  aria-describedby={backwardsPeriod ? "campaign-period-error" : undefined}
                />
                {backwardsPeriod ? (
                  <span id="campaign-period-error" className="text-sm font-normal text-destructive">
                    The campaign end date must be on or after its start date.
                  </span>
                ) : null}
              </label>
            </div>
            <label className="grid gap-2 text-sm font-semibold sm:max-w-xs">
              Status
              <Select value={status} onValueChange={(value) => setStatus(value as "DRAFT" | "ACTIVE")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="rounded-xl border border-info/25 bg-info-soft p-4 text-sm leading-6 text-info-soft-foreground">
              <span className="flex items-start gap-2">
                <CalendarRange className="mt-0.5 size-4 shrink-0" />
                Campaign creation costs zero credits. Plan estimates added later are display-only.
              </span>
            </div>
            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            ) : null}
            <Button type="button" onClick={saveCampaign} disabled={disabled} className="w-full sm:w-fit">
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              {saving ? "Saving campaign" : "Create campaign"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

