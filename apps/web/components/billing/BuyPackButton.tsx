"use client";
import { useState, useTransition } from "react";
import { createTopupCheckout } from "@/lib/billing-actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { SupportExit } from "@/components/exits/Exits";

export function BuyPackButton({ priceId, label }: { priceId: string; label: string }) {
  const [pending, start] = useTransition();
  // #686 — the server says whether this particular failure has a human exit; only then does
  // one get rendered. A retryable error must not send the merchant off to wait on a person.
  const [err, setErr] = useState<{ message: string; contactSupport: boolean } | null>(null);

  return (
    <div className="gb flex w-full flex-col gap-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await createTopupCheckout(priceId);
            if ("error" in res) {
              setErr({ message: res.error, contactSupport: res.contactSupport === true });
              return;
            }
            window.location.href = res.url; // redirect to Stripe-hosted Checkout
          })
        }
      >
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "Starting checkout…" : label}
      </Button>
      {err && (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {err.message}
            {err.contactSupport && <> <SupportExit subject="Checkout is unavailable" /></>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
