"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REFERENCE_FORMATS, type ReferenceFormat } from "@/lib/reference-formats";
import { createEntity } from "@/lib/actions";
import { startRefGen } from "@/lib/refgen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { displayCredits, pricedRefgenCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import { ErrorWithTopUp } from "@/components/exits/Exits";
import { UnderstandingCostHint } from "@/components/otto/UnderstandingCostHint";

type Mode = "upload" | "generate";

// One-line skeleton hint shown under each format card.
const FORMAT_HINT: Record<ReferenceFormat["key"], string> = {
  avatar: "Head-and-shoulders studio portrait",
  "product-shot": "Clean studio product photo",
  location: "Empty wide establishing shot",
  brandmark: "Flat mark on plain white",
};

// Friendly label → EntityType, sourced from REFERENCE_FORMATS so the two
// stay in lockstep (same labels the reference-gen UI shows).
const TYPE_OPTIONS = REFERENCE_FORMATS.map((f) => ({ label: f.label, value: f.entityType }));

/**
 * Add-asset modal. Only the Upload half is wired in this task; the Generate
 * segment is rendered disabled (Task 7 replaces it).
 */
export function AddAssetDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(TYPE_OPTIONS[0]?.value ?? "");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate half.
  const [fmtKey, setFmtKey] = useState<ReferenceFormat["key"] | null>(null);
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const fmt = REFERENCE_FORMATS.find((f) => f.key === fmtKey) ?? null;
  const refgenCostLabel = creditsLabel(displayCredits(pricedRefgenCredits({ model: "seedream", count: 1 })));

  if (!open) return null;

  function reset() {
    setName("");
    setType(TYPE_OPTIONS[0]?.value ?? "");
    setFiles(null);
    setSaving(false);
    setError(null);
    setMode("upload");
    setFmtKey(null);
    setSubject("");
    setNotes("");
    setDone(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function generate() {
    if (!fmt) return;
    const subj = subject.trim();
    if (!subj) {
      setError("Please describe the subject.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", subj.slice(0, 60));
      fd.set("type", fmt.entityType);
      const created = await createEntity(fd); // no files — entity shell
      if (!created || "error" in created) {
        setError((created && "error" in created && created.error) || "Couldn't create the reference. Please try again.");
        setSaving(false);
        return;
      }
      const res = await startRefGen({
        entityId: created.id,
        prompt: fmt.buildPrompt({ subject: subj, notes }),
        count: 1,
        model: "seedream",
        mode: "BASE",
      });
      if ("error" in res) {
        setError(res.error);
        setSaving(false);
        return;
      }
      setDone(true);
      setSaving(false);
      onDone();
    } catch {
      setError("Couldn't generate this. Please try again.");
      setSaving(false);
    } finally {
      // A reference generation reserves credits the moment startRefGen accepts — tell the
      // global nav so its credits figure moves with the money. In a finally so a refused or
      // failed start, which can still have reserved and refunded, announces too (#550).
      notifyBalanceRefresh();
    }
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    // #934 — with no files, createEntity still succeeds: it creates the entity row and
    // simply attaches zero images, so Library gets a blank tile with nothing to show. Make
    // that state unreachable from this form instead of leaving it to a later cleanup.
    if (!files || files.length === 0) {
      setError("Choose an image to upload.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", trimmed);
      fd.set("type", type);
      // acceptRefFiles(formData) reads getAll("files") — use that exact field name.
      if (files) {
        for (const f of Array.from(files)) fd.append("files", f);
      }
      const res = await createEntity(fd);
      if (res && "error" in res && typeof res.error === "string") {
        setError(res.error);
        setSaving(false);
        return;
      }
      reset();
      onDone();
      onClose();
    } catch {
      setError("Couldn't add this. Please try again.");
      setSaving(false);
    }
  }

  return (
    // W2-1 —— 这里曾经是一段手搓弹窗:自己画 `fixed inset-0` 的遮罩、自己在遮罩上接
    // onClick 当「点外面关闭」,而焦点陷阱与 Escape 干脆没有(规格书 §4.3)。键盘用户按
    // Tab 会走出弹窗、在后面那一页上乱点,按 Esc 什么也不会发生。三样都不是这份文件该
    // 自己实现的东西 —— Radix 的 Dialog 一次给全,而且它就在 components/ui 里。
    <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-[480px]">
        <DialogHeader className="mb-4 pr-8">
          <DialogTitle>Add to Library</DialogTitle>
          <DialogDescription>
            Upload an image you already have, or generate a new reference.
          </DialogDescription>
        </DialogHeader>

        {/* Segmented Upload / Generate. */}
        <div className="mb-5 flex gap-1 rounded-[14px] bg-muted p-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setMode("upload"); setError(null); }}
            className={`h-auto flex-1 rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold ${
              mode === "upload"
                ? "bg-card text-foreground shadow-xs hover:bg-card"
                : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
            }`}
          >
            Upload
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setMode("generate"); setError(null); }}
            className={`h-auto flex-1 rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold ${
              mode === "generate"
                ? "bg-card text-foreground shadow-xs hover:bg-card"
                : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
            }`}
          >
            Generate reference
          </Button>
        </div>

        {mode === "upload" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Name *</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rosa"
                autoFocus
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Type</span>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Images</span>
              {/* MONEY-A9 §7.3 — between the "Images" label and the picker: this dialog takes
                  MULTIPLE files at once, so the per-image price has to be visible before the
                  merchant selects a folder's worth of them (披露先于扣费). */}
              <UnderstandingCostHint />
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                className="h-auto w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-[0.8125rem] text-muted-foreground shadow-none file:mr-3 file:rounded-[10px] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-foreground"
              />
            </label>

            {/* #979:钱不够那一句以前就停在这里 —— 一段写着「Top up in Billing.」却点不动的字。
                与计划卡是同一个死路,同一个修法:句子原样(数字必须是服务端真报的那一次),
                只把结尾换成真的能点的路;别的错误原样渲染。 */}
            {error && (
              <div role="alert" className="text-[0.8125rem] text-[var(--error-soft-foreground)]">
                <ErrorWithTopUp text={error} />
              </div>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={saving || !name.trim() || !files || files.length === 0}
              >
                {saving ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        )}

        {mode === "generate" && (
          done ? (
            <div className="flex flex-col gap-4">
              <p className="text-[0.875rem] leading-[1.45] text-foreground">
                Generating — it will appear in Library shortly.
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={close}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Format picker */}
              <div className="grid grid-cols-2 gap-2">
                {REFERENCE_FORMATS.map((f) => (
                  <Button
                    key={f.key}
                    type="button"
                    variant="ghost"
                    onClick={() => { setFmtKey(f.key); setError(null); }}
                    className={`h-auto flex-col items-start justify-start gap-0 whitespace-normal rounded-[12px] border p-3 text-left font-normal transition ${
                      fmtKey === f.key
                        ? "border-brand bg-brand/5 hover:bg-brand/5"
                        : "border-border bg-transparent hover:border-foreground/30 hover:bg-transparent"
                    }`}
                  >
                    <div className="text-[0.875rem] font-semibold text-foreground">{f.label}</div>
                    <div className="mt-0.5 text-[0.75rem] leading-[1.35] text-muted-foreground">{FORMAT_HINT[f.key]}</div>
                  </Button>
                ))}
              </div>

              {fmt && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">{fmt.subjectLabel} *</span>
                    <Input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={fmt.subjectPlaceholder}
                      autoFocus
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">Notes (optional)</span>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Anything to add — colors, mood, angle…"
                    />
                  </label>
                </>
              )}

              {/* #979 —— 同上,这是「生成参考图」那一步的第二个出口。 */}
              {error && (
                <div role="alert" className="text-[0.8125rem] text-[var(--error-soft-foreground)]">
                  <ErrorWithTopUp text={error} />
                </div>
              )}

              <p className="text-[0.75rem] text-muted-foreground/70">
                Generates 1 reference image. Cost: {refgenCostLabel}.
              </p>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                  Cancel
                </Button>
                {/* #896: one press, with the price on it. */}
                <Button size="sm" onClick={() => void generate()} disabled={saving || !fmt || !subject.trim()}>
                  {saving ? "Generating…" : `Generate · ${refgenCostLabel}`}
                </Button>
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
