"use client";
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REFERENCE_FORMATS,
  type ReferenceFormat,
} from "@/lib/reference-formats";
import { createEntity } from "@/lib/actions";
import { startRefGen } from "@/lib/refgen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { displayCredits, pricedRefgenCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import { ErrorWithTopUp } from "@/components/exits/Exits";

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
const TYPE_OPTIONS = REFERENCE_FORMATS.map((f) => ({
  label: f.label,
  value: f.entityType,
}));

/** Add an existing image or start a paid reference generation from the same Library door. */
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
  const [uncertainMessage, setUncertainMessage] = useState<string | null>(null);
  // State lands after a render; this closes the same-tick double-click window for both writes.
  const submittingRef = useRef(false);

  // Generate half.
  const [fmtKey, setFmtKey] = useState<ReferenceFormat["key"] | null>(null);
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const fmt = REFERENCE_FORMATS.find((f) => f.key === fmtKey) ?? null;
  const refgenCostLabel = creditsLabel(
    displayCredits(pricedRefgenCredits({ model: "seedream", count: 1 })),
  );
  const formLocked = saving || done || uncertainMessage !== null;

  if (!open) return null;

  function reset() {
    setName("");
    setType(TYPE_OPTIONS[0]?.value ?? "");
    setFiles(null);
    setSaving(false);
    setError(null);
    setUncertainMessage(null);
    submittingRef.current = false;
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
    if (!fmt || submittingRef.current || uncertainMessage) return;
    const subj = subject.trim();
    if (!subj) {
      setError("Please describe the subject.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", subj.slice(0, 60));
      fd.set("type", fmt.entityType);
      const created = await createEntity(fd); // no files — entity shell
      if (!created || "error" in created) {
        setError(
          (created && "error" in created && created.error) ||
            "Couldn't create the reference. Please try again.",
        );
        return;
      }
      let res: Awaited<ReturnType<typeof startRefGen>>;
      try {
        res = await startRefGen({
          entityId: created.id,
          prompt: fmt.buildPrompt({ subject: subj, notes }),
          count: 1,
          model: "seedream",
          mode: "BASE",
        });
      } catch {
        setUncertainMessage(
          "We couldn't confirm whether generation started. Check Library in a minute before trying again.",
        );
        return;
      }
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDone(true);
      onDone();
    } catch {
      setUncertainMessage(
        "We couldn't confirm whether the reference was created. Check Library before trying again.",
      );
    } finally {
      // A reference generation reserves credits the moment startRefGen accepts — tell the
      // global nav so its credits figure moves with the money. In a finally so a refused or
      // failed start, which can still have reserved and refunded, announces too (#550).
      notifyBalanceRefresh();
      submittingRef.current = false;
      setSaving(false);
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
    if (submittingRef.current || uncertainMessage) return;
    submittingRef.current = true;
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
        return;
      }
      reset();
      onDone();
      onClose();
    } catch {
      setUncertainMessage(
        "We couldn't confirm whether this was added. Check Library before trying again.",
      );
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    // W2-1 —— 这里曾经是一段手搓弹窗:自己画 `fixed inset-0` 的遮罩、自己在遮罩上接
    // onClick 当「点外面关闭」,而焦点陷阱与 Escape 干脆没有(规格书 §4.3)。键盘用户按
    // Tab 会走出弹窗、在后面那一页上乱点,按 Esc 什么也不会发生。三样都不是这份文件该
    // 自己实现的东西 —— Radix 的 Dialog 一次给全,而且它就在 components/ui 里。
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) close();
      }}
    >
      <DialogContent
        className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-[480px]"
        closeDisabled={saving}
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogHeader className="mb-4 pr-8">
          <DialogTitle>Add to Library</DialogTitle>
          <DialogDescription>
            Upload an image you already have, or generate a new reference.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value as Mode);
            setError(null);
          }}
          className="gap-5"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" disabled={formLocked} onClick={() => setMode("upload")}>
              Upload
            </TabsTrigger>
            <TabsTrigger value="generate" disabled={formLocked} onClick={() => setMode("generate")}>
              Generate reference
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <FieldGroup className="gap-4">
              <Field data-disabled={formLocked}>
                <FieldLabel htmlFor="add-asset-name">Name</FieldLabel>
                <Input
                  id="add-asset-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Rosa"
                  autoFocus
                  required
                  disabled={formLocked}
                />
              </Field>

              <Field data-disabled={formLocked}>
                <FieldLabel htmlFor="add-asset-type">Type</FieldLabel>
                <Select
                  value={type}
                  disabled={formLocked}
                  onValueChange={(value) => {
                    setType(value);
                    setError(null);
                  }}
                >
                  <SelectTrigger id="add-asset-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field data-disabled={formLocked}>
                <FieldLabel htmlFor="add-asset-images">Images</FieldLabel>
                <Input
                  id="add-asset-images"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={formLocked}
                  onChange={(e) => {
                    setFiles(e.target.files);
                    setError(null);
                  }}
                  className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground"
                />
                <FieldDescription>
                  {files?.length
                    ? `${files.length} ${files.length === 1 ? "image" : "images"} selected`
                    : "PNG, JPEG, or WebP. Up to 10 images."}
                </FieldDescription>
              </Field>

              {/* #979:钱不够那一句以前就停在这里 —— 一段写着「Top up in Billing.」却点不动的字。
                与计划卡是同一个死路,同一个修法:句子原样(数字必须是服务端真报的那一次),
                只把结尾换成真的能点的路;别的错误原样渲染。 */}
              {error && (
                <Alert role="alert" variant="destructive">
                  <AlertTitle>Couldn&rsquo;t add asset</AlertTitle>
                  <AlertDescription>
                    <ErrorWithTopUp text={error} />
                  </AlertDescription>
                </Alert>
              )}
              {uncertainMessage && (
                <Alert role="alert" variant="warning">
                  <AlertTitle>Status not confirmed</AlertTitle>
                  <AlertDescription>{uncertainMessage}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={close}
                  disabled={saving}
                >
                  {uncertainMessage ? "Close" : "Cancel"}
                </Button>
                {!uncertainMessage && (
                  <Button
                    size="sm"
                    onClick={() => void submit()}
                    disabled={
                      formLocked || !name.trim() || !files || files.length === 0
                    }
                  >
                    {saving ? (
                      <>
                        <Spinner data-icon="inline-start" aria-label="Adding asset" />
                        Adding…
                      </>
                    ) : "Add"}
                  </Button>
                )}
              </DialogFooter>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="generate">
            {done ? (
              <div className="flex flex-col gap-4">
                <Alert role="status" variant="success">
                  <AlertTitle>Reference queued</AlertTitle>
                  <AlertDescription>
                    Generating — it will appear in Library shortly.
                  </AlertDescription>
                </Alert>
                <DialogFooter>
                  <Button size="sm" onClick={close}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <FieldGroup className="gap-4">
                  <Field data-disabled={formLocked}>
                    <FieldTitle id="reference-format-label">Reference format</FieldTitle>
                    <ToggleGroup
                      type="single"
                      value={fmtKey ?? ""}
                      variant="outline"
                      spacing={2}
                      disabled={formLocked}
                      aria-labelledby="reference-format-label"
                      onValueChange={(value) => {
                        if (!value) return;
                        setFmtKey(value as ReferenceFormat["key"]);
                        setError(null);
                      }}
                      className="grid w-full grid-cols-2"
                    >
                      {REFERENCE_FORMATS.map((f) => (
                        <ToggleGroupItem
                          key={f.key}
                          value={f.key}
                          aria-label={f.label}
                          className="h-auto min-h-20 w-full flex-col items-start justify-start whitespace-normal px-3 py-2.5 text-left"
                        >
                          <span className="font-semibold">{f.label}</span>
                          <span className="text-xs font-normal leading-snug text-muted-foreground">
                            {FORMAT_HINT[f.key]}
                          </span>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <FieldDescription>
                      Generates 1 reference image · {refgenCostLabel}
                    </FieldDescription>
                  </Field>

                  {fmt && (
                    <FieldGroup className="gap-4">
                      <Field data-disabled={formLocked}>
                        <FieldLabel htmlFor="add-asset-subject">
                          {fmt.subjectLabel}
                        </FieldLabel>
                        <Input
                          id="add-asset-subject"
                          value={subject}
                          onChange={(e) => {
                            setSubject(e.target.value);
                            setError(null);
                          }}
                          placeholder={fmt.subjectPlaceholder}
                          autoFocus
                          required
                          disabled={formLocked}
                        />
                      </Field>

                      <Field data-disabled={formLocked}>
                        <FieldLabel htmlFor="add-asset-notes">
                          Notes (optional)
                        </FieldLabel>
                        <Textarea
                          id="add-asset-notes"
                          value={notes}
                          onChange={(e) => {
                            setNotes(e.target.value);
                            setError(null);
                          }}
                          rows={2}
                          placeholder="Anything to add — colors, mood, angle…"
                          disabled={formLocked}
                        />
                      </Field>
                    </FieldGroup>
                  )}

                  {/* #979 —— 同上,这是「生成参考图」那一步的第二个出口。 */}
                  {error && (
                    <Alert role="alert" variant="destructive">
                      <AlertTitle>Couldn&rsquo;t generate reference</AlertTitle>
                      <AlertDescription>
                        <ErrorWithTopUp text={error} />
                      </AlertDescription>
                    </Alert>
                  )}
                  {uncertainMessage && (
                    <Alert role="alert" variant="warning">
                      <AlertTitle>Status not confirmed</AlertTitle>
                      <AlertDescription>{uncertainMessage}</AlertDescription>
                    </Alert>
                  )}

                  <DialogFooter>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={close}
                      disabled={saving}
                    >
                      {uncertainMessage ? "Close" : "Cancel"}
                    </Button>
                    {/* #896: one press, with the price on it. */}
                    {!uncertainMessage && (
                      <Button
                        size="sm"
                        onClick={() => void generate()}
                        disabled={formLocked || !fmt || !subject.trim()}
                      >
                        {saving ? (
                          <>
                            <Spinner data-icon="inline-start" aria-label="Generating reference" />
                            Generating…
                          </>
                        ) : `Generate · ${refgenCostLabel}`}
                      </Button>
                    )}
                  </DialogFooter>
              </FieldGroup>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
