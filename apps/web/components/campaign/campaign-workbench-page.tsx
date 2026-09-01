"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, CheckCircle2, Save } from "lucide-react";
import { proposeCampaign } from "@/lib/campaign-actions";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
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
      <div className="mx-auto max-w-6xl">
        <CampaignNav current="workbench" />
        <header className="mt-7 border-b border-border pb-7">
          <p className="text-sm font-medium text-muted-foreground">Manual setup</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em]">Campaign workbench</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Create the campaign container with a clear goal and period. This form does not use a chat prompt.
          </p>
        </header>

        {"error" in initialState ? (
          <Alert variant="destructive" className="mt-6">
            <AlertTitle>Campaign setup is unavailable</AlertTitle>
            <AlertDescription>{initialState.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <Card>
            <CardHeader>
              <CardTitle>Campaign details</CardTitle>
              <CardDescription>These are planning facts. You can edit them later while the campaign remains open.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="campaign-name">Campaign name</FieldLabel>
                  <Input
                    id="campaign-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder="Merdeka gift-box launch"
                  />
                  <FieldDescription>Use a name your team will recognize in lists and reports.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="campaign-goal">Goal</FieldLabel>
                  <Textarea
                    id="campaign-goal"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder="Drive pre-orders from returning customers"
                    className="field-sizing-fixed resize-none"
                  />
                  <FieldDescription>Describe the business outcome, not the content format.</FieldDescription>
                </Field>

                <FieldGroup className="gap-5 sm:grid sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="campaign-start">Start date</FieldLabel>
                    <Input id="campaign-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
                  </Field>
                  <Field data-invalid={backwardsPeriod}>
                    <FieldLabel htmlFor="campaign-end">End date</FieldLabel>
                    <Input
                      id="campaign-end"
                      type="date"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                      min={start || undefined}
                      aria-invalid={backwardsPeriod || undefined}
                      aria-describedby={backwardsPeriod ? "campaign-period-error" : undefined}
                    />
                    {backwardsPeriod ? (
                      <FieldError id="campaign-period-error">
                        The campaign end date must be on or after its start date.
                      </FieldError>
                    ) : null}
                  </Field>
                </FieldGroup>

                <Field className="sm:max-w-xs">
                  <FieldLabel htmlFor="campaign-status">Starting status</FieldLabel>
                  <Select value={status} onValueChange={(value) => setStatus(value as "DRAFT" | "ACTIVE")}>
                    <SelectTrigger id="campaign-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="DRAFT">Draft</SelectItem>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Draft keeps the campaign out of active planning until you are ready.</FieldDescription>
                </Field>

                {error ? (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>Campaign could not be created</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </CardContent>
            <Separator />
            <CardFooter className="justify-end py-4">
              <Button type="button" onClick={saveCampaign} disabled={disabled} className="w-full sm:w-auto">
                {saving ? <Spinner data-icon /> : <Save data-icon />}
                {saving ? "Saving campaign" : "Create campaign"}
              </Button>
            </CardFooter>
          </Card>

          <aside className="grid gap-4 lg:sticky lg:top-6">
            <Card size="sm">
              <CardHeader>
                <CardTitle>What happens next</CardTitle>
                <CardDescription>Creating the container does not start any paid or public action.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {[
                  ["Add plan entries", "Turn the goal into dated content drafts."],
                  ["Review the plan", "Approve only the entries you want to keep."],
                  ["Confirm generation", "See the exact credit price before anything starts."],
                ].map(([title, description]) => (
                  <div key={title} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Alert variant="info">
              <CalendarRange />
              <AlertTitle>Zero credits to create</AlertTitle>
              <AlertDescription>Plan estimates added later are display-only until you explicitly confirm generation.</AlertDescription>
            </Alert>
          </aside>
        </div>
      </div>
    </main>
  );
}
