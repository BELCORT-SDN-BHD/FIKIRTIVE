"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, Film, ImageIcon, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityDTO } from "@/lib/types";
import type { AdJobItem, HistoryThumb } from "@/lib/data";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import { updateEntity, softDeleteEntity } from "@/lib/actions";
import { saveBrandRecord } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { ExitLink } from "@/components/exits/Exits";
import { BRAND_MEMORY_HREF } from "@/lib/exits";
import { StuffLibrary } from "./stuff/StuffLibrary";
import { AddAssetDialog } from "./stuff/AddAssetDialog";
import { ElementVariantsDialog } from "./stuff/ElementVariantsDialog";
import { useRouter } from "next/navigation";
import DetailPanel from "@/components/asset/DetailPanel";

// Kept as a public export — lib/stuff-items imports this type-only.
export interface AdTile {
  id: string;
  projectId: string;
  assetId: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
  createdAt: string;
}

export interface OttoStuffProps {
  entities: EntityDTO[];
  ads: AdTile[];
  adJobs: AdJobItem[];
  records: BrandRecordRow[];
  history: HistoryThumb[];
  onOpenThread?: (threadId: string, projectId?: string) => void;
  onRetryWithOtto?: (prompt: string) => void;
}

function libraryItemToHistoryThumb(item: LibraryItem): HistoryThumb {
  return {
    id: item.id,
    projectId: item.projectId,
    assetId: item.assetId,
    src: item.url,
    kind: item.kind,
    prompt: item.prompt,
  };
}

function AdJobCard({
  job,
  onOpenThread,
  onRetryWithOtto,
  onHide,
}: {
  job: AdJobItem;
  onOpenThread?: (threadId: string, projectId?: string) => void;
  onRetryWithOtto?: (prompt: string) => void;
  onHide?: (jobId: string) => void;
}) {
  const isProcessing = job.status === "processing";
  const pillClass = isProcessing
    ? "bg-warning-soft text-warning-soft-foreground"
    : "bg-error-soft text-[var(--error-soft-foreground)]";
  const pillLabel = isProcessing ? "Processing…" : "Didn't go through";
  const when = new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/70">
          {job.kind === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
        </span>
        <span className={`rounded-[99px] px-2 py-0.5 text-[0.75rem] font-medium ${pillClass}`}>
          {pillLabel}
        </span>
      </div>
      {job.prompt && (
        <div className="overflow-hidden text-[0.75rem] text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
          {job.prompt}
        </div>
      )}
      <div className="text-[0.75rem] text-muted-foreground/70">{when}</div>
      {job.error && !isProcessing && (
        <div className="overflow-hidden text-[0.75rem] text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
          {job.error}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {job.threadId && (
          <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-[0.75rem]" onClick={() => onOpenThread?.(job.threadId, job.projectId)}>
            <ExternalLink size={13} />
            Open conversation
          </Button>
        )}
        {!isProcessing && job.prompt && (
          <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-[0.75rem]" onClick={() => onRetryWithOtto?.(`Try again with this failed generation: ${job.prompt}`)}>
            <RotateCcw size={13} />
            Retry with Otto
          </Button>
        )}
        {!isProcessing && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[0.75rem]" onClick={() => onHide?.(job.id)}>
            <X size={13} />
            Hide
          </Button>
        )}
      </div>
    </div>
  );
}

export function OttoStuff({ entities, ads, adJobs, records, history, onOpenThread, onRetryWithOtto }: OttoStuffProps) {
  const router = useRouter();
  const [entityList, setEntityList] = useState<EntityDTO[]>(entities);
  const [prevEntities, setPrevEntities] = useState(entities);
  if (prevEntities !== entities) {
    // server truth arrived (router.refresh) — resync and drop stale optimistic edits
    setPrevEntities(entities);
    setEntityList(entities);
  }
  const [addOpen, setAddOpen] = useState(false);
  // #781 — which saved element the merchant opened (base look + styling variants).
  const [openEntityId, setOpenEntityId] = useState<string | null>(null);
  const [chooseProductFor, setChooseProductFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<{ generationId: string; projectId: string } | null>(null);
  const [generationHistory, setGenerationHistory] = useState<HistoryThumb[]>(history);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = useRef(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [hiddenFailedJobs, setHiddenFailedJobs] = useState<Set<string>>(new Set());

  // Stable across renders: the element dialog polls a running variant generation and takes this
  // as a dependency — a new function identity every render would restart that poll each tick.
  const refreshServerData = useCallback(() => router.refresh(), [router]);

  const fetchGenerationHistory = useCallback(async (cursor: string | null, replace: boolean) => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    const res = await getGenerationHistory({ cursor, take: 80 });
    if (requestId !== historyRequestRef.current) return;
    if ("error" in res) {
      setHistoryError(res.error);
      setHistoryLoading(false);
      return;
    }
    const nextItems = res.items.map(libraryItemToHistoryThumb);
    setGenerationHistory((prev) => {
      if (replace) return nextItems;
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...nextItems.filter((item) => !seen.has(item.id))];
    });
    setHistoryCursor(res.nextCursor);
    setHistoryHasMore(res.hasMore);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setGenerationHistory(history);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      setHistoryError(null);
      void fetchGenerationHistory(null, true);
    });
  }, [history, fetchGenerationHistory]);

  const items = useMemo(
    () => buildStuffItems({ entities: entityList, history: generationHistory, ads, records }),
    [entityList, generationHistory, ads, records],
  );

  async function handleRename(entityId: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const snapshot = entityList.find((e) => e.id === entityId);
    if (!snapshot || trimmed === snapshot.name) return;
    setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: trimmed } : e)));
    const res = await updateEntity(entityId, { name: trimmed });
    if ("error" in res) {
      setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: snapshot.name } : e)));
    }
  }

  async function handleDelete(entityId: string) {
    const snapshot = entityList.find((e) => e.id === entityId);
    setEntityList((cur) => cur.filter((e) => e.id !== entityId));
    setDeleteError(null);
    const res = await softDeleteEntity(entityId);
    if ("error" in res) {
      setEntityList((cur) => (snapshot ? [...cur, snapshot] : cur));
      setDeleteError(res.error);
    }
  }

  // Active product records to choose from when linking an image as a product image.
  const activeProducts = records.filter((r) => r.kind === "product" && r.status === "active");
  const visibleAdJobs = adJobs.filter((j) => !hiddenFailedJobs.has(j.id));
  const processingJobs = visibleAdJobs.filter((j) => j.status === "processing");
  const failedJobs = visibleAdJobs.filter((j) => j.status === "failed");

  async function linkProductImage(rec: BrandRecordRow, assetId: string) {
    const data = { ...(rec.data as Record<string, unknown>), imageAssetId: assetId };
    await saveBrandRecord({ id: rec.id, kind: "product", data });
    setChooseProductFor(null);
    router.refresh();
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="otto-stuff-scroll gb flex-1 overflow-auto p-6 leading-[1.5]">
      <style>{`
        @media (max-width: 680px) {
          .otto-stuff-scroll { padding: 1rem 0.75rem !important; }
        }
      `}</style>
      <div className="mx-auto max-w-[880px]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 text-[1.5rem] font-bold tracking-[-0.02em] text-foreground">
              Library
            </h1>
            <p className="mt-1 mb-0 max-w-[560px] text-[0.9375rem] text-muted-foreground leading-[1.5]">
              Everything you and Otto have made or saved across every project.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus size={16} />
            Add
          </Button>
        </div>

        {deleteError && (
          <div role="alert" className="mb-3 rounded-[14px] bg-error-soft px-3 py-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {deleteError}
          </div>
        )}

        {processingJobs.length > 0 && (
          <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {processingJobs.map((job) => (
              <AdJobCard key={job.id} job={job} onOpenThread={onOpenThread} />
            ))}
          </div>
        )}

        <StuffLibrary
          items={items}
          mode="library"
          onRename={handleRename}
          onDelete={handleDelete}
          onSetProductImage={(assetId) => setChooseProductFor(assetId)}
          onOpenGeneration={(generationId, itemProjectId) => setDetailFor({ generationId, projectId: itemProjectId })}
          onOpenEntity={(id) => setOpenEntityId(id)}
        />
        <div className="mt-4 flex items-center gap-3">
          {historyHasMore && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={historyLoading}
              onClick={() => void fetchGenerationHistory(historyCursor, false)}
            >
              {historyLoading ? "Loading..." : "Load more"}
            </Button>
          )}
          {historyError && (
            <span className="text-[0.8125rem] text-destructive">{historyError}</span>
          )}
        </div>

        {failedJobs.length > 0 && (
          <div className="mt-6 rounded-[14px] border border-border bg-card p-4">
            <div className="mb-3">
              <h2 className="m-0 text-[1rem] font-semibold text-foreground">Needs attention</h2>
              <p className="m-0 mt-1 text-[0.8125rem] text-muted-foreground">
                Failed generations stay here so the library remains focused on reusable assets.
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {failedJobs.map((job) => (
                <AdJobCard
                  key={job.id}
                  job={job}
                  onOpenThread={onOpenThread}
                  onRetryWithOtto={onRetryWithOtto}
                  onHide={(id) => setHiddenFailedJobs((cur) => new Set(cur).add(id))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <AddAssetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => router.refresh()}
      />

      <ElementVariantsDialog
        // keyed by element: opening a different one starts from a clean form instead of
        // inheriting the last element's half-typed variant
        key={openEntityId ?? "none"}
        entity={entityList.find((e) => e.id === openEntityId) ?? null}
        open={!!openEntityId}
        onOpenChange={(next) => { if (!next) setOpenEntityId(null); }}
        onChanged={refreshServerData}
      />

      {chooseProductFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a product"
          onClick={() => setChooseProductFor(null)}
        >
          <div
            className="w-full max-w-[420px] rounded-[16px] border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="m-0 mb-1 text-[1.125rem] font-semibold text-foreground">Set as product image</h2>
            <p className="mb-4 mt-0 text-[0.875rem] text-muted-foreground">Pick which product this image belongs to.</p>
            {activeProducts.length === 0 ? (
              // #701 — the path is real (Brand memory → Your products → + Add product); it
              // just was not a link, so the merchant had to find four levels of it themselves.
              <p className="text-[0.875rem] text-muted-foreground">
                No products yet —{" "}
                <ExitLink href={BRAND_MEMORY_HREF}>add one in Brand memory</ExitLink> first.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeProducts.map((rec) => {
                  const name = (rec.data as { name?: unknown }).name;
                  return (
                    <Button
                      key={rec.id}
                      type="button"
                      variant="ghost"
                      onClick={() => void linkProductImage(rec, chooseProductFor)}
                      className="h-auto w-full justify-start rounded-[10px] px-3 py-2 text-left text-[0.9375rem] font-normal text-foreground hover:bg-accent"
                    >
                      {typeof name === "string" && name ? name : "Untitled product"}
                    </Button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setChooseProductFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      {detailFor && (
        <DetailPanel
          generationId={detailFor.generationId}
          projectId={detailFor.projectId}
          entities={entities}
          onClose={() => {
            setDetailFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export default OttoStuff;
