"use client";
import { useState, useTransition } from "react";
import { createTopupCheckout } from "@/lib/billing-actions";
import { Button } from "@/components/ui/button";

export function BuyPackButton({ priceId, label }: { priceId: string; label: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <span className="gb" style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await createTopupCheckout(priceId);
            if ("error" in res) {
              setErr(res.error);
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
          {err}
        </span>
      )}
    </span>
  );
}
