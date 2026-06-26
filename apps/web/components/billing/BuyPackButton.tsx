"use client";
import { useState, useTransition } from "react";
import { createTopupCheckout } from "@/lib/billing-actions";
import { Button } from "@/components/fk";

export function BuyPackButton({ priceId, label }: { priceId: string; label: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <Button
        variant="primary"
        size="md"
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
        <span role="alert" style={{ fontSize: "var(--text-sm)", color: "var(--danger, #ef4444)" }}>
          {err}
        </span>
      )}
    </span>
  );
}
