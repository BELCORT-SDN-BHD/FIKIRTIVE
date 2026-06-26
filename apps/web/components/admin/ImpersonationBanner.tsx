"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopImpersonatingTenant } from "@/lib/tenant-actions";

export function ImpersonationBanner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div
      role="alert"
      style={{
        background: "#7c2d12",
        color: "#fff",
        padding: "8px 16px",
        display: "grid",
        gap: 4,
        font: "var(--text-body)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span>You are impersonating a customer — spend is disabled.</span>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await stopImpersonatingTenant();
              if ("error" in res) { setErr(res.error); return; }
              router.push("/admin/tenants");
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
            whiteSpace: "nowrap",
          }}
        >
          {pending ? "Stopping…" : "Stop impersonating"}
        </button>
      </div>
      {err && <span style={{ font: "var(--text-caption)", color: "#fff" }}>{err}</span>}
    </div>
  );
}
