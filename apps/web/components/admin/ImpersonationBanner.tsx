"use client";
import { useTransition } from "react";
import { stopImpersonatingTenant } from "@/lib/tenant-actions";

export function ImpersonationBanner() {
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      style={{
        background: "#7c2d12",
        color: "#fff",
        padding: "8px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        font: "var(--text-body)",
      }}
    >
      <span>You are impersonating a customer — spend is disabled.</span>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await stopImpersonatingTenant();
            window.location.href = "/admin/tenants";
          })
        }
        style={{
          font: "var(--text-body)",
          color: "#7c2d12",
          background: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "4px 12px",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Stopping…" : "Stop impersonating"}
      </button>
    </div>
  );
}
