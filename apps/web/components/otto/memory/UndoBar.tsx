"use client";
import React from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";

export function UndoBar({ summary, onUndo, onDismiss }: {
  summary: string;
  onUndo: () => Promise<string | null>;
  onDismiss: () => void;
}) {
  const feedback = useAsyncActionFeedback("Brand memory couldn't be restored. Check your connection and try again.");

  return (
    <Card role="status" size="sm" tone="otto" className="mb-4">
      <CardHeader className="flex-row items-start gap-3">
        <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <CardTitle>Otto updated your brand memory</CardTitle>
          <CardDescription>{summary}.</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={feedback.pending}
            onClick={() => void feedback.run(onUndo)}
          >
            {feedback.pending ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
            {feedback.pending ? "Undoing…" : feedback.error ? "Try again" : "Undo"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            disabled={feedback.pending}
            onClick={onDismiss}
          >
            <X data-icon="inline-start" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      {feedback.error && (
        <CardContent>
          <Alert variant="destructive" role="alert">
            <AlertTitle>Brand memory wasn&apos;t restored</AlertTitle>
            <AlertDescription>{feedback.error}</AlertDescription>
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}
