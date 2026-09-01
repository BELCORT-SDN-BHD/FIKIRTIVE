"use client";

import React from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { OttoAvatar, type OttoMood } from "./OttoAvatar";

export function OttoConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts = [],
  confirmText,
  confirmPlaceholder,
  confirmLabel = "Confirm",
  confirmingLabel = "Working…",
  cancelLabel = "Cancel",
  tone = "default",
  mood = tone === "danger" ? "warning" : "helpful",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impacts?: string[];
  confirmText?: string;
  confirmPlaceholder?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  mood?: OttoMood;
  onConfirm: () => void | string | null | Promise<void | string | null>;
}) {
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  const canConfirm = !confirmText || typed.trim() === confirmText;

  function changeOpen(next: boolean) {
    if (!next && pending) return;
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canConfirm || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const failure = await onConfirm();
      if (typeof failure === "string" && failure) {
        setError(failure);
        return;
      }
      setTyped("");
      onOpenChange(false);
    } catch {
      setError("We couldn't complete this action. Check your connection and try again.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <AlertDialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-[16px] bg-brand-soft">
                <OttoAvatar size={34} mood={mood} />
              </span>
              <AlertDialogTitle>{title}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          {impacts.length > 0 && (
            <Alert variant={tone === "danger" ? "warning" : "info"} density="compact">
              <AlertTitle>What happens</AlertTitle>
              <AlertDescription className="w-full">
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {impacts.map((impact) => (
                    <li key={impact}>{impact}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            {confirmText && (
              <Field data-disabled={pending}>
                <FieldLabel htmlFor="confirm-dialog-value">
                  Type <code className="font-mono font-semibold">{confirmText}</code> to continue
                </FieldLabel>
                <Input
                  id="confirm-dialog-value"
                  autoFocus
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    setError(null);
                  }}
                  placeholder={confirmPlaceholder ?? confirmText}
                  aria-label={`Type ${confirmText} to confirm`}
                  disabled={pending}
                />
              </Field>
            )}

            {error && (
              <Alert role="alert" variant="destructive" density="compact">
                <AlertTitle>Action wasn&apos;t completed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                {cancelLabel}
              </AlertDialogCancel>
              <Button
                type="submit"
                size="sm"
                variant={tone === "danger" ? "destructive" : "default"}
                disabled={!canConfirm || pending}
              >
                {pending && <Spinner data-icon="inline-start" aria-label={confirmingLabel} />}
                {pending ? confirmingLabel : confirmLabel}
              </Button>
            </AlertDialogFooter>
          </FieldGroup>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function OttoRenameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue,
  submitLabel = "Save",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | string | null | Promise<void | string | null>;
}) {
  const [pending, setPending] = React.useState(false);

  function changeOpen(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="gap-5"
        closeDisabled={pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <OttoRenameDialogForm
          key={open ? initialValue : "closed"}
          title={title}
          description={description}
          label={label}
          initialValue={initialValue}
          submitLabel={submitLabel}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          pending={pending}
          setPending={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}

function OttoRenameDialogForm({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  onOpenChange,
  onSubmit,
  pending,
  setPending,
}: {
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => void | string | null | Promise<void | string | null>;
  pending: boolean;
  setPending: (pending: boolean) => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  const clean = value.trim();
  const canSubmit = clean.length > 0 && clean !== initialValue.trim();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const failure = await onSubmit(clean);
      if (typeof failure === "string" && failure) {
        setError(failure);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("The name couldn't be saved. Check your connection and try again.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader className="pr-8">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-[16px] bg-brand-soft">
            <OttoAvatar size={34} mood="helpful" />
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-disabled={pending}>
          <FieldLabel htmlFor="rename-dialog-value">{label}</FieldLabel>
          <Input
            id="rename-dialog-value"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            aria-label={label}
            maxLength={80}
            disabled={pending}
          />
        </Field>

        {error && (
          <Alert role="alert" variant="destructive" density="compact">
            <AlertTitle>Name wasn&apos;t changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit || pending}>
            {pending && <Spinner data-icon="inline-start" aria-label="Saving name" />}
            {pending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
