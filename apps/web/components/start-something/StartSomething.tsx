"use client";

/**
 * Create's single production entry. One submit atomically creates one Canvas, one empty
 * Conversation and a durable first-turn handoff; Canvas then sends that exact prompt through the
 * existing Otto stream. The browser UUID is held across a retry so an uncertain response cannot
 * duplicate the merchant's work.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { createCanvasConversation } from "@/lib/canvas-entry-actions";
import { canvasHref } from "@/components/canvas/canvas-href";
import { Field, FieldError } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export function StartSomething() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef<string | null>(null);

  function startCanvas(prompt: string) {
    if (pending) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Describe what you want to create.");
      return;
    }
    setError(null);
    startTransition(async () => {
      requestIdRef.current ??= crypto.randomUUID();
      const result = await createCanvasConversation({ prompt: trimmed, requestId: requestIdRef.current });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(canvasHref(result.projectId, {
        threadId: result.threadId,
        handoffId: result.handoffId,
      }));
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startCanvas(draft);
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <InputGroup className="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-sm)]">
          <InputGroupTextarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                startCanvas(draft);
              }
            }}
            placeholder="Describe an image, video or campaign idea…"
            aria-label="Describe what you want to create"
            aria-invalid={Boolean(error)}
            maxLength={4000}
            rows={3}
            className="field-sizing-fixed min-h-24 px-4 py-3 text-[0.90625rem] leading-6"
          />
          <InputGroupAddon align="block-end" className="justify-between border-t border-border">
            <span className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              aria-label="Start a Canvas with Otto"
              disabled={pending || !draft.trim()}
            >
              {pending ? (
                <Spinner data-icon="inline-start" aria-label="Starting Canvas" />
              ) : (
                <ArrowUp data-icon="inline-start" strokeWidth={2.5} />
              )}
              {pending ? "Starting…" : "Start"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldError>{error}</FieldError>
      </Field>
    </form>
  );
}

export default StartSomething;
