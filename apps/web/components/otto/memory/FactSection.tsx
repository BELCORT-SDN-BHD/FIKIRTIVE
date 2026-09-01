"use client";

import React, { useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryRow } from "@/lib/memory-actions";
import { MemorySourceBadge } from "./MemorySourceBadge";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";

function FactForm({
  value,
  label,
  placeholder,
  submitLabel,
  onCancel,
  onSubmit,
  onSaved,
}: {
  value: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<string | null>;
  onSaved: () => void;
}) {
  const [text, setText] = useState(value);
  const submission = useAsyncActionFeedback("The brand detail couldn't be saved. Check your connection and try again.");

  async function save() {
    const outcome = await submission.run(() => onSubmit(text.trim()));
    if (outcome === "success") onSaved();
  }

  return (
    <Card size="sm">
      <CardHeader>
        <FieldGroup>
          <Field>
            <FieldLabel className="sr-only">{label}</FieldLabel>
            <Textarea
              aria-label={label}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              placeholder={placeholder}
              autoFocus
            />
          </Field>
        </FieldGroup>
      </CardHeader>
      {submission.error && (
        <CardContent>
          <Alert variant="destructive" role="alert">
            <AlertTitle>Brand detail wasn&apos;t saved</AlertTitle>
            <AlertDescription>{submission.error}</AlertDescription>
          </Alert>
        </CardContent>
      )}
      <CardFooter>
        <Button
          type="button"
          size="sm"
          disabled={!text.trim() || submission.pending}
          onClick={() => void save()}
        >
          {submission.pending && <Spinner data-icon="inline-start" />}
          {submission.pending ? (submitLabel === "Add detail" ? "Adding…" : "Saving…") : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={submission.pending} onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

export function FactSection({ label, rows, freshIds, onSave, onDelete, onAdd }: {
  label: string;
  rows: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string, content: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onAdd: (content: string) => Promise<string | null>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteSubmittingRef = useRef(false);

  async function removeDetail() {
    if (!deleteTarget || deleteSubmittingRef.current) return;

    deleteSubmittingRef.current = true;
    setDeletePending(true);
    setDeleteError(null);

    try {
      const failure = await onDelete(deleteTarget.id);
      if (failure) {
        setDeleteError(failure);
        return;
      }

      setDeleteTarget(null);
    } catch {
      setDeleteError("The detail couldn't be removed. Check your connection and try again.");
    } finally {
      deleteSubmittingRef.current = false;
      setDeletePending(false);
    }
  }

  return (
    <section aria-label={label || "Saved brand details"} className="flex flex-col gap-3">
      {label && <h3 className="text-sm font-semibold text-foreground">{label}</h3>}

      {rows.length === 0 && !adding ? (
        <Empty className="min-h-56 border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No saved details yet</EmptyTitle>
            <EmptyDescription>
              Add the first detail here, or ask Otto to organise what you describe above.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              Add detail
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        rows.map((row) => (
          editingId === row.id ? (
            <FactForm
              key={row.id}
              value={row.content}
              label="Edit this fact"
              placeholder="Write a durable detail Otto should remember…"
              submitLabel="Save"
              onCancel={() => setEditingId(null)}
              onSubmit={(content) => onSave(row.id, content)}
              onSaved={() => setEditingId(null)}
            />
          ) : (
            <Card key={row.id} size="sm" tone={freshIds.has(row.id) ? "otto" : "default"}>
              <CardHeader>
                <p className="text-sm leading-6 text-foreground">{row.content}</p>
              </CardHeader>
              <CardFooter className="justify-between">
                <MemorySourceBadge source={row.source} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={`Actions for ${row.content}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => setEditingId(row.id)}>
                        <Pencil aria-hidden />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          setDeleteError(null);
                          setDeleteTarget(row);
                        }}
                      >
                        <Trash2 aria-hidden />
                        Remove detail
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardFooter>
            </Card>
          )
        ))
      )}

      {adding && (
        <FactForm
          value=""
          label="Add a fact about your brand"
          placeholder="Write a durable detail Otto should remember…"
          submitLabel="Add detail"
          onCancel={() => setAdding(false)}
          onSubmit={onAdd}
          onSaved={() => setAdding(false)}
        />
      )}

      {rows.length > 0 && !adding && (
        <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add detail
        </Button>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletePending) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this brand detail?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved detail from Brand memory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning" density="compact">
            <AlertTitle>What changes</AlertTitle>
            <AlertDescription>
              Otto will stop using this detail in future projects. Existing projects and generated assets stay unchanged.
            </AlertDescription>
          </Alert>
          {deleteError && (
            <Alert variant="destructive" density="compact" role="alert">
              <AlertTitle>Detail wasn&apos;t removed</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={deletePending}>Keep detail</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deletePending}
              onClick={() => void removeDetail()}
            >
              {deletePending && <Spinner data-icon="inline-start" />}
              {deletePending ? "Removing…" : "Remove detail"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
