"use client";

import React, { useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
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
import type { MemoryRow } from "@/lib/memory-actions";
import { BrandRecordRemovalDialog } from "./BrandRecordRemovalDialog";
import { MemoryNoteCard } from "./MemoryNoteCard";
import { MemorySourceBadge } from "./MemorySourceBadge";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";

type SegFields = { name: string; who: string; pains: string; wants: string; channels: string; toneTips: string };

const EMPTY: SegFields = { name: "", who: "", pains: "", wants: "", channels: "", toneTips: "" };

function fieldsOf(data: Record<string, unknown>): SegFields {
  const s = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    name: s(data.name), who: s(data.who), pains: s(data.pains),
    wants: s(data.wants), channels: s(data.channels), toneTips: s(data.toneTips),
  };
}

function SegForm({ initial, onCancel, onSubmit, onSaved }: {
  initial: SegFields;
  onCancel: () => void;
  onSubmit: (data: SegFields) => Promise<string | null>;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<SegFields>(initial);
  const submission = useAsyncActionFeedback("The customer group couldn't be saved. Check your connection and try again.");
  const set = (key: keyof SegFields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));
  const valid = fields.name.trim() && fields.who.trim();

  async function save() {
    const outcome = await submission.run(() => onSubmit(fields));
    if (outcome === "success") onSaved();
  }

  return (
    <FieldGroup className="gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Name *</FieldLabel><Input value={fields.name} onChange={set("name")} placeholder="Young working moms" /></Field>
        <Field><FieldLabel>Where to reach them</FieldLabel><Input value={fields.channels} onChange={set("channels")} placeholder="IG Reels, TikTok" /></Field>
      </div>
      <Field><FieldLabel>Who they are *</FieldLabel><Textarea value={fields.who} onChange={set("who")} rows={2} placeholder="25–38, urban, time-poor" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Pains</FieldLabel><Textarea value={fields.pains} onChange={set("pains")} rows={2} /></Field>
        <Field><FieldLabel>Wants</FieldLabel><Textarea value={fields.wants} onChange={set("wants")} rows={2} /></Field>
      </div>
      <Field><FieldLabel>Tone tips</FieldLabel><Textarea value={fields.toneTips} onChange={set("toneTips")} rows={2} /></Field>
      {submission.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Customer group wasn&apos;t saved</AlertTitle>
          <AlertDescription>{submission.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!valid || submission.pending} onClick={() => void save()}>
          {submission.pending && <Spinner data-icon="inline-start" />}{submission.pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={submission.pending} onClick={onCancel}>Cancel</Button>
      </div>
    </FieldGroup>
  );
}

export function SegmentCards({ records, looseNotes, freshIds, onSave, onDelete, onArchive, onNoteSave, onNoteDelete }: {
  records: BrandRecordRow[];
  looseNotes: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string | undefined, data: SegFields) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onArchive: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>;
  onNoteSave: (id: string, content: string) => Promise<string | null>;
  onNoteDelete: (id: string) => Promise<string | null>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BrandRecordRow | null>(null);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const archiveFeedback = useAsyncActionFeedback("The customer group couldn't be updated. Check your connection and try again.");
  const activeCount = records.filter((record) => record.status === "active").length;
  const ordered = [...records].sort((a, b) => Number(a.status === "archived") - Number(b.status === "archived"));

  async function toggleArchive(record: BrandRecordRow) {
    if (archiveFeedback.pending) return;
    setArchivePendingId(record.id);
    const outcome = await archiveFeedback.run(() => onArchive(
      record.id,
      record.data,
      record.status === "archived" ? "active" : "archived",
    ));
    if (outcome !== "ignored") setArchivePendingId(null);
  }

  return (
    <section className="flex flex-col gap-3">
      {archiveFeedback.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Customer group wasn&apos;t updated</AlertTitle>
          <AlertDescription>{archiveFeedback.error}</AlertDescription>
        </Alert>
      )}
      {ordered.length === 0 && looseNotes.length === 0 && !adding ? (
        <Empty className="min-h-64 border border-dashed border-border"><EmptyHeader><EmptyMedia variant="icon"><Users aria-hidden /></EmptyMedia><EmptyTitle>No customer groups yet</EmptyTitle><EmptyDescription>Add the people your brand serves so Otto can shape messages around their needs.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add customer group</Button></EmptyContent></Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {ordered.map((record) => {
            const details = fieldsOf(record.data);
            const archived = record.status === "archived";
            return (
              <Card key={record.id} size="sm" tone={freshIds.has(record.id) ? "otto" : "default"} className={archived ? "opacity-60" : undefined}>
                {editingId === record.id ? (
                  <CardContent><SegForm initial={details} onCancel={() => setEditingId(null)} onSaved={() => setEditingId(null)} onSubmit={(data) => onSave(record.id, data)} /></CardContent>
                ) : (
                  <><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle>{details.name}</CardTitle>
                    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-xs" variant="ghost" disabled={archivePendingId === record.id} aria-label={`Actions for ${details.name}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44"><DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => setEditingId(record.id)}><Pencil aria-hidden />Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void toggleArchive(record)}>{archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}{archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
                        <DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(record)}><Trash2 aria-hidden />Remove group</DropdownMenuItem>
                      </DropdownMenuGroup></DropdownMenuContent>
                    </DropdownMenu></div><p className="text-sm leading-6 text-muted-foreground">{details.who}</p></CardHeader>
                    <CardContent className="grid gap-2 text-sm text-muted-foreground">
                      {details.pains && <p><span className="font-medium text-foreground">Pains:</span> {details.pains}</p>}
                      {details.wants && <p><span className="font-medium text-foreground">Wants:</span> {details.wants}</p>}
                      {details.channels && <p><span className="font-medium text-foreground">Reach:</span> {details.channels}</p>}
                      {details.toneTips && <p><span className="font-medium text-foreground">Tone:</span> {details.toneTips}</p>}
                    </CardContent>
                    <CardFooter className="justify-between"><MemorySourceBadge source={record.source} />{archivePendingId === record.id ? <Badge><Spinner />{archived ? "Unarchiving…" : "Archiving…"}</Badge> : archived && <Badge variant="outline">Archived</Badge>}</CardFooter></>
                )}
              </Card>
            );
          })}
          {looseNotes.map((note) => <MemoryNoteCard key={note.id} note={note} fresh={freshIds.has(note.id)} onSave={onNoteSave} onDelete={onNoteDelete} />)}
        </div>
      )}
      {adding && <Card size="sm"><CardContent><SegForm initial={EMPTY} onCancel={() => setAdding(false)} onSaved={() => setAdding(false)} onSubmit={(data) => onSave(undefined, data)} /></CardContent></Card>}
      {!adding && (ordered.length > 0 || looseNotes.length > 0) && <div className="flex flex-col items-start gap-2">{activeCount >= 6 && <p className="text-xs text-muted-foreground">Keep groups focused — archive one before adding more.</p>}<Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add customer group</Button></div>}
      <BrandRecordRemovalDialog
        kind="customer group"
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => deleteTarget ? onDelete(deleteTarget.id) : Promise.resolve(null)}
      />
    </section>
  );
}
