"use client";
import React, { useState } from "react";
import { offerPhase } from "@fikirtive/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandRecordRow } from "@/lib/brand-record-actions";

type OfferFields = { title: string; details: string; code: string; appliesTo: string; startsAt: string; endsAt: string };

const EMPTY: OfferFields = { title: "", details: "", code: "", appliesTo: "", startsAt: "", endsAt: "" };

/** Date → "YYYY-MM-DD" for a date input, or "" when null. */
function dateInput(d: Date | null): string {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function fieldsOf(r: BrandRecordRow): OfferFields {
  const d = r.data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: s(d.title), details: s(d.details), code: s(d.code), appliesTo: s(d.appliesTo),
    startsAt: dateInput(r.startsAt), endsAt: dateInput(r.endsAt),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** "Ends Jul 15" / "Starts Jul 10" pill copy for an active/scheduled offer. */
function datePill(r: BrandRecordRow, now: Date): string | null {
  const phase = offerPhase(r, now);
  const fmt = (d: Date) => fmtDay(new Date(d));
  if (phase === "scheduled" && r.startsAt) return `Starts ${fmt(r.startsAt)}`;
  if (r.endsAt) return `Ends ${fmt(r.endsAt)}`;
  return null;
}

function toData(f: OfferFields): Record<string, unknown> {
  return {
    title: f.title.trim(),
    ...(f.details.trim() ? { details: f.details.trim() } : {}),
    ...(f.code.trim() ? { code: f.code.trim() } : {}),
    ...(f.appliesTo.trim() ? { appliesTo: f.appliesTo.trim() } : {}),
  };
}

function OfferForm({ initial, onCancel, onSubmit }: {
  initial: OfferFields;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>, dates: { startsAt: string | null; endsAt: string | null }) => Promise<void>;
}) {
  const [f, setF] = useState<OfferFields>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof OfferFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Title *</span>
        <Input value={f.title} onChange={set("title")} placeholder="Raya sale — 20% off" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Details</span>
        <Textarea value={f.details} onChange={set("details")} rows={2} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Code</span>
        <Input value={f.code} onChange={set("code")} placeholder="RAYA20" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Applies to</span>
        <Input value={f.appliesTo} onChange={set("appliesTo")} />
      </label>
      <div className="flex gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[0.75rem] text-muted-foreground">Starts</span>
          <Input type="date" value={f.startsAt} onChange={set("startsAt")} />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[0.75rem] text-muted-foreground">Ends</span>
          <Input type="date" value={f.endsAt} onChange={set("endsAt")} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!f.title.trim() || saving}
          onClick={() => {
            setSaving(true);
            void onSubmit(toData(f), { startsAt: f.startsAt || null, endsAt: f.endsAt || null }).finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function OfferRow({ r, now, fresh, past, onEdit, onDelete, onDuplicate }: {
  r: BrandRecordRow;
  now: Date;
  fresh: boolean;
  past: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const d = r.data as Record<string, unknown>;
  const title = typeof d.title === "string" ? d.title : "";
  const pill = datePill(r, now);
  return (
    <div className={`px-[15px] py-[10px] ${past ? "opacity-60" : ""} ${fresh ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[0.875rem] leading-[1.45] font-semibold text-foreground">{title}</span>
            {pill && <span className="text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap text-muted-foreground bg-accent">{pill}</span>}
          </div>
          {typeof d.code === "string" && d.code && <div className="text-[0.8125rem] font-mono text-muted-foreground">{d.code}</div>}
        </div>
        {past ? (
          <button type="button" className="text-[0.75rem] text-muted-foreground hover:text-foreground whitespace-nowrap" onClick={onDuplicate}>Duplicate</button>
        ) : (
          <>
            <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={onEdit}>✎</button>
            <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={onDelete}>🗑</button>
          </>
        )}
      </div>
    </div>
  );
}

export function OfferList({ records, freshIds, onSave, onDelete }: {
  records: BrandRecordRow[];
  freshIds: Set<string>;
  onSave: (id: string | undefined, data: Record<string, unknown>, dates: { startsAt: string | null; endsAt: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const now = new Date();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<OfferFields>(EMPTY);

  const active = records.filter((r) => offerPhase(r, now) !== "expired");
  const past = records.filter((r) => offerPhase(r, now) === "expired");

  function duplicate(r: BrandRecordRow) {
    // Prefill the add form from the expired offer; a new end date revives it on save.
    setPrefill({ ...fieldsOf(r), startsAt: "", endsAt: "" });
    setAdding(true);
  }

  return (
    <section>
      <h2 className="text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2">Your offers</h2>

      <div className="rounded-[16px] border border-border bg-card divide-y divide-border">
        {active.length === 0 && (
          <div className="text-[0.875rem] leading-[1.45] text-muted-foreground px-[15px] py-[10px]">
            No active offers — tell Otto about a promo, or add one.
          </div>
        )}
        {active.map((r) => (
          <div key={r.id}>
            {editingId === r.id ? (
              <div className="px-[15px] py-[10px]">
                <OfferForm
                  initial={fieldsOf(r)}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(data, dates) => onSave(r.id, data, dates).then(() => setEditingId(null))}
                />
              </div>
            ) : (
              <OfferRow
                r={r}
                now={now}
                fresh={freshIds.has(r.id)}
                past={false}
                onEdit={() => setEditingId(r.id)}
                onDelete={() => void onDelete(r.id)}
                onDuplicate={() => duplicate(r)}
              />
            )}
          </div>
        ))}

        <div className="px-[15px] py-[10px]">
          {adding ? (
            <OfferForm
              initial={prefill}
              onCancel={() => { setAdding(false); setPrefill(EMPTY); }}
              onSubmit={(data, dates) => onSave(undefined, data, dates).then(() => { setAdding(false); setPrefill(EMPTY); })}
            />
          ) : (
            <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground" onClick={() => { setPrefill(EMPTY); setAdding(true); }}>+ Add an offer</button>
          )}
        </div>
      </div>

      {past.length > 0 && (
        <details className="mt-3">
          <summary className="text-[0.8125rem] text-muted-foreground hover:text-foreground cursor-pointer">Past offers ({past.length})</summary>
          <div className="rounded-[16px] border border-border bg-card divide-y divide-border mt-2">
            {past.map((r) => (
              <OfferRow
                key={r.id}
                r={r}
                now={now}
                fresh={freshIds.has(r.id)}
                past
                onEdit={() => {}}
                onDelete={() => void onDelete(r.id)}
                onDuplicate={() => duplicate(r)}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
