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
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createVariant,
  deleteVariant,
  getRefGenJobs,
  regenerateVariant,
  renameVariant,
  setBaseAsset,
} from "@/lib/refgen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { displayCredits, pricedRefgenCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import {
  isVariantRunning,
  latestVariantRef,
  variantJustFinished,
  variantsToWatch,
  type VariantJobs,
  type VariantJobStatus,
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // What the server last said about each variant's NEWEST generation job (see lib/variant-progress).
  const [jobs, setJobs] = useState<VariantJobs>({});
  // The same map, readable inside the poll without making it a dependency — the poll compares what
  // it just heard against what it knew, and a "just finished" is that comparison.
  const jobsRef = useRef<VariantJobs>({});
  // Every paid button is guarded synchronously: `busy` is state and lands a render too late to
  // stop a fast double-click, and a second click here would be a second charge.
  const submittingRef = useRef(false);

  const entityId = entity?.id ?? null;
  const variants = entity?.variants ?? [];
  const baseRef = entity?.refs.find((r) => r.assetId === entity.baseAssetId) ?? null;
  const hasBase = !!baseRef;
  const variantCost = creditsLabel(displayCredits(pricedRefgenCredits({ model: "seedream", count: 1 })));

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  /** Closing forgets what the server said, so opening again asks fresh — a generation started
   *  meanwhile (by Otto, or in another tab) is picked up instead of hidden behind a remembered
   *  "that one finished". Entries are keyed by variant id, so anything left over from another
   *  element is simply never looked up. */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setJobs({});
      onOpenChange(next);
    },
    [onOpenChange],
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
      const heard: Array<{ id: string; view: { status: VariantJobStatus; error: string } }> = [];
      for (const variantId of watchKey.split(",")) {
        try {
          const rows = await getRefGenJobs(entityId, variantId);
          const latest = rows[0];
          heard.push({
            id: variantId,
            view: latest
              ? { status: latest.status as VariantJobStatus, error: latest.error || "" }
              : { status: "NONE", error: "" },
          });
        } catch {
          // A failed poll is not a failed generation — keep what we knew and try again next tick.
        }
      }
      if (cancelled || heard.length === 0) return;
      const finished = heard.some(({ id, view }) => variantJustFinished(jobsRef.current[id], view));
      setJobs((cur) => {
        const next = { ...cur };
        for (const { id, view } of heard) next[id] = view;
        return next;
      });
      if (finished) {
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
   *  queued. Recording that immediately is what makes the finish visible: the poll only calls a
   *  DONE it can see arriving a finish, and only a running variant is polled at all. */
  const markRunning = useCallback((variantId: string) => {
    setJobs((cur) => ({ ...cur, [variantId]: { status: "QUEUED", error: "" } }));
  }, []);

  /** Run one paid variant action: guard the double-click, surface the refusal in the merchant's
   *  own words, and re-read server truth either way. The action itself says what happened to the
   *  money; what the merchant then WATCHES is the variant marked running above. */
  const runPaid = useCallback(
    async (work: () => Promise<{ error: string } | { ok: true }>) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await work();
        if ("error" in res) {
          setError(res.error);
          return;
        }
        onChanged();
      } catch {
        setError("Couldn't do that right now. Please try again.");
      } finally {
        // A reserve happens the moment the action accepts — and a refused start can still have
        // reserved and refunded — so the balance is announced either way (#550).
        notifyBalanceRefresh();
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [onChanged],
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
    });
  }

  async function saveRename(variantId: string) {
    const cleanName = renameValue.trim();
    if (!cleanName) return;
    setError(null);
    const res = await renameVariant(variantId, cleanName);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setRenamingId(null);
    onChanged();
  }

  async function removeVariant(variantId: string) {
    setError(null);
    const res = await deleteVariant(variantId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  async function makeBase(assetId: string) {
    if (!entityId) return;
    setError(null);
    const res = await setBaseAsset(entityId, assetId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  if (!entity) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{entity.name}</DialogTitle>
          <DialogDescription>
            One saved photo is the base look — the face and identity every variant keeps. Add
            variants for the different outfits and looks you want to reuse.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="rounded-[14px] bg-error-soft px-3 py-2 text-[0.875rem] text-[var(--error-soft-foreground)]"
          >
            {error}
          </div>
        )}

        {/* Base look */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Base look</h3>
          {entity.refs.length === 0 ? (
            <p className="m-0 text-[0.8125rem] text-muted-foreground">
              This element has no photo yet. Add one from the Library first — variants are made
              from the base look.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {entity.refs.map((ref) => {
                const isBase = ref.assetId === entity.baseAssetId;
                return (
                  <div key={ref.id} className="flex w-[104px] flex-col gap-1">
                    <div className="relative aspect-square overflow-hidden rounded-[14px] border border-border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ref.url} alt={entity.name} className="h-full w-full object-cover" />
                      {isBase && (
                        <Badge variant="brand" className="absolute left-1.5 top-1.5">
                          Base
                        </Badge>
                      )}
                    </div>
                    {!isBase && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[0.75rem]"
                        onClick={() => void makeBase(ref.assetId)}
                      >
                        Use as base
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
            <p className="m-0 text-[0.8125rem] text-muted-foreground">
              No variants yet. The base look stays the same person; a variant changes the outfit,
              the styling or the setting.
            </p>
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
                  <div
                    key={variant.id}
                    className="flex flex-col overflow-hidden rounded-[16px] border border-border bg-card"
                  >
                    <div className="relative aspect-square bg-muted">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb.url} alt={variant.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[0.75rem] text-muted-foreground">
                          {running ? "Making this look…" : problem ? "Didn't finish" : "No image yet"}
                        </div>
                      )}
                      {/* A re-run keeps the old image on screen while it works, so say so — otherwise
                          paying for "Make it again" looks like nothing happened, and the obvious next
                          move is to pay again. */}
                      {thumb && running && (
                        <div className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-center text-[0.75rem] text-white">
                          Making it again…
                        </div>
                      )}
                      <div className="absolute right-1 top-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8"
                              aria-label={`Actions for ${variant.name}`}
                            >
                              <MoreHorizontal size={15} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={busy}
                              onSelect={() => void regenerate(variant.id)}
                            >
                              <RotateCcw size={14} />
                              Make it again · {variantCost}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setRenamingId(variant.id);
                                setRenameValue(variant.name);
                              }}
                            >
                              <Pencil size={14} />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void removeVariant(variant.id)}
                            >
                              <Trash2 size={14} />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 px-2 py-2">
                      {renamingId === variant.id ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label={`New name for ${variant.name}`}
                            className="h-8"
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-7 flex-1 px-2 text-[0.75rem]"
                              onClick={() => void saveRename(variant.id)}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[0.75rem]"
                              onClick={() => setRenamingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="truncate text-[0.8125rem] font-medium text-foreground">
                            {variant.name}
                          </span>
                          <span className="truncate text-[0.75rem] text-muted-foreground">
                            @{variant.handle}
                          </span>
                        </>
                      )}
                      {problem && (
                        <span className="text-[0.75rem] text-muted-foreground">
                          {problem.error || "That variant didn't finish. You weren't charged for it."}
                        </span>
                      )}
                    </div>
                  </div>
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

        {/* Add a variant */}
        <section className="flex flex-col gap-2 rounded-[16px] border border-border bg-muted/40 p-3">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Add a variant</h3>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name it, e.g. Red dress"
            aria-label="Variant name"
            disabled={!hasBase || busy}
          />
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What changes — e.g. wearing an elegant red evening gown"
            aria-label="What changes in this variant"
            rows={3}
            disabled={!hasBase || busy}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.75rem] text-muted-foreground">
              {hasBase
                ? "Same person as the base look, restyled."
                : "Set a base look first — variants are generated from it."}
            </span>
            <Button disabled={!hasBase || busy} onClick={() => void submitVariant()}>
              <Sparkles size={16} />
              {busy ? "Working…" : `Make variant · ${variantCost}`}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default ElementVariantsDialog;
