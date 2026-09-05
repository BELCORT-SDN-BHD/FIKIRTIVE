"use client";

import React, { useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryRow } from "@/lib/memory-actions";
import { MemorySourceBadge } from "./MemorySourceBadge";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

export function MemoryNoteCard({ note, fresh, onSave, onDelete }: {
  note: MemoryRow;
  fresh: boolean;
  onSave: (id: string, content: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteSubmittingRef = useRef(false);
  const saveFeedback = useAsyncActionFeedback("The note couldn't be saved. Check your connection and try again.");

  async function saveNote() {
    const outcome = await saveFeedback.run(() => onSave(note.id, text.trim()));
    if (outcome === "success") setEditing(false);
  }

  async function removeNote() {
    if (deleteSubmittingRef.current) return;

    deleteSubmittingRef.current = true;
    setDeletePending(true);
    setDeleteError(null);

    try {
      const failure = await onDelete(note.id);
      if (failure) {
        setDeleteError(failure);
        return;
      }

      setDeleteOpen(false);
    } catch {
      setDeleteError("The note couldn't be removed. Check your connection and try again.");
    } finally {
      deleteSubmittingRef.current = false;
      setDeletePending(false);
    }
  }

  return (
    <Card size="sm" tone={fresh ? "otto" : "default"}>
      {editing ? (
        <>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel className="sr-only">Edit this saved note</FieldLabel>
              <Textarea
                aria-label="Edit this saved note"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
              />
            </Field>
            {saveFeedback.error && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Note wasn&apos;t saved</AlertTitle>
                <AlertDescription>{saveFeedback.error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Button type="button" size="sm" disabled={!text.trim() || saveFeedback.pending} onClick={() => void saveNote()}>
              {saveFeedback.pending && <Spinner data-icon="inline-start" />}
              {saveFeedback.pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saveFeedback.pending} onClick={() => setEditing(false)}>Cancel</Button>
          </CardFooter>
        </>
      ) : (
        <>
          <CardHeader><p className="text-sm leading-6 text-foreground">{note.content}</p></CardHeader>
          <CardFooter className="justify-between">
            <MemorySourceBadge source={note.source} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-xs" variant="ghost" aria-label={`Actions for ${note.content}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil aria-hidden />Edit</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setDeleteError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 aria-hidden />
                    Remove note
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardFooter>
        </>
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deletePending) return;
          setDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this saved note?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the note from Brand memory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning" density="compact">
            <AlertTitle>What changes</AlertTitle>
            <AlertDescription>
              Otto will stop using this note in future {PRODUCT_VOCABULARY.canvas}es. Existing{" "}
              {PRODUCT_VOCABULARY.canvas}es and generated assets stay unchanged.
            </AlertDescription>
          </Alert>
          {deleteError && (
            <Alert variant="destructive" density="compact" role="alert">
              <AlertTitle>Note wasn&apos;t removed</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={deletePending}>Keep note</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deletePending}
              onClick={() => void removeNote()}
            >
              {deletePending && <Spinner data-icon="inline-start" />}
              {deletePending ? "Removing…" : "Remove note"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
