"use client";

import React, { useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { offerPhase } from "@fikirtive/core/brand-records";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import { shortDayLabel } from "@/lib/short-date-label";
import { BrandRecordRemovalDialog } from "./BrandRecordRemovalDialog";
import { MemorySourceBadge } from "./MemorySourceBadge";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";

type OfferFields = { title: string; details: string; code: string; appliesTo: string; startsAt: string; endsAt: string };

const EMPTY: OfferFields = { title: "", details: "", code: "", appliesTo: "", startsAt: "", endsAt: "" };

function dateInput(value: Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function fieldsOf(record: BrandRecordRow): OfferFields {
  const data = record.data as Record<string, unknown>;
  const s = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    title: s(data.title), details: s(data.details), code: s(data.code), appliesTo: s(data.appliesTo),
    startsAt: dateInput(record.startsAt), endsAt: dateInput(record.endsAt),
  };
}

function datePill(record: BrandRecordRow, now: Date): string | null {
  const phase = offerPhase(record, now);
  const format = (date: Date) => shortDayLabel(new Date(date));
  if (phase === "scheduled" && record.startsAt) return `Starts ${format(record.startsAt)}`;
  if (record.endsAt) return `Ends ${format(record.endsAt)}`;
  return null;
}

function toData(fields: OfferFields): Record<string, unknown> {
  return {
    title: fields.title.trim(),
    ...(fields.details.trim() ? { details: fields.details.trim() } : {}),
    ...(fields.code.trim() ? { code: fields.code.trim() } : {}),
    ...(fields.appliesTo.trim() ? { appliesTo: fields.appliesTo.trim() } : {}),
  };
}

function OfferForm({ initial, onCancel, onSubmit, onSaved }: {
  initial: OfferFields;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>, dates: { startsAt: string | null; endsAt: string | null }) => Promise<string | null>;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<OfferFields>(initial);
  const submission = useAsyncActionFeedback("The offer couldn't be saved. Check your connection and try again.");
  const set = (key: keyof OfferFields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    const outcome = await submission.run(() => onSubmit(
      toData(fields),
      { startsAt: fields.startsAt || null, endsAt: fields.endsAt || null },
    ));
    if (outcome === "success") onSaved();
  }

  return (
    <FieldGroup className="gap-4">
      <Field><FieldLabel>Title *</FieldLabel><Input value={fields.title} onChange={set("title")} placeholder="Raya sale — 20% off" /></Field>
      <Field><FieldLabel>Details</FieldLabel><Textarea value={fields.details} onChange={set("details")} rows={2} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Code</FieldLabel><Input value={fields.code} onChange={set("code")} placeholder="RAYA20" /></Field>
        <Field><FieldLabel>Applies to</FieldLabel><Input value={fields.appliesTo} onChange={set("appliesTo")} placeholder="All breakfast sets" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Starts</FieldLabel><Input type="date" value={fields.startsAt} onChange={set("startsAt")} /></Field>
        <Field><FieldLabel>Ends</FieldLabel><Input type="date" value={fields.endsAt} onChange={set("endsAt")} /></Field>
      </div>
      {submission.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Offer wasn&apos;t saved</AlertTitle>
          <AlertDescription>{submission.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!fields.title.trim() || submission.pending} onClick={() => void save()}>
          {submission.pending && <Spinner data-icon="inline-start" />}{submission.pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={submission.pending} onClick={onCancel}>Cancel</Button>
      </div>
    </FieldGroup>
  );
}

function OfferCard({ record, now, fresh, past, onEdit, onDelete, onDuplicate }: {
  record: BrandRecordRow;
  now: Date;
  fresh: boolean;
  past: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const data = record.data as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : "";
  const pill = datePill(record, now);

  return (
    <Card size="sm" tone={fresh ? "otto" : "default"} className={past ? "opacity-60" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><CardTitle>{title}</CardTitle>{typeof data.details === "string" && data.details && <p className="mt-1 text-sm leading-6 text-muted-foreground">{data.details}</p>}</div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-xs" variant="ghost" aria-label={`Actions for ${title}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40"><DropdownMenuGroup>
              {past ? <DropdownMenuItem onSelect={onDuplicate}><Copy aria-hidden />Duplicate</DropdownMenuItem> : <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden />Edit</DropdownMenuItem>}
              <DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 aria-hidden />Remove offer</DropdownMenuItem>
            </DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {typeof data.code === "string" && data.code && <Badge variant="outline" className="font-mono">{data.code}</Badge>}
        {typeof data.appliesTo === "string" && data.appliesTo && <Badge variant="outline">{data.appliesTo}</Badge>}
        {pill && <Badge variant="outline">{pill}</Badge>}
        {past && <Badge variant="outline">Past</Badge>}
      </CardContent>
      <CardFooter><MemorySourceBadge source={record.source} /></CardFooter>
    </Card>
  );
}

export function OfferList({ records, freshIds, onSave, onDelete }: {
  records: BrandRecordRow[];
  freshIds: Set<string>;
  onSave: (id: string | undefined, data: Record<string, unknown>, dates: { startsAt: string | null; endsAt: string | null }) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const now = new Date();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<OfferFields>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<BrandRecordRow | null>(null);
  const active = records.filter((record) => offerPhase(record, now) !== "expired");
  const past = records.filter((record) => offerPhase(record, now) === "expired");

  const duplicate = (record: BrandRecordRow) => {
    setPrefill({ ...fieldsOf(record), startsAt: "", endsAt: "" });
    setAdding(true);
  };

  return (
    <section className="flex flex-col gap-3">
      {active.length === 0 && !adding ? (
        <Empty className="min-h-64 border border-dashed border-border"><EmptyHeader><EmptyMedia variant="icon"><Tag aria-hidden /></EmptyMedia><EmptyTitle>No active offers</EmptyTitle><EmptyDescription>Add a promotion so Otto can use the right promise, code, and dates in future work.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" variant="secondary" onClick={() => { setPrefill(EMPTY); setAdding(true); }}><Plus data-icon="inline-start" />Add offer</Button></EmptyContent></Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((record) => editingId === record.id ? (
            <Card key={record.id} size="sm"><CardContent><OfferForm initial={fieldsOf(record)} onCancel={() => setEditingId(null)} onSaved={() => setEditingId(null)} onSubmit={(data, dates) => onSave(record.id, data, dates)} /></CardContent></Card>
          ) : (
            <OfferCard key={record.id} record={record} now={now} fresh={freshIds.has(record.id)} past={false} onEdit={() => setEditingId(record.id)} onDelete={() => setDeleteTarget(record)} onDuplicate={() => duplicate(record)} />
          ))}
        </div>
      )}

      {adding && <Card size="sm"><CardContent><OfferForm initial={prefill} onCancel={() => { setAdding(false); setPrefill(EMPTY); }} onSaved={() => { setAdding(false); setPrefill(EMPTY); }} onSubmit={(data, dates) => onSave(undefined, data, dates)} /></CardContent></Card>}
      {!adding && active.length > 0 && <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => { setPrefill(EMPTY); setAdding(true); }}><Plus data-icon="inline-start" />Add offer</Button>}

      {past.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Past offers ({past.length})</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{past.map((record) => <OfferCard key={record.id} record={record} now={now} fresh={freshIds.has(record.id)} past onEdit={() => {}} onDelete={() => setDeleteTarget(record)} onDuplicate={() => duplicate(record)} />)}</div></details>}
      <BrandRecordRemovalDialog
        kind="offer"
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => deleteTarget ? onDelete(deleteTarget.id) : Promise.resolve(null)}
      />
    </section>
  );
}
