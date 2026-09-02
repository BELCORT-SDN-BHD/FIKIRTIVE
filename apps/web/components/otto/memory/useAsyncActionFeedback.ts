"use client";

import { useRef, useState } from "react";

type ActionOutcome = "success" | "failure" | "ignored";

export function useAsyncActionFeedback(fallbackError: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function run(action: () => Promise<string | null>): Promise<ActionOutcome> {
    if (submittingRef.current) return "ignored";

    submittingRef.current = true;
    setPending(true);
    setError(null);

    try {
      const failure = await action();
      if (failure) {
        setError(failure);
        return "failure";
      }
      return "success";
    } catch {
      setError(fallbackError);
      return "failure";
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return { pending, error, clearError: () => setError(null), run };
}
