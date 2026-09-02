"use client";

import React, { useRef, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";

type RemovalKind = "customer group" | "offer";

const COPY: Record<RemovalKind, {
  title: string;
  description: string;
  impact: string;
  errorTitle: string;
  cancelLabel: string;
  confirmLabel: string;
  connectionError: string;
}> = {
  "customer group": {
    title: "Remove this customer group?",
    description: "This removes the group from Brand memory.",
    impact: "Otto will stop using this audience profile in future projects. Existing projects and generated assets stay unchanged.",
    errorTitle: "Customer group wasn't removed",
    cancelLabel: "Keep group",
    confirmLabel: "Remove group",
    connectionError: "The customer group couldn't be removed. Check your connection and try again.",
  },
  offer: {
    title: "Remove this offer?",
    description: "This removes the offer from Brand memory.",
    impact: "Otto will stop using this offer in future projects. Existing projects and generated assets stay unchanged.",
    errorTitle: "Offer wasn't removed",
    cancelLabel: "Keep offer",
    confirmLabel: "Remove offer",
    connectionError: "The offer couldn't be removed. Check your connection and try again.",
  },
};

export function BrandRecordRemovalDialog({ kind, open, onOpenChange, onConfirm }: {
  kind: RemovalKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const copy = COPY[kind];

  async function removeRecord() {
    if (submittingRef.current) return;

    submittingRef.current = true;
    setPending(true);
    setError(null);

    try {
      const failure = await onConfirm();
      if (failure) {
        setError(failure);
        return;
      }

      onOpenChange(false);
    } catch {
      setError(copy.connectionError);
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && pending) return;
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="warning" density="compact">
          <AlertTitle>What changes</AlertTitle>
          <AlertDescription>{copy.impact}</AlertDescription>
        </Alert>
        {error && (
          <Alert variant="destructive" density="compact" role="alert">
            <AlertTitle>{copy.errorTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>{copy.cancelLabel}</AlertDialogCancel>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => void removeRecord()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "Removing…" : copy.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
