"use client";
import { useState, useTransition } from "react";
import { createTopupCheckout } from "@/lib/billing-actions";
import { Button } from "@/components/ui/button";
import { SupportExit } from "@/components/exits/Exits";

export function BuyPackButton({ priceId, label }: { priceId: string; label: string }) {
  const [pending, start] = useTransition();
  // #686 — the server says whether this particular failure has a human exit; only then does
  // one get rendered. A retryable error must not send the merchant off to wait on a person.
  const [err, setErr] = useState<{ message: string; contactSupport: boolean } | null>(null);

  return (
    <span className="gb" style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <Button
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
        {pending ? "Starting…" : label}
      </Button>
      {err && (
        <span role="alert" style={{ fontSize: "0.8125rem", color: "var(--error)" }}>
          {err.message}
          {err.contactSupport && <> <SupportExit subject="Checkout is unavailable" /></>}
        </span>
      )}
    </span>
  );
}
