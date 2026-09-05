"use client";
/**
 * ElementVariantsDialog — the merchant's door to styling variants (#781).
 *
 * The whole variant pathway already existed and had NO caller on the human side: the
 * EntityVariant table, the five owner-gated server actions (createVariant / regenerateVariant /
 * renameVariant / deleteVariant / setBaseAsset), the worker's VARIANT image-to-image branch and
 * the @mention variant picker all shipped — a merchant simply had no button anywhere that
 * reached them. This dialog is that button. It adds no business logic of its own: every write
 * goes through refgen-actions, the same action layer Otto's port calls, so the two surfaces can
 * never drift into two different rules about the same money.
 *
 * What a merchant sees here: the element's BASE look (the identity anchor every variant is
 * generated from) and its named variants — "same face, different outfit". A variant is a paid
 * single image; the price shown comes from the central pricing helper, never a literal.
 *
 * OFFICIAL AVATARS ARE READ-ONLY (Founder 2026-08-30, information-architecture/README.md, the
 * Elements row). Every mutation control below is gated on `entity.capabilities` — the answer the
 * DTO carried over from the ONE domain function (packages/core/src/entity-policy.ts), never a
 * second judgement made here out of the element's name or its catalogKey. A control the merchant
 * may not use is NOT rendered disabled: a dead button that takes a click and then apologises is
 * exactly what this replaces (Codex QA-CRE-003 found one on Aisyah). The server actions refuse
 * independently — this layer is the honest surface, not the fence.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, MoreHorizontal, Pencil, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  createVariant,
  deleteVariant,
  getRefGenJobs,
  regenerateVariant,
  renameVariant,
  setBaseAsset,
} from "@/lib/refgen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { OFFICIAL_CATALOG_BADGE } from "@fikirtive/core/entity-policy";
import { displayCredits, pricedRefgenCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import { ErrorWithTopUp } from "@/components/exits/Exits";
import {
  isVariantRunning,
  latestVariantRef,
  variantNeedsReread,
  variantsToWatch,
  type VariantJobs,
  type VariantJobStatus,
  type VariantJobView,
} from "@/lib/variant-progress";
import type { EntityDTO } from "@/lib/types";

/** How often an in-flight variant generation is re-checked. Same cadence as the other
 *  generation pollers on this surface — slow enough to be cheap, fast enough to feel live. */
const POLL_MS = 2500;

export function ElementVariantsDialog({
  entity,
  open,
  onOpenChange,
  onChanged,
}: {
  entity: EntityDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server data changed — the caller re-reads it (router.refresh). Must be stable: it is a
   *  dependency of the generation poll, and a new identity every render would restart it. */
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertainMessage, setUncertainMessage] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // What the server last said about each variant's NEWEST generation job (see lib/variant-progress).
  const [jobs, setJobs] = useState<VariantJobs>({});
  // Every paid button is guarded synchronously: `busy` is state and lands a render too late to
  // stop a fast double-click, and a second click here would be a second charge.
  const submittingRef = useRef(false);

  const entityId = entity?.id ?? null;
  const variants = entity?.variants ?? [];
  const baseRef = entity?.refs.find((r) => r.assetId === entity.baseAssetId) ?? null;
  const hasBase = !!baseRef;
  const variantCost = creditsLabel(displayCredits(pricedRefgenCredits({ model: "seedream", count: 1 })));
  const writeLocked = busy || deleting || pendingAction !== null;
  const paidLocked = writeLocked || uncertainMessage !== null;

  // The variants as CURRENTLY rendered, readable inside the poll without making the poll restart on
  // every parent render. This is what "the images the merchant can see" means, and it is what a
  // finished job's output is compared against — reading a stale copy would ask for the same re-read
  // again after the fresh data had already landed.
  const variantsRef = useRef(variants);
  useEffect(() => {
    variantsRef.current = variants;
  });

  /** Closing forgets what the server said, so opening again asks fresh — a generation started
   *  meanwhile (by Otto, or in another tab) is picked up instead of hidden behind a remembered
   *  "that one finished". Entries are keyed by variant id, so anything left over from another
   *  element is simply never looked up. */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && writeLocked) return;
      if (!next) {
        setJobs({});
        setDeleteTarget(null);
        setRenamingId(null);
        setError(null);
        setUncertainMessage(null);
      }
      onOpenChange(next);
    },
    [onOpenChange, writeLocked],
  );

  // A stable key for the watched set, so the poll restarts only when that set actually changes
  // (the parent hands a fresh array on every refresh; its contents are what matter).
  const watchKey = variantsToWatch(variants, jobs).join(",");

  // Ask the server about every variant whose generation is (or might be) running. getRefGenJobs is
  // owner-gated server-side and scoped to (entity, variant), so this reads only this merchant's own
  // jobs. The set narrows itself: after the opening sweep only genuinely running variants stay in it.
  useEffect(() => {
    if (!open || !entityId || watchKey === "") return;
    let cancelled = false;
    const tick = async () => {
      const heard: Array<{ id: string; view: VariantJobView }> = [];
      for (const variantId of watchKey.split(",")) {
        try {
          const rows = await getRefGenJobs(entityId, variantId);
          const latest = rows[0];
          heard.push({
            id: variantId,
            view: latest
              ? {
                  status: latest.status as VariantJobStatus,
                  error: latest.error || "",
                  outputAssetIds: latest.outputAssetIds,
                }
              : { status: "NONE", error: "" },
          });
        } catch {
          // A failed poll is not a failed generation — keep what we knew and try again next tick.
        }
      }
      if (cancelled || heard.length === 0) return;
      // A finished job whose image is NOT among the ones on screen means this page's data predates
      // it — which is the normal case both for a generation we watched finish and for one that
      // finished between the page snapshot and this very first poll.
      const stale = heard.some(({ id, view }) => {
        const variant = variantsRef.current.find((v) => v.id === id);
        return !!variant && variantNeedsReread(variant, view);
      });
      setJobs((cur) => {
        const next = { ...cur };
        for (const { id, view } of heard) next[id] = view;
        return next;
      });
      if (stale) {
        // The finished image lives on the server; ask the caller to re-read rather than
        // guessing at it here. The re-read is what puts the newly paid-for image on the tile.
        notifyBalanceRefresh();
        onChanged();
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, entityId, watchKey, onChanged]);

  /** A paid generation was just accepted for this variant — the action returned a job, so it is
   *  queued. Recording that immediately is what keeps the variant on the watch list (and puts
   *  "Making it again…" on a tile that still shows the old image) until the server says otherwise. */
  const markRunning = useCallback((variantId: string) => {
    setJobs((cur) => ({ ...cur, [variantId]: { status: "QUEUED", error: "" } }));
  }, []);

  /** Run one paid variant action: guard the double-click, surface the refusal in the merchant's
   *  own words, and re-read server truth either way. The action itself says what happened to the
   *  money; what the merchant then WATCHES is the variant marked running above. */
  const runPaid = useCallback(
    async (
      work: () => Promise<{ error: string } | { ok: true }>,
      uncertainVariantId?: string,
    ) => {
      if (submittingRef.current || uncertainMessage) return;
      submittingRef.current = true;
      setBusy(true);
      setError(null);
      setUncertainMessage(null);
      try {
        const res = await work();
        if ("error" in res) {
          setError(res.error);
          return;
        }
        onChanged();
      } catch {
        setUncertainMessage(
          "We couldn't confirm whether generation started. Close this window and check the element before trying another paid action.",
        );
        if (uncertainVariantId) {
          setJobs((cur) => {
            const next = { ...cur };
            delete next[uncertainVariantId];
            return next;
          });
        }
        onChanged();
      } finally {
        // A reserve happens the moment the action accepts — and a refused start can still have
        // reserved and refunded — so the balance is announced either way (#550).
        notifyBalanceRefresh();
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [onChanged, uncertainMessage],
  );

  async function submitVariant() {
    if (!entityId) return;
    const cleanName = name.trim();
    const cleanPrompt = prompt.trim();
    if (!cleanName) {
      setError("Give the variant a name.");
      return;
    }
    if (!cleanPrompt) {
      setError("Describe what changes in this variant.");
      return;
    }
    await runPaid(async () => {
      const res = await createVariant(entityId, cleanName, cleanPrompt);
      if ("error" in res) return res;
      markRunning(res.variantId);
      setName("");
      setPrompt("");
      return { ok: true };
    });
  }

  async function regenerate(variantId: string) {
    await runPaid(async () => {
      const res = await regenerateVariant(variantId);
      if ("error" in res) return res;
      // The merchant just paid for a new image of a variant that already has one. Nothing on the
      // tile would change on its own — the old image stays until the new one is attached — so the
      // variant goes back on the watch list, and stays on it until the server says DONE.
      markRunning(variantId);
      return { ok: true };
    }, variantId);
  }

  async function saveRename(variantId: string) {
    const cleanName = renameValue.trim();
    if (!cleanName) return;
    setError(null);
    setPendingAction(`rename:${variantId}`);
    try {
      const res = await renameVariant(variantId, cleanName);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setRenamingId(null);
      onChanged();
    } catch {
      setError("The variant name couldn't be saved. Check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function removeVariant(variantId: string) {
    setError(null);
    setDeleting(true);
    try {
      const res = await deleteVariant(variantId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDeleteTarget(null);
      onChanged();
    } catch {
      setError("The variant couldn't be deleted. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function makeBase(assetId: string) {
    if (!entityId) return;
    setError(null);
    setPendingAction(`base:${assetId}`);
    try {
      const res = await setBaseAsset(entityId, assetId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onChanged();
    } catch {
      setError("The base look couldn't be changed. Check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  if (!entity) return null;

  // 官方目录只读。判据来自 DTO 带过来的域层答案 —— 这里不重新判一次。
  const caps = entity.capabilities;
  const readOnly = entity.origin === "OFFICIAL_CATALOG";
  // 三格全关 ⇒ 那个「⋯」菜单里一条也没有,整个触发器就不该出现。
  const canActOnVariant = caps.regenerateVariant || caps.renameVariant || caps.deleteVariant;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]"
        closeDisabled={writeLocked}
        onEscapeKeyDown={(event) => {
          if (writeLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (writeLocked) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {entity.name}
            {/* 只读那一面要看得见,而不是靠「按钮怎么少了」去猜(Codex QA-CRE-FE9-008)。
                标签只说事实,不是禁用态:只读动作(View details / Use in Canvas / @ 引用 /
                favorite)一个不少。 */}
            {readOnly && (
              <Badge variant="outline" className="font-medium text-muted-foreground">
                {OFFICIAL_CATALOG_BADGE}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "This cast member is provided by Fikirtive. Its base look and saved variants stay as they are — use it in Canvas, or type @ in a prompt to put it in your work."
              : "One saved photo is the base look — the face and identity every variant keeps. Add variants for the different outfits and looks you want to reuse."}
          </DialogDescription>
        </DialogHeader>

        {/* #979 —— 变体这一步的钱不够同样不许是死路(与计划卡、AddAssetDialog 同一个修法)。 */}
        {error && (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Action couldn&apos;t finish</AlertTitle>
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

        {/* Base look */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Base look</h3>
          {entity.refs.length === 0 ? (
            <Empty className="gap-3 border border-dashed p-5 md:p-5">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ImageIcon /></EmptyMedia>
                <EmptyTitle className="text-sm">No base photo</EmptyTitle>
                <EmptyDescription>
                  Add a photo from Library first. Every variant starts from that base look.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-wrap gap-2">
              {entity.refs.map((ref) => {
                const isBase = ref.assetId === entity.baseAssetId;
                return (
                  <div key={ref.id} className="flex w-[104px] flex-col gap-1">
                    <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ref.url} alt={entity.name} className="h-full w-full object-cover" />
                      {isBase && (
                        <Badge variant="outline" className="absolute left-1.5 top-1.5 bg-card/90 backdrop-blur-sm">
                          Base
                        </Badge>
                      )}
                    </div>
                    {!isBase && caps.mutateBase && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={writeLocked}
                        onClick={() => void makeBase(ref.assetId)}
                      >
                        {pendingAction === `base:${ref.assetId}` && (
                          <Spinner aria-label="Changing base look" />
                        )}
                        {pendingAction === `base:${ref.assetId}` ? "Changing…" : "Use as base"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Variants */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Styling variants</h3>
          {variants.length === 0 ? (
            <Empty className="gap-3 border border-dashed p-5 md:p-5">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
                <EmptyTitle className="text-sm">No styling variants</EmptyTitle>
                <EmptyDescription>
                  {readOnly
                    ? "This cast member ships without saved variants. Describe the outfit you want in your prompt instead."
                    : "Keep the same identity while changing the outfit, styling or setting."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {variants.map((variant) => {
                const job = jobs[variant.id];
                const problem = job?.status === "FAILED" ? job : null;
                const running = isVariantRunning(variant, jobs);
                // The NEWEST image, not the first one: a re-run appends, so `refs[0]` would keep
                // showing the picture the merchant paid to replace (see lib/variant-progress).
                const thumb = latestVariantRef(variant);
                return (
                  <Card
                    key={variant.id}
                    size="sm"
                    className="gap-0 overflow-hidden p-0 shadow-none"
                  >
                    <CardHeader className="relative p-0">
                      <div className="relative aspect-square bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb.url} alt={variant.name} className="h-full w-full object-cover" />
                        ) : (
                          <Empty className="h-full gap-2 rounded-none p-3 md:p-3">
                            <EmptyHeader className="gap-1">
                              <EmptyMedia variant="icon" className="mb-1">
                                {running ? <Spinner aria-label={`Making ${variant.name}`} /> : <ImageIcon />}
                              </EmptyMedia>
                              <EmptyTitle className="text-xs">
                                {running ? "Making this look" : problem ? "Didn't finish" : "No image yet"}
                              </EmptyTitle>
                            </EmptyHeader>
                          </Empty>
                        )}
                      </div>
                      {canActOnVariant && (
                      <div className="absolute right-1.5 top-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="secondary"
                              disabled={writeLocked}
                              aria-label={`Actions for ${variant.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              {caps.regenerateVariant && (
                                <DropdownMenuItem
                                  disabled={paidLocked || running}
                                  onSelect={() => void regenerate(variant.id)}
                                >
                                  <RotateCcw />
                                  Make it again · {variantCost}
                                </DropdownMenuItem>
                              )}
                              {caps.renameVariant && (
                                <DropdownMenuItem
                                  disabled={writeLocked}
                                  onSelect={() => {
                                    setRenamingId(variant.id);
                                    setRenameValue(variant.name);
                                  }}
                                >
                                  <Pencil />
                                  Rename
                                </DropdownMenuItem>
                              )}
                              {caps.deleteVariant && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={writeLocked || running}
                                  onSelect={() => setDeleteTarget({ id: variant.id, name: variant.name })}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      )}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 px-3 pt-3">
                      {renamingId === variant.id ? (
                        <FieldGroup className="gap-2">
                          <Field data-disabled={writeLocked}>
                            <FieldLabel htmlFor={`variant-rename-${variant.id}`} className="sr-only">
                              New name for {variant.name}
                            </FieldLabel>
                            <Input
                              id={`variant-rename-${variant.id}`}
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              disabled={writeLocked}
                            />
                          </Field>
                          <div className="flex gap-2">
                            <Button
                              size="xs"
                              className="flex-1"
                              disabled={writeLocked || !renameValue.trim()}
                              onClick={() => void saveRename(variant.id)}
                            >
                              {pendingAction === `rename:${variant.id}` && (
                                <Spinner aria-label="Saving variant name" />
                              )}
                              {pendingAction === `rename:${variant.id}` ? "Saving…" : "Save"}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={writeLocked}
                              onClick={() => setRenamingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </FieldGroup>
                      ) : (
                        <CardHeader className="gap-0 p-0">
                          <CardTitle className="truncate">{variant.name}</CardTitle>
                          <CardDescription className="truncate text-xs">@{variant.handle}</CardDescription>
                        </CardHeader>
                      )}
                      {problem && (
                        <Alert variant="destructive" density="compact">
                          <AlertDescription className="text-xs">
                            {problem.error || "That variant didn't finish. You weren't charged for it."}
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                    <CardFooter className="px-3 pb-3 pt-2">
                      {running ? (
                        <Badge variant="warning">
                          <Spinner aria-label={thumb ? "Making variant again" : "Making variant"} />
                          {thumb ? "Making it again" : "Making variant"}
                        </Badge>
                      ) : problem ? (
                        <Badge variant="destructive">Didn&apos;t finish</Badge>
                      ) : thumb ? (
                        <Badge variant="success">Ready</Badge>
                      ) : (
                        <Badge variant="outline">Waiting for image</Badge>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
          {variants.some((v) => v.refs.length > 0) && (
            <p className="m-0 text-[0.75rem] text-muted-foreground">
              Type @{entity.name} when you write a prompt and pick the look you want from the list.
            </p>
          )}
        </section>

        {/* Add a variant — 官方目录不出这一块(不是禁用,是不画:Founder 2026-08-30 只读裁决) */}
        {caps.createVariant && (
        <Card size="sm" className="gap-3 shadow-none">
          <CardHeader>
            <CardTitle>Add a variant</CardTitle>
            <CardDescription>
              {hasBase
                ? "Keep the same identity and describe only what should change."
                : "Set a base look first — variants are generated from it."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-3">
              <Field data-disabled={!hasBase || paidLocked}>
                <FieldLabel htmlFor="variant-name">Variant name</FieldLabel>
                <Input
                  id="variant-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Red dress"
                  disabled={!hasBase || paidLocked}
                />
              </Field>
              <Field data-disabled={!hasBase || paidLocked}>
                <FieldLabel htmlFor="variant-change">What changes</FieldLabel>
                <Textarea
                  id="variant-change"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Wearing an elegant red evening gown"
                  rows={3}
                  disabled={!hasBase || paidLocked}
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            {!uncertainMessage && (
              <Button
                disabled={!hasBase || paidLocked || !name.trim() || !prompt.trim()}
                onClick={() => void submitVariant()}
              >
                {busy ? (
                  <Spinner aria-label="Making variant" />
                ) : (
                  <Sparkles />
                )}
                {busy ? "Making variant…" : `Make variant · ${variantCost}`}
              </Button>
            )}
          </CardFooter>
        </Card>
        )}

        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(next) => {
            if (!next && !deleting) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name ?? "this variant"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the saved look from this element. Prompts that already used it stay
                unchanged, but you will not be able to select this look again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting || !deleteTarget}
                variant="destructive"
                onClick={() => {
                  if (deleteTarget) void removeVariant(deleteTarget.id);
                }}
              >
                {deleting && <Spinner aria-label="Deleting variant" />}
                {deleting ? "Deleting…" : "Delete variant"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export default ElementVariantsDialog;
