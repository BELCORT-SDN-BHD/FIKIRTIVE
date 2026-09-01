"use client";

import { useRef, useState } from "react";
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

export function AdminActionConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impactTitle,
  impacts,
  confirmLabel,
  confirmingLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impactTitle: string;
  impacts: string[];
  confirmLabel: string;
  confirmingLabel: string;
  onConfirm: () => void | string | null | Promise<void | string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  function changeOpen(next: boolean) {
    if (!next && pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function submitAction() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const failure = await onConfirm();
      if (typeof failure === "string" && failure) {
        setError(failure);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("The action could not finish. Check your connection and try again.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <Alert variant="warning" density="compact">
          <AlertTitle>{impactTitle}</AlertTitle>
          <AlertDescription className="w-full">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {impacts.map((impact) => <li key={impact}>{impact}</li>)}
            </ul>
          </AlertDescription>
        </Alert>

        {error ? (
          <Alert variant="destructive" density="compact" role="alert">
            <AlertTitle>Action wasn&apos;t completed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => void submitAction()}>
            {pending ? <Spinner data-icon="inline-start" aria-label={confirmingLabel} /> : null}
            {pending ? confirmingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
